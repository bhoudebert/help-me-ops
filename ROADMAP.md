# Roadmap

## Next

- **The rest of the plug-in kit** (`openspec/changes/plug-in-kit/`):
  searchable runbooks (`knowledge/`), a checked conclusion (cause, evidence,
  unknowns, every quote from a result), a scripted terminal demo (`ops demo`)
  and setup helpers (`ops init`, `ops doctor`, `ops addon check`).
- **Writing an addon without MCP knowledge** (ADR 0009): a manifest and plain
  functions, an `ops init addon` scaffold, and shipped addons for Datadog,
  GitHub and a team's own REST API.
- **More addons people ask for**: PostgreSQL and MySQL (read-only user, from
  the `sql` scaffold), Loki or Elasticsearch logs, Prometheus metrics. Each an
  addon following `examples/my-workspace/addons/`.
- **A terminal investigator** calling a model API, if people without an MCP
  client ask for it.
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
