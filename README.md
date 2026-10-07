# help-me-ops

[![CI](https://github.com/bhoudebert/help-me-ops/actions/workflows/ci.yml/badge.svg)](https://github.com/bhoudebert/help-me-ops/actions/workflows/ci.yml)
[![CodeQL](https://github.com/bhoudebert/help-me-ops/actions/workflows/codeql.yml/badge.svg)](https://github.com/bhoudebert/help-me-ops/actions/workflows/codeql.yml)
[![Release](https://img.shields.io/github/v/release/bhoudebert/help-me-ops?display_name=tag&sort=semver)](https://github.com/bhoudebert/help-me-ops/releases)
[![Node 24](https://img.shields.io/badge/node-%E2%89%A524-339933?logo=node.js&logoColor=white)](.nvmrc)
[![Licence MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)
[![Conventional Commits](https://img.shields.io/badge/commits-conventional-fe5196?logo=conventionalcommits&logoColor=white)](CONTRIBUTING.md)

**Oh, help me, ops.** Investigate a running system from its own evidence (logs,
metrics, databases, HTTP checks) with the AI you already use: Claude Code,
Codex or GitHub Copilot.

> "Client u-881 paid but cannot find order 4512."
>
> The order is `awaiting_payment` since 09:58. The payment provider's webhook
> was refused with a 503 at 10:00 because the confirmation queue was full, and
> its worker was crash-looping (OOMKilled) from 10:01. Likely cause: the
> webhook was lost while the worker was down. Next step: replay the webhook
> for order 4512 once the worker is back, and check the other orders of that
> window.

help-me-ops ships **the method and the plumbing**. You fill in the blanks for
your system:

- **Connectors**: where the evidence is. A log file works out of the box; a
  database, a metrics store or an API is a small module you write once.
- **Playbooks**: how your team investigates each kind of problem, in Markdown.
  The assistant follows them before improvising.

Everything is **read-only**: it searches, quotes and concludes; a fix is
proposed for a person to make.

**How to use and extend it:** the [guide](https://bhoudebert.github.io/help-me-ops/guide/)
(source in [`docs/guide/`](docs/guide/)).

## Status

Working today, with a demo world to try it on: a **workspace** folder per team
(apps, environments, sources, playbooks), **addons** dropped in to add tools,
connector types and written knowledge, a `scope` step so a question in prod is
never read from staging, one read-only toolbox for Claude Code, Codex and
Copilot over MCP, and a terminal CLI. The model is the client's; this project
makes no model calls. Next: searchable runbooks, a checked conclusion, a
scripted demo and setup helpers
([`openspec/changes/plug-in-kit`](openspec/changes/plug-in-kit/proposal.md)).

## Try it

```bash
git clone https://github.com/bhoudebert/help-me-ops.git && cd help-me-ops
nvm use && npm install
claude        # or open the folder in VS Code (Copilot), or add the server to Codex
```

Then ask: **"client u-881 paid but cannot find order 4512, what happened?"**

The repository ships a small shop to investigate (`examples/workspace`): logs,
orders, metrics and health checks in `prod` and `staging`, with a fault in
`prod` only. The assistant has to find it across four sources, tell prod from
staging, and conclude with the likely cause, its evidence and what is unknown.
[The story and what to expect](https://bhoudebert.github.io/help-me-ops/guide/demo).
No client? The same tools run from the terminal:

```bash
export OPS_WORKSPACE=examples/workspace
npm run ops -- scope "orders are stuck in production"
npm run ops -- search app-logs order=4512 --env prod
npm run ops -- doctor
```

## Plug in your own

Copy `examples/workspace` to a folder of your own (in your app's repository, for
example) and point to it with `--workspace` or `OPS_WORKSPACE`. Replace the
fixtures one source at a time: logs need no code; a database, metrics or a
health check are an addon, a folder you drop in `addons/` (the demo's
`order`, `metrics` and `health` are templates). Write a
[playbook](https://bhoudebert.github.io/help-me-ops/guide/playbooks) for the
problem you investigate most often. Credentials stay in the environment, and a
broken addon is skipped with a reason, never fatal.

## How it is built

- **One toolbox, every client**: tools defined once with their MCP hints,
  served over MCP and the CLI (ADR 0004).
- **Read-only by design**: connectors only search, tools declare it, tests
  check it (ADR 0002).
- **Extension by files a team owns**: Markdown playbooks, connector modules and
  addons, folders dropped in and loaded at startup, a broken one skipped
  rather than fatal (ADR 0003, 0008).
- **Specified and tested**: OpenSpec requirements per capability, tests against
  fixtures, never a real system or a model API.

## Documentation map

|                                            |                                               |
| ------------------------------------------ | --------------------------------------------- |
| [AGENTS.md](AGENTS.md)                     | Rules for people and coding agents            |
| [docs/EVOLVING.md](docs/EVOLVING.md)       | The path of every change, idea to release     |
| [CONTRIBUTING.md](CONTRIBUTING.md)         | Setup, commits, releases                      |
| [docs/ENGINEERING.md](docs/ENGINEERING.md) | How it is built                               |
| [docs/adr/](docs/adr/)                     | Decisions and why                             |
| [openspec/](openspec/)                     | Requirements per capability, proposed changes |
| [ROADMAP.md](ROADMAP.md)                   | What comes next                               |

## Licence

MIT. See [LICENSE](LICENSE).
