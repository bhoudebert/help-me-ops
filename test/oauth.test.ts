// OAuth 2 for the MCP server over HTTP (ADR 0017), against a fake identity
// provider on a local port: its metadata, its keys, and tokens it signs.
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { exportJWK, generateKeyPair, SignJWT, type JWK, type CryptoKey } from "jose";
import { HTTP_DEFAULTS, hashToken, newToken, startHttpServer, type HttpOptions } from "../src/http-server.ts";
import { createOAuthVerifier, discoveryUrls, OAUTH_DEFAULTS, oauthConfigFrom, type OAuthConfig } from "../src/oauth.ts";
import { openToolbox } from "../src/toolbox.ts";

const workspace = resolve("examples/my-workspace");

/** A provider: metadata at the usual places, a set of keys we can change, and tokens signed with them. */
async function provider(options: { discovery?: boolean } = {}) {
  const pair = await generateKeyPair("RS256");
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const keys: JWK[] = [jwk];
  let issuer = "";
  const server: Server = createServer((req, res) => {
    const json = (body: unknown) =>
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (options.discovery !== false && req.url === "/realm/.well-known/openid-configuration")
      return json({ issuer, jwks_uri: `${issuer}/keys` });
    if (req.url === "/realm/keys") return json({ keys });
    res.writeHead(404).end();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  issuer = `http://127.0.0.1:${(server.address() as { port: number }).port}/realm`;
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
    // a token with no claim that names the person
    await refused("nobody", await idp.sign({ azp: "client" }));
    assert.ok(events.filter((e) => e.event === "auth" && e.ok === false).length >= 9);
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
