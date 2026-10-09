// OAuth 2 for the MCP server over HTTP (ADR 0017). help-me-ops is a *resource
// server*, as the MCP specification puts it: it never logs anyone in. The
// company's identity provider (Entra ID, Okta, Keycloak, Auth0...) does that and
// hands the client an access token; this module checks the token on every request
// (signature against the provider's keys, issuer, audience, expiry, scopes) and
// publishes the metadata a client needs to find that provider (RFC 9728).
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";

export interface OAuthConfig {
  /**
   * The identity provider's issuer, character for character as it appears in the `iss` claim of its
   * tokens. It is not tidied: Auth0 and Microsoft's v1 tokens end with a slash, Keycloak, Okta and
   * Microsoft's v2 tokens do not, and a token for another spelling is another issuer.
   */
  issuer: string;
  /** Where its public keys are, when they are not to be found by discovery (declared by hand). */
  jwksUri?: string;
  /** What a token must be issued for (`aud`): this server's identifier; its URL by default. */
  audience: string;
  /** This server's canonical URL, as clients reach it (https://mcp.company.example/mcp). */
  resource: string;
  /** Scopes a token must carry, all of them; none means any token of this audience will do. */
  scopes: string[];
  /** The claims that name the person, tried in order. */
  identityClaims: string[];
  /** Signature algorithms accepted. Never `none`, never a shared-secret one. */
  algorithms: string[];
  /** Seconds of difference between clocks that are forgiven. */
  clockToleranceSec: number;
  /** Milliseconds an unknown key id will not trigger a new fetch of the keys. */
  jwksCooldownMs: number;
  /**
   * For tokens that are not JWTs (RFC 7662): the provider is asked whether a token is good. This
   * server authenticates to the provider with its own client id and secret. Without it, only JWTs.
   */
  introspection?: {
    /** Where to ask; the provider's metadata says, when it is left out. */
    url?: string;
    clientId: string;
    clientSecret: string;
    /** `auto`: JWTs are checked here and other tokens are asked about; `always`: every token is asked about (a revoked token stops at once). */
    mode: "auto" | "always";
  };
  /** Milliseconds a good answer of the provider about a token is kept (never beyond its expiry); a bad one is kept 5 s. */
  introspectionCacheMs?: number;
  /** Accept a token that does not say who it is for. Only when the provider issues tokens for one resource only. */
  allowNoAudience: boolean;
}

export const OAUTH_DEFAULTS = {
  identityClaims: ["preferred_username", "email", "upn", "username", "sub", "client_id"],
  algorithms: ["RS256", "PS256", "ES256"],
  clockToleranceSec: 30,
  jwksCooldownMs: 30_000,
} as const;

