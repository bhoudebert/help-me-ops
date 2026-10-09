# MCP Server Specification

## Purpose

Serve the toolbox to Claude Code, Codex and GitHub Copilot.

## Requirements

### Requirement: Transport and clients

The server SHALL run on stdio (`npm run mcp`), write only protocol to stdout,
and ship client configuration, pointed at the demo workspace: `.mcp.json` (Claude
Code), `.vscode/mcp.json` (Copilot), and a documented `config.toml` entry
(Codex). The workspace SHALL be taken from `--workspace` or `OPS_WORKSPACE`.

### Requirement: The method in the instructions

The server instructions SHALL give the method: the scope (app and environment)
first, asking the person when it is unclear, then the playbook, the
identifiers of the report searched in the sources, a timeline of quoted
evidence with source and time, and a conclusion checked with `checkConclusion`
(the likely cause, the certainty, the evidence as quotes of tool results, the
unknowns and the next step for a person), answered with the report it returns;
never a claim without evidence; never a change to the system.

### Requirement: Prompt

An `investigate` prompt SHALL carry the method and the reported problem.

#### Scenario: Order stuck in Claude Code

- **WHEN** the user runs `/mcp__help-me-ops__investigate order 4512 stuck`
- **THEN** the model receives the method and the problem, and the tools to follow it

### Requirement: The same server over HTTP, for a team

A second entry point SHALL serve the same tools, instructions and prompt over
Streamable HTTP (`npm run mcp:http`), built by the same factory as the stdio
server. Each MCP session SHALL have its own tools and so its own ledger for the
checked conclusion. The server SHALL answer only requests with a valid bearer
token (401 otherwise), SHALL bind a session to the token that opened it, and SHALL
refuse to start without tokens (except `--no-auth` on a loopback address) and
refuse to listen beyond loopback without a public host name. It SHALL refuse a
request whose Host is not an allowed one or that has an Origin, cap a request body
at 1 MB and the sessions at 100, and log one JSON line per session event and per
tool call with the identity, never the input or the evidence.

#### Scenario: Two people, one server

- **WHEN** alice and bob each open a session and alice reads a log line
- **THEN** a conclusion quoting that line is accepted in alice's session and refused in bob's

#### Scenario: No token

- **WHEN** a request reaches `/mcp` without a valid `Authorization: Bearer` header
- **THEN** the server answers 401 and runs nothing

### Requirement: A container for the HTTP server

The repository SHALL ship a `Dockerfile` and a `compose.yml` that run the HTTP
server with the workspace mounted at `/workspace` (never inside the image), as an
unprivileged user, with a health check. The server SHALL be configurable by
`OPS_MCP_HOST`, `OPS_MCP_PORT`, `OPS_MCP_PATH`, `OPS_MCP_PUBLIC_HOSTS`,
`OPS_MCP_TOKENS` and `OPS_MCP_TOKENS_FILE`, with command-line flags taking
precedence. The continuous integration SHALL build the image and start it, and check
its health and that a request without a token is refused.

#### Scenario: A container with no flag

- **WHEN** the image runs with `OPS_MCP_TOKENS`, `OPS_MCP_PUBLIC_HOSTS` and a mounted workspace
- **THEN** it listens on 8808, answers `/healthz`, and refuses `/mcp` without a token

### Requirement: The server keeps hashes of tokens, not tokens

`ops token <name>` SHALL print, on the standard output, a line for the server of the
form `name:sha256:<hash>`, and on the error output the secret, once. The server SHALL
accept `name:sha256:<64 hex digits>` entries and compare the SHA-256 of a presented
token with them in constant time; a presented hash SHALL NOT be accepted as a token.
It SHALL still accept `name:<token>` (at least 24 characters) and SHALL log a warning
at start that such a token is readable in its configuration. `--plain` SHALL print the
token itself instead of its hash.

#### Scenario: A leaked tokens file

- **WHEN** the tokens file holds `alice:sha256:<hash>` and someone sends that hash as a bearer token
- **THEN** the server answers 401

### Requirement: OAuth 2 with a company identity provider

When an issuer is configured (`--oauth-issuer` or `OPS_MCP_OAUTH_ISSUER`), the HTTP
server SHALL accept access tokens that are JWTs signed by that provider, beside the
static tokens, and SHALL check on every request the signature (against the keys at the
declared JWKS address, or found by discovery of the issuer's metadata, which SHALL
name the same issuer), the issuer, the audience (the public URL by default), the
expiry (an `exp` is required), and the required scopes from `scope` or `scp`. It SHALL
refuse the algorithms `none` and `HS*`. A refusal SHALL be 401 `invalid_token`, or 403
`insufficient_scope`, with a `WWW-Authenticate` header carrying the address of the
protected resource metadata (RFC 9728), which the server SHALL serve without
authentication at `/.well-known/oauth-protected-resource` and with the resource's path.
The identity SHALL be `oauth:` and the first of the configured claims, restricted to
characters that cannot forge a log line. The server SHALL refuse to start when the
provider's metadata cannot be found or names another issuer, or when the issuer, the
keys address or the public URL is not https (a loopback address excepted).

#### Scenario: A token for another audience

- **WHEN** a client sends a token signed by the provider whose `aud` is another resource
- **THEN** the server answers 401 with `error="invalid_token"` and runs nothing

#### Scenario: The classic attacks

- **WHEN** a client sends an unsigned token, or an HS256 token signed with the provider's public key as the secret
- **THEN** the server answers 401

### Requirement: Any provider, written as it writes itself

The issuer SHALL be used exactly as configured, for the `iss` check and for the
metadata names it is compared with, and SHALL NOT be normalised: an issuer that ends
with a slash (Auth0, Microsoft v1 tokens) and one that does not (Keycloak, Okta,
Microsoft v2) are different issuers. When the metadata names the issuer with or without
a trailing slash where the configuration has the other, the error SHALL say so. An empty
variable SHALL count as not set. When no public host is given, the host of the public
URL SHALL be the one the Host check accepts. `ops oauth check` SHALL find the provider
and its keys with the same rules as the server and, given a token, SHALL say for each
check of the server (algorithm, issuer, audience, expiry, scopes, the claim naming the
person) whether it passes and what differs, without verifying the signature itself.

#### Scenario: A provider whose issuer ends with a slash

- **WHEN** the provider's metadata and tokens name the issuer `https://tenant.example/` and the server is configured with exactly that
- **THEN** its tokens are accepted, and configured without the slash the server refuses to start and says the slash is the difference
