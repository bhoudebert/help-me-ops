# A plug-in kit for your own infrastructure

## Why

The skeleton shows the method, but a team cannot yet say "this is my
infrastructure" without editing the toolbox: configuration is a flat list of
sources, there is nowhere to put several apps or environments, runbooks are
not searchable, and nothing shows end to end what an investigation looks like
without a real system.

The model is not ours to host. Claude Code, Codex and Copilot each bring their
own, on the user's subscription. What we ship is the plumbing, the method and
a way to plug a team's infrastructure in, with a demo world that works from a
fresh clone.

## What changes

- **A workspace folder per team** (ADR 0007): `ops.config.json`, `playbooks/`
  and `knowledge/` in one directory, which the MCP server and the CLI are
  pointed at (`--workspace ./ops`). This repo's `examples/` becomes the
  template.
- **Apps and environments** in the configuration: each app has environments,
  each environment its sources. Tools take `app` and `env`; a `scope` tool
  resolves them from the question and the configuration.
- **Knowledge search**: runbooks, playbooks, ADRs and past notes searched by
  plain full-text, returned with their file path. Embeddings later, behind the
  same tool, if needed.
- **A structured conclusion** for every client: cause, certainty, evidence
  (source, time, quote), unknowns, next step. A `check_conclusion` tool runs
  the same validator in all three clients: every quote must come from a result
  of the session.
- **A demo world**: one app (`shop`) with two environments, fake services
  (logs, orders data, metrics, health check) and the stuck order 4512 only in
  prod. A scenario file states the expected cause and doubles as a test.
- **A scripted demo** in the terminal (`ops demo`): a scripted model replays
  the investigation through the real tools, with no API key and no cost.
- **Setup helpers**: `ops init` scaffolds a connector or an app from a
  template, `ops doctor` checks each source (reachable, read-only, sample);
  MCP setup tools propose a configuration change and test a source, a person
  applies it.

## Not in this change

- An investigator calling a model API from the terminal. Deferred; the
  `Model` seam exists only for the scripted demo.
- Packaging on npm. The server is run from a clone, pointed at a folder.
- Case files, personal-data masking, embeddings, real connectors (PostgreSQL
  first, then Loki, Prometheus).

## Impact

- Specs: new `workspace`, `knowledge`, `conclusion` and `demo` capabilities
  (deltas here); `toolbox`, `cli` and `mcp-server` change (app and env
  parameters, new tools and commands).
- Code: configuration v2, scope resolution, knowledge index, conclusion
  validator, demo world and scripted model.
- ADR: 0007 (the client hosts the model; a workspace folder; apps and
  environments).

## Sequence

One pull request per task in `tasks.md`; the order is the dependency order.
