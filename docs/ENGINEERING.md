# Engineering notes

How help-me-ops is built. For the why of each choice, see `docs/adr/`.

## Shape

```
CLI (src/cli.ts) ──┐                      ┌─▶ connectors (src/connectors/)
                   ├─▶ toolbox ─▶ tools ──┤      file-logs, team modules
MCP (src/mcp.ts) ──┘  (src/toolbox.ts)    └─▶ playbooks (<workspace>/playbooks/*.md)
   Claude Code, Codex, Copilot
```

- `src/config.ts` finds the workspace (`--workspace`, `OPS_WORKSPACE`) and
  validates its `ops.config.json`: apps, environments, sources; paths in it
  are relative to the workspace.
- `src/addons/` loads addon folders (`loader.ts`), compiles an `addon.json` and
  `tools.ts` into a definition (`manifest.ts`: the core sets the hints and builds
  evidence from what the functions return), turns definitions into settings,
  namespaced tools and connector types (`runtime.ts`), and holds the API of the
  advanced `addon.ts` form (`types.ts`). `addons/` at the root holds the built-ins.
- `src/addons/check.ts` is `ops addon check`: loads an addon like the server, checks its settings against the workspace, and runs the samples of its `check.json` against recorded answers; the shipped addons and the templates carry a `check.json`.
- `src/init.ts` scaffolds an addon (`ops init addon`) by copying a folder of
  `templates/addon/` (`file`, `api`, `sql`) with the name filled in, and a whole
  workspace (`ops init workspace`) from `templates/workspace/` and a generated
  `ops.config.json`; neither overwrites, and tests load the result.
- `docs/guide/ready-made/` documents each shipped addon on one pattern (what you need, set-up, settings and tools, safety, demo, troubleshooting), with a catalog page; `test/docs.test.ts` checks that each page names every tool, setting and variable of its `addon.json`, and each addon folder has a README.
- `src/data.ts` is the declaration of which sources hold personal data (ADR 0012): `privacy.data` by source id, addon name or `knowledge`, the addon's own `personalData` as a default, and `privacy.strict`, which `createToolDefinitions` enforces (`listSources` withholds, `searchSource`, `searchKnowledge` and addon tools refuse); `openToolbox` refuses a declaration for what does not exist, and `doctor` prints it.
- Stable placeholders (ADR 0013) live in `createMasker`: a keyed HMAC per session gives `user-3f2a`, `restore` puts the values back in the inputs of every tool but the conclusion check, and the wrapper in `createToolDefinitions` rewrites an error that echoes an input.
- `src/agent/` is API mode (ADR 0014), kept apart so the MCP server never reaches a model: `endpoint.ts` (the `model` config, flags and variables over the file, `privacy.modelHosts`, where the endpoint is; pure, `doctor` uses it), `client.ts` (one OpenAI-compatible chat request with plain `fetch`, retried with a growing wait after a 429, 502, 503 or 504), `loop.ts` (`Session`: the conversation, the real tools through `createToolDefinitions`, validated arguments, a guard on repeated calls, step, token and request limits, trimming of old results, the accepted report ends a turn), `commands.ts` (`runAsk`, `runChat`), `eval.ts` (`runEval`: a scenario against model x reasoning settings, a fresh `Session` per run, scored by the keyword `expect` of the scenario, median steps, tokens and time). `src/guide.ts` holds the method text both doors give. `test/fake-chat.ts` is the scripted server the tests use, and it holds every request to the OpenAI chat contract (`test/chat-contract.ts`, checked against a real Ollama) and fails the test on a violation; `test/fixtures/chat/` holds responses recorded from a real Ollama, replayed by `test/chat-contract.test.ts`; `scripts/mock-model.ts` (`npm run mock:model`) is a stand-in server that replays a scenario, used end to end by a test; a test checks that only `cli.ts` and `agent/` import the loop.
- `src/privacy.ts` is the mask (ADR 0010): named detectors (email, ip, iban, card with Luhn, phone, token), the fields and patterns of `privacy.mask`, applied to the evidence of every tool answer in the wrapper of `createToolDefinitions`, before the conclusion ledger; `addon check` uses the same detectors to warn. An addon can declare `privacy` (personal fields, scoped to its tools; detectors named `addon.name`, JSON with an optional `luhn` or `iban` checksum and self-tests, ADR 0011); `openToolbox` builds the masker from the config and the addons and refuses a reference to what is not loaded.
- `addons/prometheus`, `addons/loki` and `addons/elasticsearch` read the HTTP APIs of those services (GET, and the one search POST), each with a `check.json`; the demo backend mocks them (`prometheus.mjs`, `loki.mjs`, `elasticsearch.mjs`).
- `src/setup.ts` is `ops setup`: the per-client configuration with real paths, after loading the workspace and starting the server over MCP like a client (the SDK client over stdio); `--write` merges into `.mcp.json` and `.vscode/mcp.json` and never replaces an entry.
- `src/demo.ts` is `ops demo`: it plays a scenario file through `createToolDefinitions` (the same wrapper as the server, mask and ledger included) and ends on `checkConclusion`; it exits non-zero if the check refuses.
- `src/conclusion.ts` keeps, per session, the evidence every tool returned (the `Ledger`, filled by a wrapper around each tool in `createToolDefinitions`) and checks a conclusion against it: each quote must be in a result, from the source, at the time and for the environment it claims; it then renders the one report layout of every client.
- `src/knowledge.ts` cuts the Markdown of `knowledge/`, `playbooks/` and the addons' into passages at their headings and ranks them (BM25 over the words, the section's own heading counting most); files are read per call, symbolic links never followed.
- `src/scope.ts` resolves the app and environment a read applies to, and
  proposes them from a question.
