# 0007. The client hosts the model; a workspace folder with apps and environments

- Status: accepted
- Date: 2026-10-07

## Context

Claude Code, Codex and Copilot each bring a model, on the user's own
subscription. An investigator in this repository calling a model API would
need keys, a provider choice and limits on cost, for something the clients
already do. Meanwhile a team cannot yet describe its own infrastructure: the
configuration is a flat list of sources, with no place for several apps or
environments, and the runbooks are not searchable.

## Decision

- The project makes no model calls. It ships tools, playbooks, a conclusion
  layout with a checker, and a demo. The client's model does the reasoning.
- The terminal demo uses a scripted model that replays a scenario through the
  real tools; it needs no key and no network.
- A team's setup is one **workspace folder**: `ops.config.json`, `playbooks/`,
  `knowledge/`. The server and the CLI take `--workspace <dir>`. A team can keep
  that folder in its own repository; this repository's demo is the template.
- The configuration declares **apps**, each with **environments**, each with
  its sources. Tools take `app` and `env`; a `scope` tool resolves them.
- Credentials are named by environment variable, never stored in the file.
- Written knowledge is searched by plain full-text. Embeddings can come later
  behind the same tool.

## Consequences

No keys, no per-use cost, the same behaviour in every client. A team's
infrastructure description lives with its code and is reviewed like it. The
cost: no investigation without an MCP client, and the quality of a
conclusion depends on the client's model; the checker (every quote must come
from a result of the session) bounds that.

## Alternatives considered

An investigator calling the Anthropic API from the terminal: useful for
scripts and CI, deferred until someone needs it (roadmap). A single
configuration file with paths anywhere: harder to share and to template.
Packaging on npm first: later; for now the server runs from a clone.
