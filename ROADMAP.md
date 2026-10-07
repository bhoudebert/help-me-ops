# Roadmap

## Next

- **The investigation loop** (`openspec/changes/first-investigation-loop/`):
  a model follows the matching playbook through the sources, builds a timeline
  and concludes with the cause, the evidence and what is still unknown. From
  the terminal with an API key, and the same method over MCP.
- **Connectors people ask for first**: PostgreSQL and MySQL (read-only user),
  Loki or Elasticsearch logs, Prometheus metrics (CPU, memory, queue depth),
  an HTTP health check. Each a module following `examples/connectors/`.
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