/** A token that cannot be accepted, in the words of RFC 6750. */
export class OAuthError extends Error {
  status: 401 | 403 | 503;
  code: "invalid_token" | "insufficient_scope" | "temporarily_unavailable";
  constructor(
    status: 401 | 403 | 503,
    code: "invalid_token" | "insufficient_scope" | "temporarily_unavailable",
    message: string,
  ) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface OAuthVerifier {
  config: OAuthConfig;
  /** Where a client learns which provider to ask: sent in the 401 and served by the server. */
  metadataUrl: string;
  /** Where the keys are, found by discovery or declared; none when only introspection is used. */
  jwksUri?: string;
  /** Where tokens are asked about, if they are. */
  introspectionUrl?: string;
  /** The body of that document (RFC 9728). */
  metadata(): Record<string, unknown>;
  /** What the provider says about a token, unchecked and uncached (for `oauth check`); none without introspection. */
  inspect(token: string): Promise<Record<string, unknown> | undefined>;
  /** The person behind a token, or an OAuthError. */
  verify(token: string): Promise<{ identity: string; scopes: string[] }>;
}

const loopback = (host: string) =>
  host === "localhost" || (isIP(host) === 4 && host.startsWith("127.")) || host === "::1" || host === "[::1]";

/** An address that carries credentials or keys must be https, unless it is on this machine (development, tests). */
function requireHttps(url: string, what: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${what} "${url}" is not a URL.`);
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback(parsed.hostname))) {
    throw new Error(
      `${what} must be https (it is ${url}): a token or a key fetched over plain HTTP can be replaced on the way.`,
    );
  }
  return parsed;
}

/** The addresses at which a provider may publish its metadata: OpenID Connect, then RFC 8414 with and without the path. */
export function discoveryUrls(issuer: string): string[] {
  const u = new URL(issuer);
  const path = u.pathname.replace(/\/+$/, "");
  const base = `${u.origin}`;
  return [
    `${base}${path}/.well-known/openid-configuration`,
    `${base}/.well-known/oauth-authorization-server${path}`,
    `${base}${path}/.well-known/oauth-authorization-server`,
  ];
}

async function fetchJson(url: string, fetchImpl: typeof fetch): Promise<Record<string, unknown> | null> {
  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(5000),
      headers: { accept: "application/json" },
      redirect: "error",
    });
    if (!response.ok) return null;
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Finds where the provider's keys and its introspection endpoint are (by its published metadata, or from
 * what was declared) and returns the verifier. It fails closed: a provider that cannot be reached, or
 * whose metadata names another issuer, is an error at start, not a server that accepts anything.
 */
export async function createOAuthVerifier(
  config: OAuthConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<OAuthVerifier> {
  requireHttps(config.issuer, "The OAuth issuer");
  const issuer = config.issuer;
  requireHttps(config.resource, "The public URL of this server");
  let jwksUri = config.jwksUri;
  let introspectionUrl = config.introspection?.url;
  if (jwksUri) requireHttps(jwksUri, "The JWKS address");
  if (introspectionUrl) requireHttps(introspectionUrl, "The introspection address");
  // Ask the provider for what was not declared. When everything needed is declared, it is not asked.
  const needKeys = !jwksUri && config.introspection?.mode !== "always";
  const needIntrospection = Boolean(config.introspection) && !introspectionUrl;
  if (needKeys || needIntrospection) {
    let found: Record<string, unknown> | null = null;
    for (const url of discoveryUrls(issuer)) {
      found = await fetchJson(url, fetchImpl);
      if (found) break;
    }
    if (!found) {
      throw new Error(
        `Cannot find the metadata of the OAuth issuer ${issuer} (tried ${discoveryUrls(issuer).join(", ")}). Check the issuer, or declare what it would say: where its keys are (--oauth-jwks-uri) or where tokens are asked about (--oauth-introspection-url).`,
      );
    }
    // The metadata must say it is the issuer asked for: otherwise a document fetched from one place could name another provider's keys.
    if (found.issuer !== issuer) {
      const slash =
        typeof found.issuer === "string" && found.issuer.replace(/\/+$/, "") === issuer.replace(/\/+$/, "")
          ? ` It differs only by a trailing slash: write the issuer exactly as the provider does, ${found.issuer}, because that is what its tokens carry.`
          : "";
      throw new Error(
        `The metadata found for ${issuer} names another issuer (${String(found.issuer)}): refusing it.${slash}`,
      );
    }
    if (needKeys) {
      if (typeof found.jwks_uri === "string") {
        requireHttps(found.jwks_uri, "The JWKS address of the issuer");
        jwksUri = found.jwks_uri;
      } else if (!config.introspection) {
        throw new Error(
          `The metadata of ${issuer} has no jwks_uri: declare where its keys are (--oauth-jwks-uri), or, if it issues opaque tokens, how to ask about them (--oauth-client-id and --oauth-client-secret).`,
        );
      }
    }
    if (needIntrospection) {
      if (typeof found.introspection_endpoint !== "string") {
        throw new Error(
          `The metadata of ${issuer} has no introspection_endpoint: declare it (--oauth-introspection-url).`,
        );
      }
      requireHttps(found.introspection_endpoint, "The introspection address of the issuer");
      introspectionUrl = found.introspection_endpoint;
    }
  }
  const keys = jwksUri
    ? createRemoteJWKSet(new URL(jwksUri), {
        timeoutDuration: 5000,
        cooldownDuration: config.jwksCooldownMs,
        cacheMaxAge: 10 * 60_000,
      })
    : undefined;
  const resourceUrl = new URL(config.resource);
  const metadataPath = `/.well-known/oauth-protected-resource${resourceUrl.pathname === "/" ? "" : resourceUrl.pathname}`;
  const metadataUrl = `${resourceUrl.origin}${metadataPath}`;

  /** What the provider says about a token (RFC 7662), authenticating as this server. Anything but a clear answer is "not now". */
  const ask = async (token: string): Promise<Record<string, unknown>> => {
    const { clientId, clientSecret } = config.introspection!;
    let response: Response;
    try {
      response = await fetchImpl(introspectionUrl!, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
          // RFC 6749 2.3.1: the id and the secret are form-encoded before they are joined
          authorization: `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString("base64")}`,
        },
        body: new URLSearchParams({ token, token_type_hint: "access_token" }),
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
    } catch {
      throw new OAuthError(503, "temporarily_unavailable", "the provider cannot be reached");
    }
    if (response.status === 401 || response.status === 403) {
      // Not the caller's fault: this server's own credentials at the provider are wrong.
      throw new OAuthError(
        503,
        "temporarily_unavailable",
        `the provider refused this server's own credentials (${response.status})`,
      );
    }
    if (!response.ok) throw new OAuthError(503, "temporarily_unavailable", `the provider answered ${response.status}`);
    try {
      return (await response.json()) as Record<string, unknown>;
    } catch {
      throw new OAuthError(503, "temporarily_unavailable", "the provider's answer is not JSON");
    }
  };

  // A good answer is kept until the token expires or for 30 s, a bad one for 5 s: a flood of bad tokens
  // does not become a flood of questions to the provider, and a revoked token stops within half a minute.
  const cache = new Map<string, { until: number; claims: Record<string, unknown> | null }>();
  const introspect = async (token: string): Promise<Record<string, unknown>> => {
    const key = createHash("sha256").update(token).digest("hex");
    const hit = cache.get(key);
    if (hit && hit.until > Date.now()) {
      if (!hit.claims) throw new OAuthError(401, "invalid_token", "inactive");
      return hit.claims;
    }
    const claims = await ask(token);
    const now = Date.now();
    const exp = typeof claims.exp === "number" ? claims.exp * 1000 : Infinity;
    if (claims.active !== true) {
      cache.set(key, { until: now + 5_000, claims: null });
      throw new OAuthError(401, "invalid_token", "inactive");
    }
    if (cache.size >= 1000) cache.clear();
    cache.set(key, { until: Math.min(now + (config.introspectionCacheMs ?? 30_000), exp), claims });
    return claims;
  };

  /** What a token that was not a JWT says, through the checks a JWT gets from `jose`. */
  const checkClaims = (claims: Record<string, unknown>): JWTPayload => {
    const now = Date.now() / 1000;
    const tolerance = config.clockToleranceSec;
    if (typeof claims.iss === "string" && claims.iss !== issuer) throw new OAuthError(401, "invalid_token", "iss");
    if (typeof claims.exp === "number" && claims.exp + tolerance < now)
      throw new OAuthError(401, "invalid_token", "exp");
    if (typeof claims.nbf === "number" && claims.nbf - tolerance > now)
      throw new OAuthError(401, "invalid_token", "nbf");
    const aud = Array.isArray(claims.aud) ? claims.aud : claims.aud === undefined ? [] : [claims.aud];
    if (aud.length ? !aud.includes(config.audience) : !config.allowNoAudience) {
      throw new OAuthError(401, "invalid_token", "aud");
    }
    return claims as JWTPayload;
  };

  return {
    config,
    jwksUri,
    introspectionUrl,
    metadataUrl,
    metadata: () => ({
      resource: config.resource,
      authorization_servers: [issuer],
      ...(config.scopes.length ? { scopes_supported: config.scopes } : {}),
      bearer_methods_supported: ["header"],
      resource_name: "help-me-ops",
    }),
    inspect: async (token) => (introspectionUrl ? await ask(token) : undefined),
    async verify(token) {
      const jwtShaped = token.split(".").length === 3;
      let payload: JWTPayload;
      if (introspectionUrl && (config.introspection!.mode === "always" || !jwtShaped || !keys)) {
        payload = checkClaims(await introspect(token));
      } else if (keys && jwtShaped) {
        try {
          ({ payload } = await jwtVerify(token, keys, {
            issuer,
            audience: config.audience,
            algorithms: config.algorithms,
            clockTolerance: config.clockToleranceSec,
            requiredClaims: ["exp"],
          }));
        } catch (error) {
          // Why it failed is for the log, not for the caller: the code of the library, never the token.
          throw new OAuthError(401, "invalid_token", (error as { code?: string }).code ?? "invalid");
        }
      } else {
        throw new OAuthError(401, "invalid_token", "not a JWT, and no way to ask the provider about it");
      }
      const scopes = scopesOf(payload);
      const missing = config.scopes.filter((s) => !scopes.includes(s));
      if (missing.length) throw new OAuthError(403, "insufficient_scope", `missing ${missing.join(" ")}`);
      return { identity: identityOf(payload, config.identityClaims), scopes };
    },
  };
}

