// OAuth 2 for the MCP server over HTTP (ADR 0017), against a fake identity
// provider on a local port: its metadata, its keys, and tokens it signs.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { exportJWK, generateKeyPair, SignJWT, type JWK, type CryptoKey } from "jose";
import { HTTP_DEFAULTS, hashToken, newToken, startHttpServer, type HttpOptions } from "../src/http-server.ts";
import {
  createOAuthVerifier,
  discoveryUrls,
  explainToken,
  OAUTH_DEFAULTS,
  oauthConfigFrom,
  type OAuthConfig,
} from "../src/oauth.ts";
import { openToolbox } from "../src/toolbox.ts";

const workspace = resolve("examples/my-workspace");

/** A provider: metadata at the usual places, a set of keys we can change, and tokens signed with them. */
async function provider(options: { discovery?: boolean; trailingSlash?: boolean } = {}) {
  const pair = await generateKeyPair("RS256");
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const keys: JWK[] = [jwk];
  let issuer = "";
  const server: Server = createServer((req, res) => {
    const json = (body: unknown) =>
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (options.discovery !== false && req.url === "/realm/.well-known/openid-configuration")
      return json({ issuer, jwks_uri: `http://127.0.0.1:${(server.address() as { port: number }).port}/realm/keys` });
    if (req.url === "/realm/keys") return json({ keys });
    res.writeHead(404).end();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  issuer = `http://127.0.0.1:${(server.address() as { port: number }).port}/realm${options.trailingSlash ? "/" : ""}`;
  const sign = async (
    claims: Record<string, unknown>,
    extra: {
      key?: CryptoKey;
      kid?: string;
      alg?: string;
      expires?: string | number;
      issuer?: string;
      audience?: string;
    } = {},
  ) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: extra.alg ?? "RS256", kid: extra.kid ?? "k1" })
      .setIssuer(extra.issuer ?? issuer)
      .setAudience(extra.audience ?? "https://mcp.company.example/mcp")
      .setIssuedAt()
      .setExpirationTime(extra.expires ?? "5m")
      .sign(extra.key ?? pair.privateKey);
  return {
    issuer,
    keys,
    pair,
    sign,
    close: () => new Promise<void>((done) => (server.closeAllConnections(), server.close(() => done()))),
  };
}

const config = (issuer: string, extra: Partial<OAuthConfig> = {}): OAuthConfig => ({
  issuer,
  audience: "https://mcp.company.example/mcp",
  resource: "https://mcp.company.example/mcp",
  scopes: [],
  identityClaims: [...OAUTH_DEFAULTS.identityClaims],
  algorithms: [...OAUTH_DEFAULTS.algorithms],
  clockToleranceSec: 30,
  jwksCooldownMs: 0,
  allowNoAudience: false,
  ...extra,
});

async function serve(oauth: OAuthConfig, extra: Partial<HttpOptions> = {}) {
  const events: Record<string, unknown>[] = [];
  const running = await startHttpServer(await openToolbox(workspace), {
    ...HTTP_DEFAULTS,
    port: 0,
    tokens: [],
    noAuth: false,
    publicHosts: [],
    oauth: await createOAuthVerifier(oauth),
    log: (e) => events.push(e),
    ...extra,
  });
  return { running, events };
}

const call = (
  url: string,
  token: string | undefined,
  body: object = {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } },
  },
) =>
  fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

test("oauth: a token from the provider opens a session, and the person is the identity in the log", async () => {
  const idp = await provider();
  const { running, events } = await serve(config(idp.issuer));
  try {
    const token = await idp.sign({ preferred_username: "alice@company.example", scope: "openid mcp:read" });
    const client = new Client({ name: "t", version: "0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(running.url), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    assert.equal((await client.listTools()).tools.length, 12);
    await client.callTool({ name: "scope", arguments: {} });
    assert.ok(
      events.some((e) => e.event === "session" && e.action === "open" && e.identity === "oauth:alice@company.example"),
    );
    assert.ok(events.some((e) => e.event === "tool" && e.identity === "oauth:alice@company.example"));
    assert.ok(!JSON.stringify(events).includes(token), "the token is never logged");
    await client.close();
  } finally {
    await running.close();
    await idp.close();
  }
});

test("oauth: a refusal says where the provider is told, and the server publishes it (RFC 9728)", async () => {
  const idp = await provider();
  const { running } = await serve(config(idp.issuer, { scopes: ["mcp:read"] }));
  try {
    const none = await call(running.url, undefined);
    assert.equal(none.status, 401);
    assert.equal(
      none.headers.get("www-authenticate"),
      'Bearer realm="help-me-ops", resource_metadata="https://mcp.company.example/.well-known/oauth-protected-resource/mcp"',
    );
    const bad = await call(running.url, "a.b.c");
    assert.equal(bad.status, 401);
    assert.match(bad.headers.get("www-authenticate")!, /error="invalid_token"/);
    // both addresses a client may ask, with no token
    for (const path of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const response = await fetch(new URL(path, running.url));
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        resource: "https://mcp.company.example/mcp",
        authorization_servers: [idp.issuer],
        scopes_supported: ["mcp:read"],
        bearer_methods_supported: ["header"],
        resource_name: "help-me-ops",
      });
    }
  } finally {
    await running.close();
    await idp.close();
  }
});

