// OAuth 2 for the MCP server over HTTP (ADR 0017). help-me-ops is a *resource
// server*, as the MCP specification puts it: it never logs anyone in. The
// company's identity provider (Entra ID, Okta, Keycloak, Auth0...) does that and
// hands the client an access token; this module checks the token on every request
// (signature against the provider's keys, issuer, audience, expiry, scopes) and
// publishes the metadata a client needs to find that provider (RFC 9728).
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { isIP } from "node:net";

export interface OAuthConfig {
  /** The identity provider's issuer URL, exactly as it appears in the `iss` claim of its tokens. */
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
}

export const OAUTH_DEFAULTS = {
  identityClaims: ["preferred_username", "email", "upn", "sub"],
  algorithms: ["RS256", "PS256", "ES256"],
  clockToleranceSec: 30,
  jwksCooldownMs: 30_000,
} as const;

/** A token that cannot be accepted, in the words of RFC 6750. */
export class OAuthError extends Error {
  status: 401 | 403;
  code: "invalid_token" | "insufficient_scope";
  constructor(status: 401 | 403, code: "invalid_token" | "insufficient_scope", message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface OAuthVerifier {
  config: OAuthConfig;
  /** Where a client learns which provider to ask: sent in the 401 and served by the server. */
  metadataUrl: string;
  /** The body of that document (RFC 9728). */
  metadata(): Record<string, unknown>;
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
 * Finds where the provider's keys are (by its published metadata, or from what was declared) and
 * returns the verifier. It fails closed: a provider that cannot be reached, or whose metadata names
 * another issuer, is an error at start, not a server that accepts anything.
 */
export async function createOAuthVerifier(
  config: OAuthConfig,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<OAuthVerifier> {
  const issuer = requireHttps(config.issuer, "The OAuth issuer").href.replace(/\/+$/, "");
  requireHttps(config.resource, "The public URL of this server");
  let jwksUri = config.jwksUri;
  if (jwksUri) {
    requireHttps(jwksUri, "The JWKS address");
  } else {
    let found: Record<string, unknown> | null = null;
    for (const url of discoveryUrls(issuer)) {
      found = await fetchJson(url, fetchImpl);
      if (found) break;
    }
    if (!found) {
      throw new Error(
        `Cannot find the metadata of the OAuth issuer ${issuer} (tried ${discoveryUrls(issuer).join(", ")}). Check the issuer, or declare where its keys are (--oauth-jwks-uri).`,
      );
    }
    // The metadata must say it is the issuer asked for: otherwise a document fetched from one place could name another provider's keys.
    if (typeof found.issuer !== "string" || found.issuer.replace(/\/+$/, "") !== issuer) {
      throw new Error(`The metadata found for ${issuer} names another issuer (${String(found.issuer)}): refusing it.`);
    }
    if (typeof found.jwks_uri !== "string")
      throw new Error(`The metadata of ${issuer} has no jwks_uri: declare where its keys are (--oauth-jwks-uri).`);
    requireHttps(found.jwks_uri, "The JWKS address of the issuer");
    jwksUri = found.jwks_uri;
  }
  const keys = createRemoteJWKSet(new URL(jwksUri), {
    timeoutDuration: 5000,
    cooldownDuration: config.jwksCooldownMs,
    cacheMaxAge: 10 * 60_000,
  });
  const resourceUrl = new URL(config.resource);
  const metadataPath = `/.well-known/oauth-protected-resource${resourceUrl.pathname === "/" ? "" : resourceUrl.pathname}`;
  const metadataUrl = `${resourceUrl.origin}${metadataPath}`;

  return {
    config,
    metadataUrl,
    metadata: () => ({
      resource: config.resource,
      authorization_servers: [issuer],
      ...(config.scopes.length ? { scopes_supported: config.scopes } : {}),
      bearer_methods_supported: ["header"],
      resource_name: "help-me-ops",
    }),
    async verify(token) {
      let payload: JWTPayload;
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
  const issuer = one("--oauth-issuer") ?? env.OPS_MCP_OAUTH_ISSUER;
  if (!issuer) return undefined;
  const resource =
    one("--public-url") ??
    env.OPS_MCP_PUBLIC_URL ??
    (where.publicHosts[0] ? `https://${where.publicHosts[0]}${where.path}` : undefined);
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
  return {
    issuer,
    jwksUri: one("--oauth-jwks-uri") ?? env.OPS_MCP_OAUTH_JWKS_URI,
    audience: one("--oauth-audience") ?? env.OPS_MCP_OAUTH_AUDIENCE ?? resource,
    resource,
    scopes,
    identityClaims: claims.length ? claims : [...OAUTH_DEFAULTS.identityClaims],
    algorithms: algorithms.length ? algorithms : [...OAUTH_DEFAULTS.algorithms],
    clockToleranceSec: OAUTH_DEFAULTS.clockToleranceSec,
    jwksCooldownMs: OAUTH_DEFAULTS.jwksCooldownMs,
  };
}
