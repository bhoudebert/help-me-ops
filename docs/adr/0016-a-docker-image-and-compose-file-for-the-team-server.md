# 0016. A Docker image and a compose file for the team server

- Status: accepted
- Date: 2026-10-09

## Context

ADR 0015 added the MCP server over HTTP and left a container out ("useful, and a
thing to maintain"; the guide showed a systemd unit). Running it, the first need of
a team is a way to start it that does not depend on the host: Node 24, a clone,
`npm ci`, a service manager. A container is what most teams already operate, and
it fits the shape of this server: a process that reads a folder (the workspace)
and a few variables (the credentials), and listens on a port.

## Decision

- **A `Dockerfile` and a `compose.yml` in the repository.** The image holds the
  server (`src/`), the shipped addons and the templates, installed with
  `npm ci --omit=dev`; it runs as the unprivileged `node` user, listens on 8808
  and has a health check on `/healthz`.
- **The workspace is never in the image.** It is mounted at `/workspace`, read
  only: `ops.config.json`, playbooks, knowledge and the team's own addons stay
  with the team, in their own repository, and the image is the same for everyone.
- **Configured by environment**, since a container has no flags to hand:
  `OPS_MCP_HOST`, `OPS_MCP_PORT`, `OPS_MCP_PATH`, `OPS_MCP_PUBLIC_HOSTS` and the
  tokens in `OPS_MCP_TOKENS` or, as a container secret, `OPS_MCP_TOKENS_FILE`.
  The command-line flags still win.
- **Safe defaults in `compose.yml`**: the port published on loopback only, a
  read-only root filesystem, no capabilities, `no-new-privileges`, the tokens from the
  environment (or a secret file, left commented out so that nothing needs it), the credentials of the sources in an `env_file` that is not committed
  (`server.env`, `ops-tokens.txt` are ignored by git).
- **The rules of 0015 still hold in the container**: no tokens, no start; it
  listens on 0.0.0.0 inside, so a public host name must be given.
- **CI builds the image and starts it** (health check, 401 without a token), so the
  Dockerfile cannot rot. **Publishing an image to a registry is not done here**:
  it is a release decision of the maintainer (a registry, a name, tags).

## Consequences

- A team starts the server with `docker compose up -d`, and updates it by rebuilding.
- Addons that need a package (a database driver) get it from the workspace's own
  `node_modules`, installed by the team where the workspace lives: it is mounted
  with the rest. The `git` addon needs the `git` program, which the slim image does
  not have: extend the image if you use it.
- One more file to maintain, kept honest by the CI job.

## Alternatives considered

**An image with the workspace inside.** Simpler to run, and it ties credentials,
config and code together, so a new workspace means a new image and a secret in a
layer. Rejected.

**Publishing to a registry now.** Convenient for users, and a decision about who
owns a name and what is promised about updates. Left to the maintainer.

**A Helm chart or other orchestrator files.** Out of scope; the compose file shows
what a container needs (a mount, a secret, a port) and translates.