test("oauth: what is not a good token is refused, whatever it claims", async () => {
  const idp = await provider();
  const other = await generateKeyPair("RS256");
  const { running, events } = await serve(config(idp.issuer));
  try {
    const refused = async (label: string, token: string) => {
      const response = await call(running.url, token);
      assert.equal(response.status, 401, label);
      assert.match(response.headers.get("www-authenticate")!, /error="invalid_token"/, label);
    };
    await refused("expired", await idp.sign({ sub: "a" }, { expires: Math.floor(Date.now() / 1000) - 3600 }));
    await refused("another audience", await idp.sign({ sub: "a" }, { audience: "https://other.example/mcp" }));
    await refused("another issuer", await idp.sign({ sub: "a" }, { issuer: "https://evil.example/realm" }));
    await refused("signed by another key", await idp.sign({ sub: "a" }, { key: other.privateKey }));
    await refused("an unknown key id", await idp.sign({ sub: "a" }, { kid: "nope" }));
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const claims = {
      sub: "a",
      iss: idp.issuer,
      aud: "https://mcp.company.example/mcp",
      exp: Math.floor(Date.now() / 1000) + 300,
    };
    await refused("alg none", `${b64({ alg: "none", typ: "JWT" })}.${b64(claims)}.`);
    // HS256 with the provider's public key as the secret: the classic confusion attack
    const hs = await new SignJWT(claims)
      .setProtectedHeader({ alg: "HS256", kid: "k1" })
      .sign(new TextEncoder().encode(JSON.stringify(idp.keys[0])));
    await refused("HS256 with the public key as secret", hs);
    // no expiry at all
    const forever = await new SignJWT({ sub: "a" })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(idp.issuer)
      .setAudience("https://mcp.company.example/mcp")
      .sign(idp.pair.privateKey);
    await refused("no exp", forever);
    assert.ok(events.filter((e) => e.event === "auth" && e.ok === false).length >= 8);
    assert.ok(!JSON.stringify(events).includes("eyJ"), "no token in the log");
  } finally {
    await running.close();
    await idp.close();
  }
});

test("oauth: scopes a token must carry, in scope or scp, else 403 insufficient_scope", async () => {
  const idp = await provider();
  const { running } = await serve(config(idp.issuer, { scopes: ["mcp:read", "mcp:tools"] }));
  try {
    assert.equal(
      (await call(running.url, await idp.sign({ sub: "a", scope: "mcp:read mcp:tools extra" }))).status,
      200,
    );
    assert.equal((await call(running.url, await idp.sign({ sub: "b", scp: ["mcp:tools", "mcp:read"] }))).status, 200);
    const missing = await call(running.url, await idp.sign({ sub: "c", scope: "mcp:read" }));
    assert.equal(missing.status, 403);
    assert.match(missing.headers.get("www-authenticate")!, /error="insufficient_scope", scope="mcp:read mcp:tools"/);
    assert.equal((await call(running.url, await idp.sign({ sub: "d" }))).status, 403);
  } finally {
    await running.close();
    await idp.close();
  }
});

test("oauth: the identity is the first claim that names the person, made safe for a log", async () => {
  const idp = await provider();
  const { running, events } = await serve(config(idp.issuer));
  try {
    await call(running.url, await idp.sign({ email: "bob@company.example", sub: "u1" }));
    await call(running.url, await idp.sign({ sub: 'u-2\nfake log line {"event":1}' }));
    const opened = events.filter((e) => e.event === "session").map((e) => e.identity);
    assert.deepEqual(opened, ["oauth:bob@company.example", "oauth:u-2_fake_log_line___event__1_"]);
  } finally {
    await running.close();
    await idp.close();
  }
});