/** The scopes of a token: `scope` (a space-separated string) or `scp` (a list or a string). */
function scopesOf(payload: JWTPayload): string[] {
  const raw = payload.scope ?? payload.scp;
  if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === "string");
  return typeof raw === "string" ? raw.split(/\s+/).filter(Boolean) : [];
}

/** `oauth:` and the first claim that names the person, kept to characters that cannot forge a log line. */
function identityOf(payload: JWTPayload, claims: string[]): string {
  for (const claim of claims) {
    const value = payload[claim];
    if (typeof value === "string" && value.trim())
      return `oauth:${value
        .trim()
        .replace(/[^\w.@+-]/g, "_")
        .slice(0, 100)}`;
  }
  throw new OAuthError(401, "invalid_token", "no claim names the person");
}

/** The first value that is set: an empty variable (a compose file passes them empty) is not set. */
const first = (...values: (string | undefined)[]) => values.find((v) => v !== undefined && v.trim() !== "");

function readSecret(path: string): string {
  try {
    return readFileSync(path, "utf8").trim();
  } catch (error) {
    throw new Error(
      `OPS_MCP_OAUTH_CLIENT_SECRET_FILE: cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

const list = (text: string | undefined) =>
  (text ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * The OAuth settings from the command line and the environment, flags first, or undefined when no
 * issuer is given (static tokens only). `--oauth-issuer`/OPS_MCP_OAUTH_ISSUER turns it on;
 * `--oauth-jwks-uri`, `--oauth-audience`, `--oauth-scope`, `--oauth-identity-claim`, `--oauth-algorithm`
 * and `--public-url` have OPS_MCP_OAUTH_JWKS_URI, _AUDIENCE, _SCOPES, _IDENTITY_CLAIMS, _ALGORITHMS and
 * OPS_MCP_PUBLIC_URL beside them. The public URL defaults to https://<first public host><path>.
 */
export function oauthConfigFrom(
  argv: string[],
  env: NodeJS.ProcessEnv,
  where: { path: string; publicHosts: string[] },
): OAuthConfig | undefined {
  const all = (name: string) => argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]!] : []));
  const one = (name: string) => all(name).at(-1);
  const issuer = first(one("--oauth-issuer"), env.OPS_MCP_OAUTH_ISSUER);
  if (!issuer) return undefined;
  const resource = first(
    one("--public-url"),
    env.OPS_MCP_PUBLIC_URL,
    where.publicHosts[0] ? `https://${where.publicHosts[0]}${where.path}` : undefined,
  );
  if (!resource) {
    throw new Error(
      "OAuth needs this server's public URL (--public-url https://mcp.company.example/mcp), or a --public-host to derive it from.",
    );
  }
  const claims = all("--oauth-identity-claim").length
    ? all("--oauth-identity-claim")
    : list(env.OPS_MCP_OAUTH_IDENTITY_CLAIMS);
  const algorithms = all("--oauth-algorithm").length ? all("--oauth-algorithm") : list(env.OPS_MCP_OAUTH_ALGORITHMS);
  const scopes = all("--oauth-scope").length ? all("--oauth-scope") : list(env.OPS_MCP_OAUTH_SCOPES);
  const unsafe = algorithms.find((a) => /^(none|HS\d+)$/i.test(a));
  if (unsafe)
    throw new Error(
      `The algorithm ${unsafe} is not accepted: a token signed with a shared secret or not at all proves nothing here.`,
    );
  const clientId = first(one("--oauth-client-id"), env.OPS_MCP_OAUTH_CLIENT_ID);
  const secretFile = first(env.OPS_MCP_OAUTH_CLIENT_SECRET_FILE);
  const clientSecret = first(
    one("--oauth-client-secret"),
    env.OPS_MCP_OAUTH_CLIENT_SECRET,
    secretFile ? readSecret(secretFile) : undefined,
  );
  const url = first(one("--oauth-introspection-url"), env.OPS_MCP_OAUTH_INTROSPECTION_URL);
  if (Boolean(clientId) !== Boolean(clientSecret)) {
    throw new Error(
      "Asking the provider about tokens needs both --oauth-client-id and --oauth-client-secret (or their variables).",
    );
  }
  const mode = first(one("--oauth-introspect"), env.OPS_MCP_OAUTH_INTROSPECT) ?? "auto";
  if (mode !== "auto" && mode !== "always") throw new Error(`--oauth-introspect is auto or always, not "${mode}".`);
  if (url && !clientId)
    throw new Error(
      "--oauth-introspection-url needs --oauth-client-id and --oauth-client-secret: the provider wants to know who asks.",
    );
  return {
    issuer,
    introspection: clientId && clientSecret ? { url, clientId, clientSecret, mode } : undefined,
    allowNoAudience: argv.includes("--oauth-allow-no-audience") || env.OPS_MCP_OAUTH_ALLOW_NO_AUDIENCE === "true",
    jwksUri: first(one("--oauth-jwks-uri"), env.OPS_MCP_OAUTH_JWKS_URI),
    audience: first(one("--oauth-audience"), env.OPS_MCP_OAUTH_AUDIENCE) ?? resource,
    resource,
    scopes,
    identityClaims: claims.length ? claims : [...OAUTH_DEFAULTS.identityClaims],
    algorithms: algorithms.length ? algorithms : [...OAUTH_DEFAULTS.algorithms],
    clockToleranceSec: OAUTH_DEFAULTS.clockToleranceSec,
    jwksCooldownMs: OAUTH_DEFAULTS.jwksCooldownMs,
  };
}

/** What a token says, read without trusting it (no signature check): for `ops oauth check`. */
export function readToken(token: string): { header: Record<string, unknown>; claims: Record<string, unknown> } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const part = (s: string) => JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as Record<string, unknown>;
    return { header: part(parts[0]!), claims: part(parts[1]!) };
  } catch {
    return null;
  }
}

