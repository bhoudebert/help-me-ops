# How the company login works, and how to set it up

You can let people sign in to the team server with the login your company already has (Auth0, Okta, Microsoft Entra ID, Keycloak, any provider that issues JWT access tokens), instead of handing out tokens. This page explains **what happens**, **what you have to do**, **how to use your own provider**, and **what to do when it does not work**. The short version of the server side is in [one server for the team](/team-server).

## Who does what

Four parties, and only one of them is help-me-ops:

| Party                     | What it is                         | What it does here                                                                                   |
| ------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| **The person**            | you, in a browser                  | signs in at the identity provider                                                                   |
| **The AI client**         | Claude Code, or any MCP client     | finds the provider, sends the person to its login page, keeps the tokens, sends them to help-me-ops |
| **The identity provider** | Auth0, Okta, Entra ID, Keycloak... | shows the login, checks the password and the second factor, **issues the tokens**                   |
| **help-me-ops**           | the MCP server                     | **checks every token** and serves the tools. It shows no login page and issues nothing.             |

help-me-ops is what the OAuth world calls a **resource server**. That is deliberate: your company already has a login, with its policies, and help-me-ops has no business storing passwords or running a second one.

## What happens, step by step

```
 person        AI client (Claude Code)            identity provider             help-me-ops
   │                  │                                  │                          │
   │                  │── 1. MCP request, no token ──────────────────────────────▶ │
   │                  │◀─ 401 "ask the provider at …" (address of its metadata) ───│
   │                  │── 2. who is the provider? ──────▶│  (its published metadata)│
   │                  │── 3. register me (if allowed) ──▶│                          │
   │◀─ 4. browser opens the login page ──────────────────│                          │
   │── signs in, accepts ───────────────────────────────▶│                          │
   │                  │◀─ 5. browser goes to http://localhost:PORT/callback?code=… ─│
   │                  │── 6. code + proof it is me ─────▶│                          │
   │                  │◀─ access token (minutes) + refresh token ──────────────────│
   │                  │── 7. MCP request + "Authorization: Bearer <access token>" ▶│
   │                  │                                  │      checks the token ───┤
   │                  │◀──────────────────────── tools answer ─────────────────────│
   │                  │── 8. later: access token expired → refresh token → new one ▶│ (provider)
```