test("oauth: a session belongs to the person who opened it, whichever way they came in", async () => {
  const idp = await provider();
  const secret = newToken();
  const { running } = await serve(config(idp.issuer), { tokens: [{ name: "svc", hash: hashToken(secret) }] });
  try {
    const opened = await call(running.url, await idp.sign({ preferred_username: "alice" }));
    const id = opened.headers.get("mcp-session-id")!;
    assert.ok(id);
    const list = { jsonrpc: "2.0", id: 2, method: "tools/list" };
    const withSession = (token: string) =>
      fetch(running.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${token}`,
          "mcp-session-id": id,
        },
        body: JSON.stringify(list),
      });
    assert.equal((await withSession(await idp.sign({ preferred_username: "mallory" }))).status, 403);
    assert.equal((await withSession(secret)).status, 403, "a static token is another identity");
    assert.equal((await withSession(await idp.sign({ preferred_username: "alice" }))).status, 200);
    // the static token still opens its own
    assert.equal((await call(running.url, secret)).status, 200);
  } finally {
    await running.close();
    await idp.close();
  }
});

test("oauth: a key the provider adds later is found (rotation), and a declared JWKS address needs no discovery", async () => {
  const idp = await provider({ discovery: false });
  const verifierConfig = config(idp.issuer, { jwksUri: `${idp.issuer}/keys` });
  const { running } = await serve(verifierConfig);
  try {
    assert.equal((await call(running.url, await idp.sign({ sub: "a" }))).status, 200);
    const next = await generateKeyPair("RS256");
    idp.keys.push({ ...(await exportJWK(next.publicKey)), kid: "k2", alg: "RS256", use: "sig" });
    assert.equal(
      (await call(running.url, await idp.sign({ sub: "a" }, { key: next.privateKey, kid: "k2" }))).status,
      200,
    );
  } finally {
    await running.close();
    await idp.close();
  }
});

test("oauth: it fails closed at start: no metadata, the metadata of another issuer, plain http off this machine", async () => {
  const idp = await provider();
  const lying = await provider();
  try {
    await assert.rejects(
      createOAuthVerifier(config(`${idp.issuer}-missing`)),
      /Cannot find the metadata of the OAuth issuer/,
    );
    // a provider whose document names another issuer
    const wrong = await provider({ discovery: false });
    const doc = createServer((req, res) =>
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ issuer: "https://elsewhere.example", jwks_uri: `${wrong.issuer}/keys` })),
    );
    await new Promise<void>((done) => doc.listen(0, "127.0.0.1", done));
    const port = (doc.address() as { port: number }).port;
    await assert.rejects(
      createOAuthVerifier(config(`http://127.0.0.1:${port}`)),
      /names another issuer \(https:\/\/elsewhere\.example\): refusing it/,
    );
    doc.close();
    await wrong.close();
    await assert.rejects(createOAuthVerifier(config("http://idp.company.example/realm")), /must be https/);
    await assert.rejects(
      createOAuthVerifier(config("https://idp.company.example/realm", { jwksUri: "http://idp.company.example/keys" })),
      /JWKS address must be https/,
    );
    await assert.rejects(
      createOAuthVerifier(config("https://idp.company.example/realm", { resource: "http://mcp.company.example/mcp" })),
      /public URL of this server must be https/,
    );
    // and the server will not start with neither tokens nor a provider
    await assert.rejects(
      startHttpServer(await openToolbox(workspace), {
        ...HTTP_DEFAULTS,
        port: 0,
        tokens: [],
        noAuth: false,
        publicHosts: [],
        log: () => undefined,
      }),
      /or an OAuth issuer \(OPS_MCP_OAUTH_ISSUER\)/,
    );
  } finally {
    await idp.close();
    await lying.close();
  }
});

test("oauth: where a provider publishes its metadata, with a path or without", () => {
  assert.deepEqual(discoveryUrls("https://login.example.com"), [
    "https://login.example.com/.well-known/openid-configuration",
    "https://login.example.com/.well-known/oauth-authorization-server",
    "https://login.example.com/.well-known/oauth-authorization-server",
  ]);
  assert.deepEqual(discoveryUrls("https://idp.example.com/realms/ops/"), [
    "https://idp.example.com/realms/ops/.well-known/openid-configuration",
    "https://idp.example.com/.well-known/oauth-authorization-server/realms/ops",
    "https://idp.example.com/realms/ops/.well-known/oauth-authorization-server",
  ]);
});

