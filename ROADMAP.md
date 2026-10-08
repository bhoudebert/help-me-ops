# Roadmap

## Next

- **The rest of the plug-in kit** (`openspec/changes/plug-in-kit/`):
  searchable runbooks (`knowledge/`), a checked conclusion (cause, evidence,
  unknowns, every quote from a result), a scripted terminal demo (`ops demo`)
  and setup helpers (`ops init`, `ops doctor`, `ops addon check`).
- **Writing an addon without MCP knowledge** (ADR 0009): a manifest and plain
  functions (done), an `ops init addon` scaffold (done), shipped addons: `rest` for
  a team's own API (done), Datadog (done, with a mock), a local `git` addon (done), GitHub (done, with a mock).
- **Live demo backend** (done): the shop REST API over HTTP in the compose file,
  read by the `rest` addon; a fake Datadog on it (documented shapes) is read by the `datadog` addon.
- **Demo on a real PostgreSQL** (done): `docker/compose.yml`, a `readonly` user,
  the `_shopdb` addon; see the guide.
- **More addons people ask for**: PostgreSQL and MySQL (read-only user, from
  the `sql` scaffold), Loki or Elasticsearch logs, Prometheus metrics. Each an
  addon following `examples/my-workspace/addons/`.
- **API mode and local models** (soon): run the investigation without an AI
  client, from the terminal or a script, by calling a model API directly (a
  hosted one, or a local one such as Ollama or llama.cpp through an
  OpenAI-compatible endpoint). The prompt in an AI client stays the best way
  (the client brings its own model, tools and conversation), so this is a
  second door onto the same toolbox, playbooks and conclusion check. It would
  revisit "the client's model does the reasoning" (ADR 0007), so it starts with
  an ADR, and keeps the rule that tests never call a model.
- **Case files**: an investigation saved with its question, steps, evidence
  and conclusion, so the next one starts from what is known.

## Later

- Masking of personal data in evidence, per source.
- Time zones and clock skew across sources in the timeline.
- Playbooks suggested from past cases.

## Done lately

- The demo world: a shop in prod and staging with logs, orders, metrics and
  health checks, a playbook, and a scenario replayed as a test.
- Addons: a folder dropped in is loaded, with tools, settings, connector types
  and playbooks; a broken one is skipped with a reason (ADR 0008).
- Workspaces with apps and environments, and the `scope` tool (ADR 0007).
- The skeleton: connectors (a log file, a database template), playbooks in
  Markdown, a shared read-only toolbox, CLI and MCP entry points for Claude
  Code, Codex and Copilot, specs, ADRs, guide, site, CI and releases.
