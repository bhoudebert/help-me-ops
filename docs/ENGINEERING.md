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
- `src/addons/` loads addon folders (`loader.ts`), turns them into settings,
  namespaced tools and connector types (`runtime.ts`), and holds the API addon
  authors write against (`types.ts`). `addons/` at the root holds the built-ins.
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

| Tool            | Input                                       | Returns                           |
| --------------- | ------------------------------------------- | --------------------------------- |
| `listSources`   | none                                        | Sources with kind and description |
| `searchSource`  | `source`, `query`, `from?`, `to?`, `limit?` | Evidence, in source order         |
| `listPlaybooks` | `question?`                                 | Playbooks, matching ones first    |
| `getPlaybook`   | `id`                                        | The playbook's steps              |

All read-only (`readOnlyHint: true`, `destructiveHint: false`); `searchSource`
is open-world (it reaches the investigated system).

## Tests

`npm test` runs against `examples/workspace`, the demo world (a shop in prod and
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
  addons/               addon loader, settings, tools, the addon API
addons/                 built-in addons (logs: the file-logs connector type)
  toolbox.ts            workspace → apps, connectors, playbooks
  connectors/           the contract, file-logs, the registry
  playbooks.ts          Markdown playbooks, matching
  tools/index.ts        the tools, defined once
examples/workspace/     the demo workspace: config, logs, data, addons, a playbook, a scenario
openspec/               specs per capability, proposed changes
docs/                   ADRs, the change path, the guide, these notes
site/                   the project page
```
