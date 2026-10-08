# Tasks

- [ ] ADR 0007, 0008 and 0009, roadmap and project context (docs PRs); each later task folds its delta into `openspec/specs`
- [x] Configuration v2: workspace folder, apps, environments, `scope` tool, tests
- [x] Addon loader: discovery over the folder list, `defineAddon`, `apiVersion`, isolation of failures, the built-in log-file connector as an addon, tests
- [x] Demo world: app `shop` (prod and staging), fake services as addons (`logs`, `order`, `metrics`), the stuck-order scenario as a test
- [x] Addon authoring without MCP knowledge: `addon.json` and `tools.ts`, plain data to evidence, uniform settings (`path`), the demo addons converted
- [x] `ops init addon` with the file, api and sql templates
- [x] Shipped addons: `rest`, `datadog` (with a mock), `git` (local), `github` (with a mock), tested against fixtures
- [x] Knowledge search: `searchKnowledge`, tests
- [x] Conclusion: schema, evidence check, `checkConclusion`, MCP instructions with the same layout
- [ ] Scripted model and `ops demo`, tested against the demo world
- [x] `ops init workspace`
- [x] `ops addon check`
- [ ] Setup helpers: `ops doctor` checks, MCP setup tools
- [ ] Guide ("Plug in your infrastructure", "Write an addon", "Try the demo" per client), README, site, roadmap