- `src/connectors/registry.ts` turns sources into connectors: built-in types,
  or modules exporting `createConnector`.
- `src/playbooks.ts` reads Markdown playbooks (front matter `name`, `when`) and
  matches them to a reported problem by shared words.
- `src/tools/index.ts` defines each tool once: schema, description, the four
  MCP hints, and its implementation.
- `src/mcp.ts` serves them on stdio with the method in its instructions and an
  `investigate` prompt; `src/cli.ts` runs them from the terminal
  (`src/commands.ts`).

## The connector contract

```ts
interface Connector {
  id: string;
  kind: "logs" | "metrics" | "database" | "http" | "custom";
  description: string;
  search(input: { query: string; from?: string; to?: string; limit?: number }): Promise<Evidence[]>;
}
interface Evidence {
  source: string;
  at: string | null;
  summary: string;
  data: unknown;
}
```

Only `Evidence` crosses into the model: a time, one readable line, and the raw
record for the case file.

## Tools

| Tool              | Input                                       | Returns                                                              |
| ----------------- | ------------------------------------------- | -------------------------------------------------------------------- |
| `listSources`     | none                                        | Sources with kind and description                                    |
| `searchSource`    | `source`, `query`, `from?`, `to?`, `limit?` | Evidence, in source order                                            |
| `listPlaybooks`   | `question?`                                 | Playbooks, matching ones first                                       |
| `searchKnowledge` | `query`, `app?`, `limit?`                   | Passages of runbooks and notes, ranked                               |
| `checkConclusion` | cause, certainty, evidence, unknowns, next  | Accepted with a report, or refused with the quotes it could not find |
| `getPlaybook`     | `id`                                        | The playbook's steps                                                 |

All read-only (`readOnlyHint: true`, `destructiveHint: false`); `searchSource`
is open-world (it reaches the investigated system).

## Tests

`npm test` runs against `examples/my-workspace`, the demo world (a shop in prod and
staging: logs, orders, metrics, health, around order 4512; `test/demo.test.ts`
replays its scenario through the real tools), and starts the MCP server through a real MCP client. Coverage
thresholds: lines 80, functions 80, branches 65.

## Project layout

```
src/
  cli.ts, commands.ts   terminal entry point and commands
  mcp.ts                MCP server on stdio
  config.ts             the workspace and its ops.config.json, validated
  scope.ts              app and environment of a read
  addons/               addon loader, manifest compiler, settings, tools
templates/addon/        what `ops init addon` writes: file, api, sql
templates/workspace/    what `ops init workspace` copies: README, a starter playbook
addons/                 built-in addons (logs: the file-logs connector type; rest: GETs of a team API; datadog: logs, metrics, monitors; git: a repository on disk; github: its REST API), idle until an environment sets them up
  init.ts               ops init addon: write a template addon
  toolbox.ts            workspace → apps, connectors, playbooks
  connectors/           the contract, file-logs, the registry
  playbooks.ts          Markdown playbooks, matching
  tools/index.ts        the tools, defined once
examples/my-workspace/     the demo workspace: config, logs, data, addons, a playbook, a scenario;
                        docker/: the same shop on a real PostgreSQL (_shopdb addon) and a live REST backend (rest addon), optional
openspec/               specs per capability, proposed changes
docs/                   ADRs, the change path, the guide, these notes
site/                   the project page
```
