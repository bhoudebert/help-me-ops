# Working in this repository

Read this before changing anything. It applies to people and to coding agents
(Claude Code, Codex, GitHub Copilot, others) alike.

## What this is

help-me-ops: a toolbox to investigate a running system from its own evidence
(logs, metrics, databases, HTTP checks), used from the terminal and over MCP by
Claude Code, Codex and GitHub Copilot. It ships the method and the plumbing;
the people running a system fill in **connectors** (where the evidence is) and
**playbooks** (how their team investigates). `README.md` explains the product;
the guide in `docs/guide/` how to use and extend it; `docs/ENGINEERING.md` how
it is built. `openspec/project.md` holds the conventions and the vocabulary;
`openspec/specs/<capability>/spec.md` describe the behaviour as requirements
with scenarios.

## Rules

The full path every feature follows, from idea to release, is in
`docs/EVOLVING.md`. The rules below are its short form.

1. **Branch, then pull request.** Never commit to `main`. Branch names:
   `feat/...`, `fix/...`, `docs/...`, `build/...`, `ci/...`, `chore/...`.
2. **Conventional Commits, strictly.** `<type>(<scope>): <subject>` with the
   types `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`,
   `chore`, `style`, `revert`; kebab-case scope; imperative subject; one
   concern per commit. Full rules and examples: `CONTRIBUTING.md`. The
   commit-msg hook and CI reject anything else.
3. **Spec first when behaviour changes.** Update or add the requirement in
   `openspec/specs/...` in the same PR, before or with the code; larger changes
   start as a proposal in `openspec/changes/`. A significant architectural
   choice gets a decision record in `docs/adr/` (read the existing ones before
   changing something they cover).
4. **Read-only, always.** No connector or tool changes the system it
   investigates (ADR 0002). A fix is proposed for a person to make.
5. **Tests with the code.** Deterministic logic gets unit tests in `test/`;
   connectors are tested against fixtures, never against a real system; tests
   never call a model API or spend money.
6. **Quality gate before pushing:** `npm run quality` (typecheck, lint, format
   check, tests with coverage thresholds) must pass. `npm run lint:fix` and
   `npm run format` fix most findings.
7. **Docs with the change.** The guide when usage changes, the README when the
   overview changes, `docs/ENGINEERING.md` when the architecture changes,
   `ROADMAP.md` when an idea is done or added.
8. **Pull request** with the template: summary, spec touched, what was
   verified, what was not. The maintainer reviews and merges.
9. **No attribution trailers** or generated-by footers in commits, PR
   descriptions or comments.

## Code conventions

- Connectors implement `Connector` (`src/connectors/types.ts`) and return
  `Evidence`; built-in ones live in `src/connectors/`, a team's own are modules
  referenced from `ops.config.json`.
- Tools are defined once in `src/tools/index.ts`, with their four MCP hints
  written out, and shared by every entry point.
- Entry points (`src/cli.ts`, `src/mcp.ts`) stay thin; logic lives in modules.
- The MCP server writes only protocol to stdout; logs go to stderr.
- TypeScript 7 is the compiler (`npm run typecheck`); the `typescript` package
  is the TypeScript 6 API alias for tooling. Do not "fix" that.

## Investigating, as opposed to developing

When asked to investigate a problem ("order 4512 is stuck"), use the
`help-me-ops` MCP tools (`scope`, `listSources`, `searchSource`, the addon
tools), not the shell. Files under `examples/workspace` (logs, data) stand for a
remote system: read them only through the tools, as a real investigation would.
If the tools are missing, the project server needs approving (`/mcp` in Claude
Code) rather than working around it.

## Useful commands

```
npm run ops -- sources                 # what the config connects
npm run ops -- search <source> <term>  # one source, read-only
npm run ops -- investigate "<problem>" # the playbook and where to look
npm run mcp                            # the MCP server on stdio
npm run quality                        # the gate
npm test                               # unit tests only
npm run docs:dev                       # the guide, locally
```