/**
 * Why a token would be refused, in words, from what it says and what is configured: which of the checks the
 * server makes fail, and what to change. The server's own answer to a bad token is only `invalid_token`, on purpose.
 */
export function explainToken(
  config: OAuthConfig,
  token: string | { claims: Record<string, unknown> },
  now = Date.now(),
): { ok: boolean; lines: string[] } {
  let header: Record<string, unknown> | undefined;
  let claims: Record<string, unknown>;
  if (typeof token === "string") {
    const read = readToken(token);
    if (!read) {
      return {
        ok: false,
        lines: [
          "✘ this is not a JWT (three parts, base64): it can only be checked by asking the provider (--oauth-client-id and --oauth-client-secret)",
        ],
      };
    }
    ({ header, claims } = read);
  } else claims = token.claims;
  const lines: string[] = [];
  let ok = true;
  const say = (good: boolean, text: string) => {
    if (!good) ok = false;
    lines.push(`${good ? "✔" : "✘"} ${text}`);
  };
  if (claims.active === false)
    say(false, "the provider says this token is not active (revoked, expired, or never issued)");
  if (header) {
    const alg = String(header.alg);
    say(
      config.algorithms.includes(alg),
      config.algorithms.includes(alg)
        ? `signature algorithm ${alg}`
        : `signature algorithm ${alg} is not accepted (accepted: ${config.algorithms.join(", ")})`,
    );
  }
  const iss = claims.iss;
  if (iss === undefined && !header)
    say(true, "the provider's answer does not state an issuer (allowed when it is the provider that answers)");
  else if (iss === config.issuer) say(true, `issuer ${String(iss)}`);
  else {
    const slash = typeof iss === "string" && iss.replace(/\/+$/, "") === config.issuer.replace(/\/+$/, "");
    say(
      false,
      `issuer: the token says ${JSON.stringify(iss)}, the server expects ${JSON.stringify(config.issuer)}${slash ? " (they differ only by a trailing slash: write it as the token does)" : ""}`,
    );
  }
  const aud = Array.isArray(claims.aud)
    ? (claims.aud as string[])
    : claims.aud === undefined
      ? []
      : [String(claims.aud)];
  say(
    aud.includes(config.audience) || (!aud.length && config.allowNoAudience),
    aud.includes(config.audience)
      ? `audience ${config.audience}`
      : `audience: the token is for ${JSON.stringify(aud)}, the server expects ${JSON.stringify(config.audience)} (set the API identifier at the provider, or --oauth-audience)`,
  );
  const exp = typeof claims.exp === "number" ? claims.exp * 1000 : undefined;
  if (exp === undefined) say(false, "no exp claim: a token that never expires is refused");
  else
    say(
      exp + config.clockToleranceSec * 1000 > now,
      exp > now ? `expires in ${Math.round((exp - now) / 1000)} s` : `expired ${Math.round((now - exp) / 1000)} s ago`,
    );
  const have = scopesOf(claims as JWTPayload);
  const missing = config.scopes.filter((s) => !have.includes(s));
  say(
    !missing.length,
    config.scopes.length
      ? missing.length
        ? `scopes: missing ${missing.join(" ")} (the token has ${have.join(" ") || "none"})`
        : `scopes ${config.scopes.join(" ")}`
      : `no scope required (the token has ${have.join(" ") || "none"})`,
  );
  try {
    say(true, `the person is ${identityOf(claims as JWTPayload, config.identityClaims)}`);
  } catch {
    say(
      false,
      `no claim names the person: tried ${config.identityClaims.join(", ")}; the token has ${Object.keys(claims).join(", ")} (add one at the provider, or name one with --oauth-identity-claim)`,
    );
  }
  return { ok, lines };
}
