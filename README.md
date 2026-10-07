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

A skeleton: connectors (log files, a database template), playbooks, a shared
read-only toolbox, a CLI and an MCP server for Claude Code, Codex and Copilot,
with specs, decisions, tests, CI and releases. The investigation itself runs
in the AI clients over MCP, which bring their own model. Next: a plug-in kit
(a workspace folder per team, apps and environments, searchable runbooks) and
a demo world to try it without a real system
([`openspec/changes/plug-in-kit`](openspec/changes/plug-in-kit/proposal.md)).

## Quick start

```bash
nvm use && npm install
npm run ops -- --workspace examples/workspace investigate "client u-881 paid but cannot find order 4512"
```

The demo workspace in `examples/workspace` is one app (`shop`) with its sources
and a playbook. To plug in your own, copy it to a folder of your own and point
to it with `--workspace` or `OPS_WORKSPACE`. Then open the folder in Claude Code (`.mcp.json`), VS Code with Copilot
(`.vscode/mcp.json`), or add it to Codex
([clients](https://bhoudebert.github.io/help-me-ops/guide/clients)), and ask.

## How it is built

- **One toolbox, every client**: tools defined once with their MCP hints,
  served over MCP and the CLI (ADR 0004).
- **Read-only by design**: connectors only search, tools declare it, tests
  check it (ADR 0002).
- **Extension by files a team owns**: connector modules and Markdown playbooks
  (ADR 0003).
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