test("oauth: the settings from flags and the environment; off without an issuer; no unsafe algorithm", () => {
  const where = { path: "/mcp", publicHosts: ["mcp.company.example"] };
  assert.equal(oauthConfigFrom([], {}, where), undefined);
  const fromEnv = oauthConfigFrom(
    [],
    {
      OPS_MCP_OAUTH_ISSUER: "https://idp.example/realm",
      OPS_MCP_OAUTH_SCOPES: "mcp:read, mcp:tools",
      OPS_MCP_OAUTH_IDENTITY_CLAIMS: "upn",
      OPS_MCP_OAUTH_JWKS_URI: "https://idp.example/keys",
    },
    where,
  )!;
  assert.deepEqual(
    [fromEnv.resource, fromEnv.audience, fromEnv.scopes, fromEnv.identityClaims, fromEnv.jwksUri, fromEnv.algorithms],
    [
      "https://mcp.company.example/mcp",
      "https://mcp.company.example/mcp",
      ["mcp:read", "mcp:tools"],
      ["upn"],
      "https://idp.example/keys",
      ["RS256", "PS256", "ES256"],
    ],
  );
  const flags = oauthConfigFrom(
    [
      "--oauth-issuer",
      "https://a.example",
      "--public-url",
      "https://b.example/ops",
      "--oauth-audience",
      "api://ops",
      "--oauth-scope",
      "x",
      "--oauth-scope",
      "y",
    ],
    { OPS_MCP_OAUTH_ISSUER: "https://env.example" },
    { path: "/mcp", publicHosts: [] },
  )!;
  assert.deepEqual(
    [flags.issuer, flags.resource, flags.audience, flags.scopes],
    ["https://a.example", "https://b.example/ops", "api://ops", ["x", "y"]],
  );
  assert.throws(
    () => oauthConfigFrom([], { OPS_MCP_OAUTH_ISSUER: "https://idp.example" }, { path: "/mcp", publicHosts: [] }),
    /needs this server's public URL/,
  );
  assert.throws(
    () =>
      oauthConfigFrom(
        [],
        { OPS_MCP_OAUTH_ISSUER: "https://idp.example", OPS_MCP_OAUTH_ALGORITHMS: "RS256,HS256" },
        where,
      ),
    /algorithm HS256 is not accepted/,
  );
  assert.throws(
    () => oauthConfigFrom([], { OPS_MCP_OAUTH_ISSUER: "https://idp.example", OPS_MCP_OAUTH_ALGORITHMS: "none" }, where),
    /not accepted/,
  );
});

test("oauth: an Auth0-shaped provider works: an issuer with a trailing slash, an audience list, a namespaced claim, a sub like auth0|id", async () => {
  const idp = await provider({ trailingSlash: true });
  assert.ok(idp.issuer.endsWith("/"), "the issuer ends with a slash, as Auth0's does");
  // written as the provider writes it: its metadata names it, and its tokens carry it
  const { running } = await serve(config(idp.issuer, { identityClaims: ["https://company.example/email", "sub"] }));
  try {
    const claims = {
      "https://company.example/email": "carol@company.example",
      scope: "openid profile",
      sub: "auth0|abc123",
    };
    const plain = await idp.sign(claims);
    const withUserinfo = await new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(idp.issuer)
      .setAudience(["https://mcp.company.example/mcp", "https://tenant.auth0.com/userinfo"])
      .setExpirationTime("5m")
      .sign(idp.pair.privateKey);
    for (const token of [plain, withUserinfo]) assert.equal((await call(running.url, token)).status, 200);
    // no claim for the person beyond the subject: the subject, made safe for a log
    const { running: second, events } = await serve(config(idp.issuer));
    try {
      await call(second.url, await idp.sign({ sub: "auth0|abc123" }));
      assert.ok(events.some((e) => e.event === "session" && e.identity === "oauth:auth0_abc123"));
    } finally {
      await second.close();
    }
    const metadata = (await (await fetch(new URL("/.well-known/oauth-protected-resource", running.url))).json()) as {
      authorization_servers: string[];
    };
    assert.deepEqual(metadata.authorization_servers, [idp.issuer], "clients are told the issuer exactly as written");
    // and the same provider written without the slash is refused, with the reason
    await assert.rejects(
      createOAuthVerifier(config(idp.issuer.replace(/\/$/, ""))),
      /differs only by a trailing slash: write the issuer exactly as the provider does/,
    );
  } finally {
    await running.close();
    await idp.close();
  }
});

