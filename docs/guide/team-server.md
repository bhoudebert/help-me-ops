# One server for the team (MCP over HTTP)

By default the MCP server runs **on each person's machine**: the AI client starts it, and it needs a clone, Node and the credentials of every system the workspace reads. For a team there is a second way: **run it once, on a server, and give people a URL and a token**. The credentials live on that server only; a laptop holds a token that you can revoke by removing it.

```
 laptop: Claude Code, Codex, Copilot ──HTTPS + token──▶  help-me-ops (mcp:http)  ──▶ logs, databases, APIs
 holds: a URL and a token                                holds: the workspace and the credentials
```

The tools are the same, read-only like everywhere, with the same mask, strict mode and checked conclusion. What is new is that **the server is on a URL, so it needs the protections a stdio server never needed**: a token, TLS, a limit on who it answers. Read [what it does and does not do](#what-it-does-and-does-not-do) before you put one near production.

## Try it on your machine

```bash
# a token for yourself
npm run ops -- token alice
#   stdout:  alice:sha256:9f2c…   <- the line for the server: only a hash
#   terminal: the secret itself, shown once   <- what you give to alice (here, yourself)

OPS_MCP_TOKENS="alice:sha256:9f2c…" npm run mcp:http -- --workspace examples/my-workspace
# help-me-ops MCP server on http://127.0.0.1:8808/mcp: workspace …
```

It listens on `127.0.0.1:8808`, path `/mcp`. Point a client at it:

::: code-group

```bash [Claude Code]
claude mcp add --transport http help-me-ops http://127.0.0.1:8808/mcp \
  --header "Authorization: Bearer Xk3..."
```

```json [.mcp.json]
{
  "mcpServers": {
    "help-me-ops": {
      "type": "http",
      "url": "http://127.0.0.1:8808/mcp",
      "headers": { "Authorization": "Bearer ${HELP_ME_OPS_TOKEN}" }
    }
  }
}
```

```json [.vscode/mcp.json (Copilot)]
{
  "servers": {
    "help-me-ops": {
      "type": "http",
      "url": "http://127.0.0.1:8808/mcp",
      "headers": { "Authorization": "Bearer ${input:help-me-ops-token}" }
    }
  },
  "inputs": [
    { "id": "help-me-ops-token", "type": "promptString", "password": true, "description": "help-me-ops token" }
  ]
}
```

:::

How a client sends a header, and whether it can reach a remote server at all, depends on the client and its version: check its documentation. A client that signs in through OAuth needs the [company login setup](#sign-in-with-the-company-login-oauth-2) instead of a token.

For a quick look **on this machine only**, `--no-auth` serves without a token, and refuses to when the address is not a loopback one.

## Put it on a server

1. **The workspace and the credentials on the server**, like for a local run: the folder (in its own repository), and the variables the addons read (`SHOPDB_PROD_URL`, `DD_API_KEY`...) in a `.env` the server can read and nobody else. Read-only accounts, as ever.
2. **A token per person**: `npm run ops -- token <name>` for each. It prints two things: the **line for the server** (`name:sha256:<hash>`, on the standard output, to add to `OPS_MCP_TOKENS`, comma-separated, or to a tokens file) and the **secret**, once, on the terminal, to hand to that person. The server keeps **only the hash**, like a password file: someone who reads its configuration can check a token but cannot use it, and nothing anywhere stores the secret, so a lost one is replaced, not recovered. The name is the person's identity in the logs. To revoke someone, remove their line and restart. (`--plain` prints `name:<token>` instead, which works and leaves the token readable in the file; the server says so at start.)
3. **Start it behind TLS.** The server speaks plain HTTP on the address you give it; put a reverse proxy in front for HTTPS, and tell the server the name people use:

```bash
OPS_MCP_TOKENS="alice:sha256:…,bob:sha256:…" npm run mcp:http -- --workspace /srv/ops \
  --host 127.0.0.1 --port 8808 --public-host mcp.company.example
```

```
# Caddy: automatic certificates
mcp.company.example {
  reverse_proxy 127.0.0.1:8808
}
```

`--public-host` is the name in the `Host` header the proxy forwards (add the port if the proxy uses a non-standard one). Without it, a server that listens beyond loopback **refuses to start**. The server can also serve TLS itself (`--tls-cert`, `--tls-key`), when there is no proxy.

4. **Keep it running** with your usual service manager, for example a systemd unit:

```ini
[Service]
User=helpmeops
WorkingDirectory=/opt/help-me-ops
EnvironmentFile=/etc/help-me-ops.env       # OPS_MCP_TOKENS=…, the credentials
ExecStart=/usr/bin/node src/mcp-http.ts --workspace /srv/ops --public-host mcp.company.example
Restart=on-failure
```

5. **People connect** with the URL (`https://mcp.company.example/mcp`) and their token, as above.

`GET /healthz` answers `{"ok":true}` with no token, for a load balancer's check.

## With Docker

The repository has a `Dockerfile` and a `compose.yml`. The image holds the server and the shipped addons; **your workspace is mounted, not baked in**, so config, playbooks, knowledge and your own addons stay with you, and the image is the same for everyone.

```bash
# 1. a token per person: the line for the server goes to the secret file, the secret is shown
#    on the terminal, once, for you to hand to alice
npm run ops -- token alice >> ops-tokens.txt

# 2. the credentials your sources read (the ${VAR} of ops.config.json), not committed
printf 'SHOPDB_PROD_URL=postgres://readonly:…@db.internal/shop\n' > server.env

# 3. start it, on your workspace (the demo workspace by default)
OPS_WORKSPACE_DIR=./my-ops OPS_PUBLIC_HOST=localhost:8808 docker compose up -d --build
curl http://localhost:8808/healthz        # {"ok":true}
```

`compose.yml` publishes the port on **127.0.0.1 only**, mounts the workspace **read-only** at `/workspace`, gives the tokens as a secret, runs with a read-only filesystem, no capabilities and `no-new-privileges`, and has a health check. For a team, change the published address only when a proxy with TLS is in front, and set `OPS_PUBLIC_HOST` to the name people use (`mcp.company.example`).

The container is configured by environment (the flags still win):

| Variable                                       | What                                                               | Default                   |
| ---------------------------------------------- | ------------------------------------------------------------------ | ------------------------- |
| `OPS_WORKSPACE`                                | the workspace folder inside the container                          | `/workspace`              |
| `OPS_MCP_HOST`, `OPS_MCP_PORT`, `OPS_MCP_PATH` | where it listens                                                   | `0.0.0.0`, `8808`, `/mcp` |
| `OPS_MCP_PUBLIC_HOSTS`                         | the names it is reached by, comma-separated; required off loopback | none                      |
| `OPS_MCP_TOKENS`                               | `name:sha256:<hash>` entries (or `name:<token>`), comma-separated  | none                      |
| `OPS_MCP_TOKENS_FILE`                          | a file of such lines (a container secret)                          | none                      |

Things to know:

- **Your own addons** go in the workspace's `addons/` folder, like anywhere. An addon that needs a package (a database driver such as `pg`) finds it in the workspace's own `node_modules`: run `npm install` where the workspace lives, and it is mounted with the rest.
- **The `git` addon** needs the `git` program, which the slim image does not have: build your own image `FROM help-me-ops` with `git` installed, if you use it.
- **Updating** is `docker compose up -d --build` after a `git pull`. No image is published to a registry yet.
- **Logs** (`docker compose logs`) hold the audit lines, one JSON object per call.

## Sign in with the company login (OAuth 2)

Static tokens suit a few people. A company usually wants its people to sign in with the login it already has (Entra ID, Okta, Keycloak, Auth0...), with a second factor, and to lose access in one place when they leave. help-me-ops supports that as an **OAuth 2 resource server**: it does not log anyone in, it **checks the tokens your identity provider issues** and tells clients which provider to ask.

```
 person ──signs in──▶ identity provider ──access token──▶ client ──token──▶ help-me-ops
                       (your company's)                                    checks signature, issuer,
                                                                           audience, expiry, scopes
```

It is configuration only. Two things say where the provider is:

```bash
# discovery: the server reads the provider's published metadata and finds its keys
OPS_MCP_OAUTH_ISSUER=https://login.company.example/realms/ops \
OPS_MCP_PUBLIC_URL=https://mcp.company.example/mcp \
OPS_MCP_PUBLIC_HOSTS=mcp.company.example \
  npm run mcp:http -- --workspace /srv/ops

# or declared by hand, when the server cannot reach the provider's metadata
OPS_MCP_OAUTH_ISSUER=https://login.company.example/realms/ops \
OPS_MCP_OAUTH_JWKS_URI=https://login.company.example/realms/ops/protocol/openid-connect/certs \
  …
```

| Variable (or flag)                                         | What                                                                             | Default                               |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------- |
| `OPS_MCP_OAUTH_ISSUER` (`--oauth-issuer`)                  | the provider's issuer URL, exactly as in the `iss` of its tokens; turns OAuth on | none                                  |
| `OPS_MCP_PUBLIC_URL` (`--public-url`)                      | this server's address as clients reach it (https)                                | `https://<first public host><path>`   |
| `OPS_MCP_OAUTH_JWKS_URI` (`--oauth-jwks-uri`)              | where the provider's public keys are, instead of discovery                       | found by discovery                    |
| `OPS_MCP_OAUTH_AUDIENCE` (`--oauth-audience`)              | what a token must be issued for (`aud`)                                          | the public URL                        |
| `OPS_MCP_OAUTH_SCOPES` (`--oauth-scope`)                   | scopes a token must carry, all of them                                           | none                                  |
| `OPS_MCP_OAUTH_IDENTITY_CLAIMS` (`--oauth-identity-claim`) | claims naming the person, tried in order                                         | `preferred_username, email, upn, sub` |
| `OPS_MCP_OAUTH_ALGORITHMS` (`--oauth-algorithm`)           | signature algorithms accepted                                                    | `RS256, PS256, ES256`                 |

**What it checks, on every request:** the signature against the provider's keys (fetched once, refreshed when the provider rotates them), the issuer, the **audience**, that the token has not expired, and the scopes. `none` and shared-secret (`HS…`) algorithms are refused outright. Static tokens keep working beside it, for a pipeline or a service account.

**What a client sees:** a request without a token gets `401` with a `WWW-Authenticate` header pointing at `/.well-known/oauth-protected-resource`, which says which provider to ask. A client that speaks MCP's OAuth flow (Claude Code does, through `/mcp` and a browser sign-in) takes it from there: it opens the provider's login, gets a token and sends it.

**What you set up at the provider**, whatever its name for it:

1. an application or API for this server, with an **identifier that becomes the `aud` of its tokens** (give the same to `--oauth-audience`, or use the public URL as the identifier);
2. a way for MCP clients to be known to the provider: **dynamic client registration** if it offers it, or a registered client whose id you give people (what a client accepts depends on the client; check `claude mcp add --help` and your provider's documentation);
3. optionally a scope such as `mcp:tools` that you require with `--oauth-scope`;
4. short access-token lifetimes, since a token stays good until it expires.

Starting points, **written from the providers' documented formats and not tried against a real one**:

| Provider           | Issuer (`OPS_MCP_OAUTH_ISSUER`)                           | Audience                               | Scope claim |
| ------------------ | --------------------------------------------------------- | -------------------------------------- | ----------- |
| Keycloak           | `https://<host>/realms/<realm>`                           | an audience mapper on the client scope | `scope`     |
| Microsoft Entra ID | `https://login.microsoftonline.com/<tenant-id>/v2.0`      | the application's id or `api://<id>`   | `scp`       |
| Okta               | `https://<org>.okta.com/oauth2/<authorization-server-id>` | the authorization server's audience    | `scp`       |
| Auth0              | `https://<tenant>.auth0.com/`                             | the API identifier                     | `scope`     |

The server **refuses to start** if it cannot reach the provider's metadata (and no `--oauth-jwks-uri` is given), if that metadata names another issuer, or if the issuer, keys or public URL are not https (this machine excepted).

**Not supported yet:** providers that issue **opaque** access tokens (not JWTs), which would need a call to the provider per request (token introspection); a list of revoked tokens (keep lifetimes short); permissions per person from groups or roles in the token.

## What it does and does not do

**It does:**

- refuse any request without a valid token (`401`), compared in constant time; a session belongs to the person who opened it, and another token cannot use its id;
- **refuse to start** without tokens (except `--no-auth` on loopback), and refuse to listen beyond loopback without a `--public-host`;
- check the `Host` and refuse any request that carries an `Origin`, against a web page reaching a local server through a name of its own (DNS rebinding);
- give **each session its own ledger**: a conclusion can only cite what that session read;
- cap a request at 1 MB, sessions at 100 and close idle ones after 30 minutes;
- write **one JSON line per event** on the error output: sessions opening and closing, and each tool call with the time, the identity, the session, the tool, the app, the environment, the source, the duration and whether it worked. **Not** the question and **not** the evidence, which can hold personal data.

**It does not (yet):**

- **Per-person permissions.** A token reads everything the workspace reads. What a person may see is decided by who gets a token, and by the read-only accounts behind the sources.
- **Rate limits** beyond the caps above, or **token rotation** (remove, add, restart).
- **Hide anything from the AI provider.** What a tool returns still goes to the provider of the client the person uses: the [personal-data page](/privacy) applies as ever, and the mask and strict mode are enforced here, once, for everybody.

A leaked token reads production until it is removed: treat tokens like passwords, and keep the server patched. Design and alternatives: [ADR 0015](https://github.com/bhoudebert/help-me-ops/blob/main/docs/adr/0015-one-mcp-server-over-http-for-a-team.md).
