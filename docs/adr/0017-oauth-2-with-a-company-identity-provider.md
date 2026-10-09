# 0017. OAuth 2 with a company identity provider, as a resource server

- Status: accepted
- Date: 2026-10-09

## Context

ADR 0015 put the MCP server on a URL and let people in with static tokens: one
per person, made by an administrator, revoked by editing a file. That is right for
a few people and wrong for a company: accounts already live in an identity
provider (Entra ID, Okta, Keycloak, Auth0...), people sign in there with their
company login and a second factor, leavers lose access in one place, and security
teams will not accept a second list of secrets to manage.

MCP's specification for remote servers is built on OAuth 2.1: the **server is a
resource server**, the client discovers which authorization server to ask from a
metadata document the server publishes (RFC 9728), the person signs in at that
provider, and the client sends the access token it gets as a bearer token.

## Decision

help-me-ops validates tokens and publishes metadata. **It never logs anyone in and
issues no token**: that is the provider's job.

- **Configuration, not code.** `--oauth-issuer` (or `OPS_MCP_OAUTH_ISSUER`) turns it
  on, with `--public-url` (this server's address as clients reach it).
- **Two ways to say where the provider's keys are.** By **discovery**: from the
  issuer, the server reads the provider's published metadata (OpenID Connect
  `/.well-known/openid-configuration`, then RFC 8414) and takes its `jwks_uri`;
  the metadata must name the same issuer, or it is refused. Or **declared by hand**
  (`--oauth-jwks-uri`), when the provider's metadata cannot be reached from the
  server.
- **What a token must be.** A JWT signed with an accepted algorithm (RS256, PS256,
  ES256 by default; `none` and shared-secret algorithms are refused outright),
  by a key the provider publishes, with `iss` equal to the issuer, `aud` equal to
  this server's identifier (its public URL by default, `--oauth-audience` to
  change it, RFC 8707), an `exp`, not expired (30 s of clock tolerance), and all
  the required scopes (`scope` or `scp`). Anything else is a `401` with
  `invalid_token`, or a `403` with `insufficient_scope`.
- **Identity.** The first of `preferred_username`, `email`, `upn`, `sub` (settable)
  names the person, as `oauth:<value>` in the audit log and as the owner of a
  session. A static token and an OAuth identity never collide, and a session
  belongs to whichever came in first.
- **Discovery for clients.** `GET /.well-known/oauth-protected-resource` (and with
  the resource's path) answers `resource`, `authorization_servers` and the scopes,
  and every `401` carries `WWW-Authenticate: Bearer … resource_metadata="…"`.
- **It fails closed.** A provider that cannot be reached, a metadata document for
  another issuer, a non-https issuer, keys or public URL (loopback excepted) is an
  error at start, never a server that accepts anything.
- **Static tokens keep working beside it** (service accounts, a pipeline), so
  turning OAuth on does not lock out what already runs.
- **The `jose` library does the cryptography.** A direct dependency (the MCP SDK
  already depends on it): verifying a JWT is a place to use a reviewed library, not
  to write one.

## Consequences

- A company signs people in with the login it already has, with its policies, and
  removes a person in one place. A token expires by itself.
- The identity is a real person, so the audit log says who, as a first step to
  per-person permissions (groups or roles in the token, a later decision).
- **What is not here.** The server is not an authorization server: a client that
  needs the provider to support dynamic client registration, or a registered
  client id, depends on the provider's settings. **Opaque tokens** (not JWTs, so
  validated by asking the provider: RFC 7662 introspection) are not supported.
  There is no token revocation list: a token is good until it expires, so keep
  lifetimes short.
- More to get right on the provider's side: the audience of the tokens must be set
  to this server's identifier, which the guide shows for common providers, untested
  against a real one.

## Alternatives considered

**Being the authorization server** (login page, client registration, token
issue). A large and security-critical product of its own; the companies this is for
already have one.

**Putting an authenticating proxy in front** (oauth2-proxy, an API gateway) and
keeping static tokens behind it. Works today, adds a component and loses the
identity inside the server (the audit log would say the proxy); still possible, and
this does not rule it out.

**Opaque tokens through introspection first.** Some providers issue them; JWTs
are what the common ones issue to an API by default, and validating them needs no
call to the provider per request. Introspection can be added.

**Writing the JWT verification here.** No.
