// Conformance: the server against node-oidc-provider, a reference implementation of OAuth 2 and OpenID
// Connect that is itself certified by the OpenID Foundation, in the two ways an access token reaches a
// resource server: a signed JWT (RFC 9068) checked against the provider's keys, and an opaque token
// the provider is asked about (RFC 7662). Nothing here is written to be passed by this server: the
// provider is somebody else's, with its own discovery, its own keys, its own tokens and its own
// introspection and revocation.
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { exportJWK, generateKeyPair } from "jose";
import Provider from "oidc-provider";
import { HTTP_DEFAULTS, startHttpServer } from "../src/http-server.ts";
import { createOAuthVerifier, OAUTH_DEFAULTS, OAuthError, type OAuthConfig } from "../src/oauth.ts";
import { openToolbox } from "../src/toolbox.ts";

const RESOURCE = "https://mcp.company.example/mcp";
const SECRET = "mcp-server-secret-mcp-server-secret";

async function certified(options: { format: "jwt" | "opaque"; ttl?: number; resource?: string | null }) {
  const pair = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...(await exportJWK(pair.privateKey)), kid: "conformance", alg: "RS256", use: "sig" };
  const server: Server = createServer();
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const issuer = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const provider = new Provider(issuer, {
    jwks: { keys: [jwk] },
    clients: [
      {
        client_id: "svc",
        client_secret: "svc-secret-svc-secret-svc-secret",
        grant_types: ["client_credentials"],
        redirect_uris: [],
        response_types: [],
        token_endpoint_auth_method: "client_secret_basic",
      },
      // the resource server itself: it asks the provider about tokens
      {
        client_id: "mcp-server",
        client_secret: SECRET,
        grant_types: ["client_credentials"],
        redirect_uris: [],
        response_types: [],
        token_endpoint_auth_method: "client_secret_basic",
      },
    ],
    scopes: ["mcp:tools", "other"],
    features: {
      clientCredentials: { enabled: true },
      introspection: { enabled: true, allowedPolicy: async () => true },
      revocation: { enabled: true },
      resourceIndicators: {
        enabled: true,
        ...(options.resource === null ? {} : { defaultResource: async () => options.resource ?? RESOURCE }),
        useGrantedResource: async () => true,
        getResourceServerInfo: async (_ctx: unknown, resource: string) => ({
          scope: "mcp:tools other",
          audience: resource,
          accessTokenTTL: options.ttl ?? 300,
          accessTokenFormat: options.format,
          ...(options.format === "jwt" ? { jwt: { sign: { alg: "RS256" } } } : {}),
        }),
      },
    },
  });
  provider.on("server_error", () => undefined);
  server.on("request", provider.callback());
  const basic = (id: string, secret: string) => `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
  return {
    issuer,
    async token(params: Record<string, string> = {}) {
      const response = await fetch(`${issuer}/token`, {
        method: "POST",
        headers: {
          authorization: basic("svc", "svc-secret-svc-secret-svc-secret"),
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ grant_type: "client_credentials", scope: "mcp:tools", ...params }),
      });
      const body = (await response.json()) as { access_token?: string };
      assert.ok(body.access_token, JSON.stringify(body));
      return body.access_token;
    },
    async revoke(token: string) {
      await fetch(`${issuer}/token/revocation`, {
        method: "POST",
        headers: {
          authorization: basic("svc", "svc-secret-svc-secret-svc-secret"),
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ token }),
      });
    },
    close: () => new Promise<void>((done) => (server.closeAllConnections(), server.close(() => done()))),
  };
}

const config = (issuer: string, extra: Partial<OAuthConfig> = {}): OAuthConfig => ({
  issuer,
  audience: RESOURCE,
  resource: RESOURCE,
  scopes: ["mcp:tools"],
  identityClaims: [...OAUTH_DEFAULTS.identityClaims],
  algorithms: [...OAUTH_DEFAULTS.algorithms],
  clockToleranceSec: 0,
  jwksCooldownMs: 0,
  allowNoAudience: false,
  introspectionCacheMs: 0,
  ...extra,
});
const introspect = { clientId: "mcp-server", clientSecret: SECRET, mode: "auto" as const };
const refused = async (verifier: { verify(t: string): Promise<unknown> }, token: string, status = 401) => {
  await assert.rejects(
    verifier.verify(token),
    (error: unknown) => error instanceof OAuthError && error.status === status,
  );
};

test("conformance: a JWT access token (RFC 9068) from a certified provider is checked against its keys, found by its discovery", async () => {
  const idp = await certified({ format: "jwt" });
  try {
    const verifier = await createOAuthVerifier(config(idp.issuer));
    assert.match(verifier.jwksUri ?? "", /\/jwks$/);
    const token = await idp.token();
    assert.equal(token.split(".").length, 3);
    assert.deepEqual(await verifier.verify(token), { identity: "oauth:svc", scopes: ["mcp:tools"] });
    // a scope it has, and one it does not
    assert.equal((await verifier.verify(await idp.token({ scope: "mcp:tools other" }))).scopes.length, 2);
    await assert.rejects(
      createOAuthVerifier(config(idp.issuer, { scopes: ["admin"] })).then((v) => v.verify(token)),
      (e: unknown) => e instanceof OAuthError && e.status === 403,
    );
    // a token for another resource is a token for somebody else
    await refused(verifier, await idp.token({ resource: "https://other.example/api" }));
  } finally {
    await idp.close();
  }
});

test("conformance: an opaque access token is asked about (RFC 7662), the endpoint found by the provider's discovery", async () => {
  const idp = await certified({ format: "opaque" });
  try {
    const verifier = await createOAuthVerifier(config(idp.issuer, { introspection: introspect }));
    assert.match(verifier.introspectionUrl ?? "", /\/token\/introspection$/);
    const token = await idp.token();
    assert.equal(token.split(".").length, 1, "it is not a JWT");
    assert.deepEqual(await verifier.verify(token), { identity: "oauth:svc", scopes: ["mcp:tools"] });
    await refused(verifier, await idp.token({ resource: "https://other.example/api" }));
    await refused(verifier, "not-a-token-the-provider-knows");
    // without the means to ask, an opaque token is nothing
    const blind = await createOAuthVerifier(config(idp.issuer, { jwksUri: `${idp.issuer}/jwks` }));
    await refused(blind, token);
  } finally {
    await idp.close();
  }
});

test("conformance: an opaque token that is revoked or expired stops, at once when nothing is cached", async () => {
  const idp = await certified({ format: "opaque", ttl: 1 });
  try {
    const verifier = await createOAuthVerifier(config(idp.issuer, { introspection: introspect }));
    const revoked = await idp.token();
    assert.ok((await verifier.verify(revoked)).identity);
    await idp.revoke(revoked);
    await refused(verifier, revoked);
    const aging = await idp.token();
    assert.ok((await verifier.verify(aging)).identity);
    await new Promise((done) => setTimeout(done, 1300));
    await refused(verifier, aging);
  } finally {
    await idp.close();
  }
});

test("conformance: a JWT is checked here, so expiry is honoured but a revocation is only seen when it expires", async () => {
  const idp = await certified({ format: "jwt", ttl: 2 });
  try {
    const verifier = await createOAuthVerifier(config(idp.issuer));
    const token = await idp.token();
    await idp.revoke(token);
    assert.ok((await verifier.verify(token)).identity, "the limit of a signed token: nobody was asked");
    await new Promise((done) => setTimeout(done, 2300));
    await refused(verifier, token);
  } finally {
    await idp.close();
  }
});

test("conformance: a token that says nothing about who it is for is refused, unless the provider serves one resource only", async () => {
  const idp = await certified({ format: "opaque", resource: null });
  try {
    const token = await idp.token();
    const strict = await createOAuthVerifier(config(idp.issuer, { introspection: introspect }));
    await refused(strict, token);
    const lax = await createOAuthVerifier(config(idp.issuer, { introspection: introspect, allowNoAudience: true }));
    assert.equal((await lax.verify(token)).identity, "oauth:svc");
  } finally {
    await idp.close();
  }
});

test("conformance: when the provider cannot be asked, the answer is 'try again', not 'your token is bad'; cached keys keep JWTs working", async () => {
  const jwtIdp = await certified({ format: "jwt" });
  const opaqueIdp = await certified({ format: "opaque" });
  try {
    const jwtVerifier = await createOAuthVerifier(config(jwtIdp.issuer));
    const jwt = await jwtIdp.token();
    assert.ok((await jwtVerifier.verify(jwt)).identity);
    const opaqueVerifier = await createOAuthVerifier(config(opaqueIdp.issuer, { introspection: introspect }));
    const opaque = await opaqueIdp.token();
    assert.ok((await opaqueVerifier.verify(opaque)).identity);
    await jwtIdp.close();
    await opaqueIdp.close();
    assert.ok((await jwtVerifier.verify(jwt)).identity, "a JWT is checked here, with the keys already fetched");
    await refused(opaqueVerifier, opaque, 503);
    // this server's own credentials being wrong is the operator's problem, also not a 401 for the person
    const idp = await certified({ format: "opaque" });
    try {
      const wrong = await createOAuthVerifier(
        config(idp.issuer, { introspection: { ...introspect, clientSecret: "wrong-wrong-wrong-wrong-wrong" } }),
      );
      await refused(wrong, await idp.token(), 503);
    } finally {
      await idp.close();
    }
  } finally {
    await jwtIdp.close().catch(() => undefined);
    await opaqueIdp.close().catch(() => undefined);
  }
});

test("conformance: a good answer is kept for a moment, a bad one for less, so a flood does not become a flood of questions", async () => {
  const idp = await certified({ format: "opaque" });
  try {
    let asked = 0;
    const counting: typeof fetch = (input, init) => {
      if (String(input).includes("/introspection")) asked++;
      return fetch(input, init);
    };
    const verifier = await createOAuthVerifier(
      config(idp.issuer, { introspection: introspect, introspectionCacheMs: 60_000 }),
      counting,
    );
    const token = await idp.token();
    for (let i = 0; i < 5; i++) await verifier.verify(token);
    assert.equal(asked, 1);
    for (let i = 0; i < 5; i++) await refused(verifier, "garbage-token");
    assert.equal(asked, 2, "one question for the bad token, then the answer is remembered");
    // a token the provider says is expiring now is not kept past it
    assert.ok(verifier.introspectionUrl);
  } finally {
    await idp.close();
  }
});

test("conformance: through the whole server, with the real client, an opaque token and a revoked one", async () => {
  const idp = await certified({ format: "opaque" });
  const running = await startHttpServer(await openToolbox(resolve("examples/my-workspace")), {
    ...HTTP_DEFAULTS,
    port: 0,
    tokens: [],
    noAuth: false,
    publicHosts: [],
    oauth: await createOAuthVerifier(config(idp.issuer, { introspection: introspect })),
    log: () => undefined,
  });
  try {
    const token = await idp.token();
    const client = new Client({ name: "t", version: "0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(running.url), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    assert.equal((await client.listTools()).tools.length, 12);
    await client.close();
    await idp.revoke(token);
    const again = await fetch(running.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } },
      }),
    });
    assert.equal(again.status, 401);
    await idp.close();
    const down = await fetch(running.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${await Promise.resolve("another-opaque-token")}`,
      },
      body: "{}",
    });
    assert.equal(down.status, 503, "the provider is gone: try again, not a refusal");
    assert.equal(down.headers.get("retry-after"), "5");
  } finally {
    await running.close();
    await idp.close().catch(() => undefined);
  }
});
