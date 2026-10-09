// Checks the whole "sign in with the company login" path against the demo Keycloak of compose.yml
// (docker compose --profile keycloak up -d --build keycloak help-me-ops-oauth): a client registers
// itself, the person signs in (alice/alice) with PKCE, and the token is used on the MCP server.
// It is what an MCP client does for you in a browser, headless.
//   npm run keycloak:check
import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const issuer = process.env.KEYCLOAK_ISSUER ?? "http://localhost:8080/realms/ops";
const server = process.env.MCP_URL ?? "http://localhost:8809/mcp";
const callback = "http://localhost:12345/callback";
const cookies = new Map<string, string>();

/** One request, no redirect followed, cookies kept by hand (the browser's job). */
async function call(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (cookies.size) headers.set("cookie", [...cookies].map(([k, v]) => `${k}=${v}`).join("; "));
  const response = await fetch(url, { ...init, headers, redirect: "manual" });
  for (const line of response.headers.getSetCookie()) {
    const [pair = ""] = line.split(";");
    const at = pair.indexOf("=");
    cookies.set(pair.slice(0, at), pair.slice(at + 1));
  }
  return { status: response.status, location: response.headers.get("location") ?? "", body: await response.text() };
}
const decode = (text: string) => text.replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&#x2F;", "/");
const step = (text: string) => console.log(`✔ ${text}`);

// 1. a client registers itself, as an MCP client does when the provider allows it
const registered = await fetch(`${issuer}/clients-registrations/openid-connect`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    client_name: "keycloak-check",
    redirect_uris: [callback],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  }),
});
if (!registered.ok)
  throw new Error(`The provider refused the registration (${registered.status}): is the demo Keycloak up?`);
const clientId = ((await registered.json()) as { client_id: string }).client_id;
step(`registered a client (${clientId})`);

// 2. the person signs in, with PKCE
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const authorize = `${issuer}/protocol/openid-connect/auth?${new URLSearchParams({
  client_id: clientId,
  response_type: "code",
  redirect_uri: callback,
  scope: "openid",
  code_challenge: challenge,
  code_challenge_method: "S256",
  state: "check",
  resource: server,
})}`;
let page = await call(authorize);
const login = /<form[^>]*id="kc-form-login"[^>]*action="([^"]+)"/.exec(page.body)?.[1];
if (!login) throw new Error("No login form: the provider did not show one.");
page = await call(decode(login), {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ username: "alice", password: "alice", credentialId: "" }),
});
// a dynamically registered client asks for the person's consent
for (let i = 0; i < 3 && page.status === 200 && /name="accept"/.test(page.body); i++) {
  const action = decode(/<form[^>]*action="([^"]+)"/.exec(page.body)![1]!);
  const fields = new URLSearchParams();
  for (const m of page.body.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g))
    fields.set(m[1]!, decode(m[2]!));
  fields.set("accept", "Yes");
  page = await call(action, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: fields,
  });
}
const code = new URL(page.location || "http://none").searchParams.get("code");
if (!code) throw new Error(`The sign-in gave no code (status ${page.status}).`);
step("alice signed in");

// 3. the code becomes an access token
const tokenResponse = await fetch(`${issuer}/protocol/openid-connect/token`, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: callback,
    client_id: clientId,
    code_verifier: verifier,
  }),
});
const token = ((await tokenResponse.json()) as { access_token?: string }).access_token;
if (!token) throw new Error("The provider issued no token.");
const claims = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()) as Record<string, unknown>;
step(
  `got a token: iss ${String(claims.iss)}, aud ${JSON.stringify(claims.aud)}, scope "${String(claims.scope)}", user ${String(claims.preferred_username)}`,
);

// 4. the token is used on the MCP server, which asks the provider's keys and not the provider
const client = new Client({ name: "keycloak-check", version: "0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(server), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  }),
);
const tools = (await client.listTools()).tools.length;
const found = (await client.callTool({
  name: "searchSource",
  arguments: { env: "prod", source: "app-logs", query: "OOMKilled" },
})) as { content: { text: string }[] };
await client.close();
step(
  `the MCP server accepted it: ${tools} tools, ${(JSON.parse(found.content[0]!.text) as { evidence: unknown[] }).evidence.length} pieces of evidence`,
);
const refused = await fetch(server, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
step(
  `and refuses a request with no token (${refused.status}), pointing at ${refused.headers.get("www-authenticate")?.match(/resource_metadata="([^"]+)"/)?.[1]}`,
);