1. **The first request has no token**, and help-me-ops answers `401` with a header that says where to learn who the provider is (`/.well-known/oauth-protected-resource`, which names the provider's issuer).
2. **The client asks the provider for its metadata** (the usual `/.well-known/openid-configuration`): where to log in, where to get tokens, where to register.
3. **It registers itself** at the provider, if the provider allows that (dynamic client registration). If not, you give the client an id that is already registered (see below).
4. **It opens your browser** on the provider's login page, with a one-time challenge (PKCE) so that only this client can finish the exchange.
5. **After you sign in and accept**, the provider sends your browser to an address on **your own machine** (`http://localhost:<port>/callback?code=…`). The client is listening there for a few seconds and takes the one-time **code**. The code never goes through help-me-ops.
6. **The client exchanges the code** at the provider for an **access token** (a short-lived signed JWT) and, when it asked to stay signed in (`offline_access`), a **refresh token**.
7. **Every MCP request carries the access token.** help-me-ops checks it on each one.
8. **When the access token expires** (minutes), the client uses the refresh token to get a new one, silently. That is why you sign in once, not every five minutes.

### What help-me-ops checks on every request

- **The signature**, against the provider's **public keys** (fetched from the provider, refreshed when it rotates them). Nothing signed by anyone else passes. `none` and shared-secret algorithms are refused outright.
- **The issuer** (`iss`): the token must come from the provider you configured, spelled exactly as you configured it.
- **The audience** (`aud`): the token must have been issued **for this server**. A token for another application is refused, even from your own provider.
- **The expiry** (`exp`): required, and not passed (30 seconds of clock tolerance).
- **The scopes**, if you require some.
- **A name for the person** (`preferred_username`, `email`, `upn`, `username`, `sub` or, for a machine, `client_id`, in that order, settable): it goes in the audit log as `oauth:alice@company.example`, and a session belongs to that person.

### Where things are kept

| Thing                           | Where                                                         | Lifetime                                                              |
| ------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| Your password and second factor | the provider only                                             | never seen by the client or by help-me-ops                            |
| The one-time code               | in the browser redirect, taken by the client                  | seconds, usable once                                                  |
| The access token                | the AI client, on your machine                                | minutes                                                               |
| The refresh token               | the AI client, on your machine (where, depends on the client) | days to never, set at the provider                                    |
| Anything of the above           | **help-me-ops: nothing**                                      | only the provider's public keys, cached, and open sessions, in memory |

So revoking a person is done **at the provider**; at worst their access token works until it expires, which is why access tokens are short.

### What it does not do

help-me-ops does **not** use your identity to read your logs and databases: it reads them with **its own** credentials (the ones on the server), and your token only proves to it who is asking. The token's audience is help-me-ops, so it is useless anywhere else, and help-me-ops never passes it on. Per-person access to the sources (asking a database as _you_) would need a token exchange, which is not built.

## What you have to do

1. **At the provider**, once: make an API (or "resource", or "application") for this server, whose **identifier** will be the audience of its tokens; decide how MCP clients are known to the provider (see "Registration" below); optionally define a scope such as `mcp:tools` to require; keep access tokens short.
2. **On the server**: tell help-me-ops who the provider is, in `.env` or the environment:

   ```bash
   OPS_MCP_OAUTH_ISSUER=https://tenant.auth0.com/            # exactly as the "iss" of its tokens
   OPS_MCP_PUBLIC_URL=https://mcp.company.example/mcp        # how people reach this server (TLS proxy)
   OPS_MCP_OAUTH_AUDIENCE=https://mcp.company.example/mcp    # only if the token's "aud" is something else
   ```

   then start it: `docker compose --profile oauth up -d --build help-me-ops-oauth`, or `npm run mcp:http`.

3. **Check it** before anyone connects: `npm run ops -- oauth check` (see "Checking it").
4. **On each laptop**: `claude mcp add --transport http ops https://mcp.company.example/mcp`, then `/mcp` → **Authenticate**. Nothing else: no token to copy.

### All the settings

| Variable (flag)                                                 | What                                                                                                                                       | Default                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `OPS_MCP_OAUTH_ISSUER` (`--oauth-issuer`)                       | the provider's issuer, **character for character** as in the `iss` of its tokens; turns OAuth on                                           | none                                                       |
| `OPS_MCP_PUBLIC_URL` (`--public-url`)                           | this server's address as clients reach it (https; the name in it is the one the `Host` check accepts)                                      | `https://<public host><path>`                              |
| `OPS_MCP_OAUTH_AUDIENCE` (`--oauth-audience`)                   | what a token must be issued for (`aud`)                                                                                                    | the public URL                                             |
| `OPS_MCP_OAUTH_JWKS_URI` (`--oauth-jwks-uri`)                   | where the provider's public keys are, **instead of** finding them from its metadata                                                        | found by discovery                                         |
| `OPS_MCP_OAUTH_SCOPES` (`--oauth-scope`)                        | scopes a token must carry, all of them (`scope` or `scp`)                                                                                  | none                                                       |
| `OPS_MCP_OAUTH_IDENTITY_CLAIMS` (`--oauth-identity-claim`)      | claims that name the person, tried in order; custom claims are fine                                                                        | `preferred_username, email, upn, username, sub, client_id` |
| `OPS_MCP_OAUTH_CLIENT_ID`, `_CLIENT_SECRET` (`_SECRET_FILE`)    | this server's own client at the provider: needed to **ask it about a token** (introspection, RFC 7662), for opaque tokens                  | none                                                       |
| `OPS_MCP_OAUTH_INTROSPECTION_URL` (`--oauth-introspection-url`) | where to ask, **instead of** the provider's metadata                                                                                       | found by discovery                                         |
| `OPS_MCP_OAUTH_INTROSPECT` (`--oauth-introspect`)               | `auto`: JWTs are checked here with the keys, anything else is asked about; `always`: every token is asked about (sees revocations at once) | `auto`                                                     |
| `OPS_MCP_OAUTH_ALLOW_NO_AUDIENCE` (`--oauth-allow-no-audience`) | accept a token that names no audience, when the provider serves only this server                                                           | off                                                        |
| `OPS_MCP_OAUTH_ALGORITHMS` (`--oauth-algorithm`)                | signature algorithms accepted                                                                                                              | `RS256, PS256, ES256`                                      |

An empty variable counts as not set. Static tokens (`OPS_MCP_TOKENS`) keep working beside OAuth, for a pipeline or a service account.

**Finding the keys, two ways.** By **discovery**: from the issuer, the server reads the provider's published metadata (OpenID Connect, then RFC 8414) and takes its `jwks_uri`; the metadata has to name the same issuer. Or **declared by hand** (`OPS_MCP_OAUTH_JWKS_URI`), when the server cannot reach the metadata (a firewall, an air gap). The server **refuses to start** when it can do neither, when the issuer is not what the metadata says, or when an address that carries keys or tokens is not https (this machine excepted).

## Using your own provider: what is guaranteed, what is not

OAuth 2 (RFC 6749) says how a client gets a token. It does **not** say what the token looks like, how a server that receives it checks it, how the server's clients are registered, or what its audience is: those are other standards (RFC 9068 and 7662 for the token, RFC 7591 for registration, RFC 8707 for the audience, RFC 8414 and OpenID Connect for discovery), each of which a provider may or may not implement. So "it is OAuth 2, it works" cannot be promised by anybody; what can be promised is **which standard ways of doing each part are supported**, and tested.

help-me-ops checks a token in the two standard ways, and picks by what arrives:

| The provider issues                                   | help-me-ops                                                                                                          | Revocation seen            |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **JWT access tokens** (RS256, PS256, ES256)           | checks signature, issuer, audience, expiry, scopes here, with the provider's published keys                          | when the token expires     |
| **Opaque tokens**, or any token you want checked live | **asks the provider** (introspection, RFC 7662) with its own client id and secret; remembers the answer 30 s at most | within 30 s (`0`: at once) |

What a provider must still give, whatever the token: the **issuer** written exactly as in its tokens, a way to find keys or the introspection endpoint (its metadata, or the address you declare), a **name for the person** in the token (or `client_id` for a machine), and an **audience** that is this server (or `allow-no-audience` when the provider serves only it). Those are the settings; nothing else is provider specific. The login of a person in Claude Code also needs the client to be **known** to the provider (dynamic registration, or an id you give it).

### What was run, and what was not

| Tested against                                                                                             | How                                                                 | Covers                                                                                             |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Keycloak 26** (real)                                                                                     | `npm run keycloak:check`, by hand with Claude Code (not part of CI) | discovery, dynamic registration, PKCE login, offline tokens, a JWT accepted                        |
| **node-oidc-provider** (an implementation certified by the OpenID Foundation), in the tests of the project | `test/oauth-conformance.test.ts`, on every run                      | JWT and opaque tokens, discovery, introspection, revocation, expiry, wrong audience, provider down |
| A fake provider shaped like **Auth0**                                                                      | `test/oauth.test.ts`                                                | trailing-slash issuer, audience list, namespaced claim, `sub` like `auth0\|123`                    |
| Auth0, Okta, Entra ID (real tenants)                                                                       | **not run**                                                         | written from their documentation; run `oauth check` with a real token before relying on it         |

A signed JWT cannot be revoked before it expires unless every token is asked about (`always`), which costs a call to the provider per token every 30 s. Keep access tokens short.

The same `help-me-ops-oauth` service takes Keycloak, Auth0, Okta or Entra ID: only the values change.

|                                | Keycloak                                                            | Auth0                                                                                                                                                                                    | Okta                                                    | Microsoft Entra ID                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Issuer**                     | `https://<host>/realms/<realm>`                                     | `https://<tenant>.<region>.auth0.com/` **with the slash** (or your custom domain)                                                                                                        | `https://<org>.okta.com/oauth2/<server-id>`             | v2: `https://login.microsoftonline.com/<tenant-id>/v2.0`; v1 tokens say `https://sts.windows.net/<tenant-id>/` (with a slash) |
| **Audience** (`aud`)           | an _audience mapper_; the demo realm sets it to the server's URL    | the **API identifier** you create                                                                                                                                                        | the _audience_ of the authorization server              | `api://<app-id>` or the app id (_Expose an API_)                                                                              |
| **Scopes** are in              | `scope`                                                             | `scope`                                                                                                                                                                                  | `scp` (a list)                                          | `scp`                                                                                                                         |
| **Name of the person**         | `preferred_username` is in the token                                | **not in the access token**: add one with an Action, a namespaced claim, and `OPS_MCP_OAUTH_IDENTITY_CLAIMS=https://company.example/email` (otherwise `sub`, like `auth0\|123`, is used) | add `email` or `preferred_username` to the token claims | `preferred_username`, `upn`                                                                                                   |
| **Registration of the client** | dynamic registration, allowed by a policy (the demo realm opens it) | dynamic registration, if enabled for the tenant; or an application you create                                                                                                            | usually a registered application                        | no dynamic registration: a registered public client                                                                           |

**Written from each provider's documented behaviour. Only Keycloak has been run against the real thing here**, and the others only against a fake provider that reproduces their token shapes (a trailing slash in the issuer, an audience list, a namespaced claim, a subject like `auth0|123`). Use `oauth check` on yours before you rely on it.

### Registration: how a client becomes known to the provider

- **Dynamic registration**: the client registers itself at the provider's registration endpoint, as in step 3. Claude Code does it when the provider's metadata offers it. The provider must allow it (a policy at Keycloak; a tenant setting at Auth0).
- **A registered client**: when the provider does not allow it (Entra ID, usually Okta), register a **public client** at the provider, with `http://localhost:8765/callback` as a redirect address, and give its id to the client:

  ```bash
  claude mcp add --transport http ops https://mcp.company.example/mcp --client-id <the client id> --callback-port 8765
  ```

  No client secret is needed: the exchange is protected by PKCE.

### Auth0, as an example

From Auth0's documentation, untested against a tenant here:

1. **Applications → APIs → Create API.** Identifier: `https://mcp.company.example/mcp` (this is the audience); signing algorithm RS256; enable **Allow Offline Access** (so that clients can stay signed in); optionally define a permission such as `mcp:tools`.
2. **Settings → Advanced**: enable **dynamic client registration** if you want clients to register themselves, and make your login connection **domain-level** so those clients can use it; **or** create an application (type Native or SPA) with the callback `http://localhost:8765/callback` and use `--client-id`.
3. **A name in the token**: **Actions → Post Login**, `api.accessToken.setCustomClaim("https://company.example/email", event.user.email)`; then set `OPS_MCP_OAUTH_IDENTITY_CLAIMS=https://company.example/email`.
4. If your client sends the MCP "resource" parameter and Auth0 ignores it, set the tenant's **Default Audience** (Settings → General) to the API identifier, so tokens are issued for it.
5. In `.env`:

   ```bash
   OPS_MCP_OAUTH_ISSUER=https://<tenant>.eu.auth0.com/     # the trailing slash is part of it
   OPS_MCP_PUBLIC_URL=https://mcp.company.example/mcp
   OPS_MCP_OAUTH_IDENTITY_CLAIMS=https://company.example/email,sub
   OPS_MCP_OAUTH_SCOPES=mcp:tools                          # if you defined one
   ```

6. `docker compose --profile oauth up -d --build help-me-ops-oauth`, behind your TLS proxy, then `npm run ops -- oauth check`.

## Checking it

```bash
OPS_CHECK_TOKEN=<an access token> npm run ops -- oauth check      # reads the same variables as the server
```

It prints what is configured, finds the provider and its keys (or says why not), and, given a token, **explains each check** that the server makes, with what to change:

```
✔ the provider is found and its keys are at https://tenant.eu.auth0.com/.well-known/jwks.json: 2 key(s) …
✔ signature algorithm RS256
✘ issuer: the token says "https://tenant.eu.auth0.com", the server expects "https://tenant.eu.auth0.com/" (they differ only by a trailing slash: write it as the token does)
✘ audience: the token is for ["api://other"], the server expects "https://mcp.company.example/mcp" (set the API identifier at the provider, or --oauth-audience)
✔ expires in 299 s
✘ scopes: missing mcp:tools (the token has none)
✘ no claim names the person: tried preferred_username, email, upn, username, sub, client_id; the token has iss, aud, exp (add one at the provider, or name one with --oauth-identity-claim)
✘ the server would refuse this token (ERR_JWT_CLAIM_VALIDATION_FAILED)
```

To get a token to check: from a client's debug output, or from the provider's own tool for trying a login (a "test" tab, a token endpoint with a test user). The server never says _why_ to a caller (only `invalid_token`), on purpose; this command is where you find out.

### When it does not work

| What you see                                                              | Usually                                                              | What to do                                                                                                                                  |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| The server will not start: _cannot find the metadata of the OAuth issuer_ | wrong issuer, or the server cannot reach the provider                | check the issuer in a browser at `<issuer>/.well-known/openid-configuration`; behind a firewall, declare the keys: `OPS_MCP_OAUTH_JWKS_URI` |
| _names another issuer … differs only by a trailing slash_                 | the issuer is written differently from the provider's                | write it exactly as the metadata does (Auth0: with the slash)                                                                               |
| _must be https_                                                           | an `http://` address for the issuer, the keys or the public URL      | use https (only addresses on this machine may be http)                                                                                      |
| The client says it needs authentication and the browser never opens       | the client cannot register, or finds no provider                     | `curl <public url>/.well-known/oauth-protected-resource` should name the issuer; give the client an id: `--client-id`                       |
| The login works and the server answers 401                                | the token is refused                                                 | `oauth check` with that token: usually the **audience** or the **issuer**                                                                   |
| 403 `insufficient_scope`                                                  | the token lacks a required scope                                     | grant the scope to the client at the provider, or drop `OPS_MCP_OAUTH_SCOPES`                                                               |
| Everyone is `oauth:auth0_…` or `oauth:<uuid>` in the log                  | the token has no name claim, only `sub`                              | add one at the provider and set `OPS_MCP_OAUTH_IDENTITY_CLAIMS`                                                                             |
| _Offline tokens not allowed_                                              | the client asks to stay signed in and the provider does not allow it | allow the `offline_access` scope for the user and the client (Auth0: _Allow Offline Access_ on the API)                                     |
| It worked for an hour, then 401                                           | the access token expired and the client cannot refresh               | check the refresh token and its lifetime at the provider                                                                                    |

## Try it without a provider of your own

`docker compose up -d --build` starts a **test Keycloak** and a help-me-ops that trusts it, with nothing to set up, and `npm run keycloak:check` does the whole sign-in headless: [try it with a Keycloak on your machine](/team-server#try-it-with-a-keycloak-on-your-machine). It is the same server and the same code as the `oauth` profile; only the provider's address differs.
