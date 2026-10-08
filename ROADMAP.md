# Roadmap

## Next

- **The rest of the plug-in kit** (`openspec/changes/plug-in-kit/`):
  richer `ops doctor` checks. The scripted terminal demo (`ops demo`) and
  `ops setup` for each client are done.
- **Writing an addon without MCP knowledge** (ADR 0009): a manifest and plain
  functions (done), an `ops init addon` scaffold (done), shipped addons: `rest` for
  a team's own API (done), Datadog (done, with a mock), a local `git` addon (done), GitHub (done, with a mock).
- **Live demo backend** (done): the shop REST API over HTTP in the compose file,
  read by the `rest` addon; a fake Datadog on it (documented shapes) is read by the `datadog` addon.
- **Demo on a real PostgreSQL** (done): `docker/compose.yml`, a `readonly` user,
  the `_shopdb` addon; see the guide.
- **More addons people ask for**: MySQL (read-only user, from the `sql` scaffold);
  Prometheus, Loki and Elasticsearch are done (experimental, with mocks). Next
  candidates: Grafana, Sentry, PagerDuty. Each an addon following
  `examples/my-workspace/addons/`.
- **Personal data** (guide and the `privacy.mask` safeguard done; the rest soon), in this order:
  1. _Declare it_ (done, ADR 0012): each source and addon says whether it can
     return personal data (`privacy.data`, `personalData` in an addon), and
     `doctor` shows it.
  2. _Stable placeholders_ (done, ADR 0013): `privacy.mask.placeholders` replaces
     a hidden value by `user-3f2a`, the same in every source of the session and
     translated back in the tool inputs the assistant gives, so one customer can
     still be followed. Case files, when they exist, must save the masked
     evidence, and could save the mapping.
  3. _Detectors and personal fields from addons_ (done, ADR 0011): an addon (or a shared folder of
     addons a company keeps for all its workspaces) declares what is personal in
     its own domain: the keys its records hold (`personalFields`, switched on by
     the workspace) and detectors for formats only it knows (a company id, a
     national number), named in `privacy.mask.patterns` like the built-in ones.
     Declared as JSON (a regex and an optional checksum such as `luhn` or
     `iban`), not as code, so a detector can only hide.
  4. _A strict mode_ (done, ADR 0012, off by default) that serves only sources
     declared free of personal data.
  5. _Local models_ (next item), the strongest answer when data cannot leave.
- **API mode and local models** (soon): run the investigation without an AI
  client, from the terminal or a script, by calling a model API directly (a
  hosted one, or a local one such as Ollama or llama.cpp through an
  OpenAI-compatible endpoint). The prompt in an AI client stays the best way
  (the client brings its own model, tools and conversation), so this is a
  second door onto the same toolbox, playbooks and conclusion check. It would
  revisit "the client's model does the reasoning" (ADR 0007), so it starts with
  an ADR, and keeps the rule that tests never call a model.
  Decided: [ADR 0014](docs/adr/0014-api-mode-and-local-models.md) and
  [the proposal](openspec/changes/api-mode/proposal.md) (`ops ask`, `ops eval`),
  (`ops chat`, `ops ask`, `ops eval`; not built yet).
- **Case files**: an investigation saved with its question, steps, evidence
  and conclusion, so the next one starts from what is known.

## Later

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
