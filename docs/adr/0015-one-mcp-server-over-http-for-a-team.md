# 0015. One MCP server over HTTP for a team, next to the one on stdio

- Status: accepted
- Date: 2026-10-09

## Context

The MCP server runs on each person's machine, started by their AI client over
stdio (ADR 0004). That is the right default, and it has a cost for a team: every
person needs a clone, Node and **the credentials of every system** the workspace
reads (a database URL, an API token). A team that wants one place where the
credentials live, one workspace to review, and nothing on laptops, has no way to
get it except SSH tricks that run everyone as the same account.

MCP has a second transport for that, Streamable HTTP, which the SDK we already
use implements. The risk is the whole point of the change: a stdio server needs
no login because the person started it; a server on a URL reads production for
whoever can reach it.

## Decision

Add an **HTTP entry point beside the stdio one**, sharing everything else.

- **One factory, two entry points.** `src/mcp-server.ts` builds the MCP server
  (tools with their hints, the `investigate` prompt, the instructions) from a
  toolbox. `src/mcp.ts` (stdio) and `src/mcp-http.ts` (HTTP) are thin; the
  HTTP logic is in `src/http-server.ts` so it is testable. The tools, the
  mask, strict mode and the checked conclusion are the same code on both.
- **The toolbox is opened once and shared** (connectors, addons, the mask), and
  **each MCP session gets its own tools and so its own ledger**: a conclusion in
  one session cannot cite what another session read.
- **Authentication is not optional.** Requests carry `Authorization: Bearer
<token>`; the server is configured with named tokens
  (`OPS_MCP_TOKENS="alice:<token>,bob:<token>"`; `ops token <name>` makes one).
  _Since the first version the server keeps only the SHA-256 of a token: `ops token`
  prints a `name:sha256:<hash>` line for the server and the secret, once, for the
  person; a plain `name:<token>` still works, with a warning at start. A token is
  256 random bits, so a fast hash is enough: nobody chooses it._
  A token's name is the **identity** of its sessions. Without tokens the server
  **refuses to start**, except on a loopback address with `--no-auth` written
  out. A session id is bound to the identity that opened it.
- **Bound to loopback by default** (`127.0.0.1:8808`, path `/mcp`). Binding to
  another address needs tokens. The `Host` header is checked against the allowed
  hosts (`--public-host` for the name behind a proxy), and a request with an
  `Origin` is refused, against DNS rebinding from a browser.
- **TLS is the proxy's job** (Caddy, nginx, a load balancer), documented; the
  server can also serve TLS itself with `--tls-cert` and `--tls-key`.
- **An audit line per tool call**, as JSON on stderr: time, identity, session,
  tool, app, environment, source, duration, ok. **Never** the question or the
  evidence, which can hold personal data.
- **Bounded**: a request body is capped at 1 MB, sessions at 100 and idle ones
  are closed after 30 minutes.
- **No OAuth and no per-user permissions in this version.** A token reads
  everything the workspace reads; what a person may see is decided by who gets a
  token and by the read-only accounts behind the sources.

## Consequences

- Credentials live on one server, and a person's laptop holds only a token that
  can be revoked by removing it.
- The server is now something to operate: keep it patched, behind TLS, with
  tokens that rotate. A leaked token reads production until it is removed.
- Evidence that a tool returns now crosses a network to the client: TLS is not
  optional on anything but loopback, and the personal-data guide applies as ever.
- A client that only speaks OAuth for remote servers cannot connect yet.
- stdio stays the default and is unchanged.

## Alternatives considered

**SSH to a bastion with stdio over it.** Works today and needs nothing new, but
every person runs as the same account, with no per-person identity or audit.

**OAuth 2.1 as MCP's remote authorization specifies.** The right end state for
clients that need it and a large piece of work (an authorization server or an
identity provider integration). Bearer tokens come first and solve the case of a
team with a few people; OAuth can sit in front (a proxy) or come later.

**A stateless server (no sessions).** Simpler, but the conclusion check keeps a
ledger per session, which is the point of the check.

**Docker image and compose in the repository.** Useful and a thing to maintain;
the guide shows a unit file and a proxy instead.