test("oauth: an empty variable is not set, and an empty issuer is no OAuth", () => {
  const where = { path: "/mcp", publicHosts: [] };
  const cfg = oauthConfigFrom(
    [],
    {
      OPS_MCP_OAUTH_ISSUER: "https://idp.example",
      OPS_MCP_PUBLIC_URL: "https://mcp.company.example/mcp",
      OPS_MCP_OAUTH_AUDIENCE: "",
      OPS_MCP_OAUTH_JWKS_URI: "",
      OPS_MCP_OAUTH_SCOPES: "",
      OPS_MCP_OAUTH_IDENTITY_CLAIMS: "  ",
      OPS_MCP_OAUTH_ALGORITHMS: "",
    },
    where,
  )!;
  assert.equal(
    cfg.audience,
    "https://mcp.company.example/mcp",
    "an empty audience is the public URL, not an audience of nothing",
  );
  assert.equal(cfg.jwksUri, undefined);
  assert.deepEqual(cfg.scopes, []);
  assert.deepEqual(cfg.identityClaims, [...OAUTH_DEFAULTS.identityClaims]);
  assert.equal(oauthConfigFrom([], { OPS_MCP_OAUTH_ISSUER: "" }, where), undefined);
});

test("oauth: the server derives the name it is reached by from the public URL, and refuses off loopback without one", async () => {
  const idp = await provider();
  const run = (env: Record<string, string>) =>
    new Promise<{ code: number | null; err: string }>((done) => {
      const child = spawn("node", ["src/mcp-http.ts"], {
        env: { PATH: process.env.PATH!, OPS_WORKSPACE: workspace, OPS_MCP_HOST: "0.0.0.0", OPS_MCP_PORT: "0", ...env },
        stdio: ["ignore", "ignore", "pipe"],
      });
      let err = "";
      child.stderr.on("data", (d) => {
        err += d;
        if (/MCP server on/.test(err)) child.kill();
      });
      child.on("close", (code) => done({ code, err }));
    });
  try {
    const started = await run({ OPS_MCP_OAUTH_ISSUER: idp.issuer, OPS_MCP_PUBLIC_URL: "http://localhost:8809/mcp" });
    assert.match(started.err, /help-me-ops MCP server on http:\/\/0\.0\.0\.0:\d+\/mcp/);
    const refused = await run({ OPS_MCP_TOKENS: `a:sha256:${"0".repeat(64)}` });
    assert.equal(refused.code, 1);
    assert.match(refused.err, /say which name it is reached by \(--public-host/);
  } finally {
    await idp.close();
  }
});

test("oauth check: a token is explained check by check, so a misconfiguration is told, not guessed", () => {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const token = (claims: object) => `${b64({ alg: "RS256", kid: "k" })}.${b64(claims)}.sig`;
  const cfg = config("https://tenant.auth0.com/", { scopes: ["mcp:tools"] });
  const now = Date.now();
  const good = explainToken(
    cfg,
    token({
      iss: "https://tenant.auth0.com/",
      aud: ["https://mcp.company.example/mcp", "x"],
      exp: now / 1000 + 300,
      scope: "mcp:tools",
      sub: "auth0|1",
    }),
    now,
  );
  assert.equal(good.ok, true);
  assert.ok(good.lines.every((l) => l.startsWith("✔")));
  const bad = explainToken(
    cfg,
    token({ iss: "https://tenant.auth0.com", aud: "api://other", exp: now / 1000 - 60 }),
    now,
  );
  assert.equal(bad.ok, false);
  const text = bad.lines.join("\n");
  assert.match(
    text,
    /issuer: the token says "https:\/\/tenant\.auth0\.com", the server expects "https:\/\/tenant\.auth0\.com\/" \(they differ only by a trailing slash/,
  );
  assert.match(
    text,
    /audience: the token is for \["api:\/\/other"\], the server expects "https:\/\/mcp\.company\.example\/mcp"/,
  );
  assert.match(text, /expired 60 s ago/);
  assert.match(text, /scopes: missing mcp:tools \(the token has none\)/);
  assert.match(
    text,
    /no claim names the person \(tried preferred_username, email, upn, username, sub, client_id; the token has iss, aud, exp\): the token is accepted and the log says oauth:unknown/,
  );
  assert.match(explainToken(cfg, "opaque-token", now).lines[0]!, /not a JWT/);
  assert.match(
    explainToken(cfg, `${b64({ alg: "HS256" })}.${b64({})}.x`, now).lines[0]!,
    /algorithm HS256 is not accepted/,
  );
});
