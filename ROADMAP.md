# Roadmap

## Next

- **The plug-in kit** (`openspec/changes/plug-in-kit/`): a workspace folder
  per team with apps and environments, searchable runbooks, a checked
  conclusion (cause, evidence, unknowns), a demo world with fake services and
  a scripted terminal demo. The model stays in the client (Claude Code, Codex,
  Copilot). Extension by **addons**: a folder dropped in `addons/` is loaded,
  nothing to register (ADR 0008).
- **Connectors people ask for first**: PostgreSQL and MySQL (read-only user),
  Loki or Elasticsearch logs, Prometheus metrics (CPU, memory, queue depth),
  an HTTP health check. Each a module following `examples/connectors/`.
- **A terminal investigator** calling a model API, if people without an MCP
  client ask for it.
- **Case files**: an investigation saved with its question, steps, evidence
  and conclusion, so the next one starts from what is known.

## Later

- Masking of personal data in evidence, per source.
- Time zones and clock skew across sources in the timeline.
- Playbooks suggested from past cases.

## Done lately

- The skeleton: connectors (a log file, a database template), playbooks in
  Markdown, a shared read-only toolbox, CLI and MCP entry points for Claude
  Code, Codex and Copilot, specs, ADRs, guide, site, CI and releases.
