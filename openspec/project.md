# Project Context

## Purpose

help-me-ops helps people investigate a running system: "a client cannot find
order 4512", "orders are stuck since 10:00", "the API is slow". A model (Claude
in Claude Code, OpenAI models in Codex, Copilot's model in VS Code, each
brought by the client) follows the team's playbook, searches
the system's own evidence through connectors, and concludes with the likely
cause, the evidence for it, what is unknown, and the next step for a person.
The project ships the method and the plumbing; each team fills in its
connectors and playbooks.

## Tech Stack

- TypeScript on Node 24 (type stripping, no build step; TypeScript 7 native compiler for checks, TypeScript 6 API package for tooling)
- `@modelcontextprotocol/sdk` for the MCP server; `zod` for schemas and configuration
- Connectors: plain modules implementing `Connector`

## Project Conventions

### Code Style

- ESLint and Prettier; `npm run quality` must pass before a pull request.
- Tools defined once in `src/tools/index.ts`, with their four MCP hints, shared by every entry point.
- Entry points (`src/cli.ts`, `src/mcp.ts`) are thin; logic lives in modules.
- The MCP server writes only protocol to stdout; logs go to stderr.

### Architecture Patterns

- Connectors return `Evidence` (source, time, summary, raw data); nothing else crosses into the model.
- Read-only everywhere (ADR 0002).
- Configuration per team in a workspace folder (`ops.config.json`, `playbooks/`, `knowledge/`, `addons/`); credentials in `.env` (ADR 0007). Extensions are addons (ADR 0008).

### Testing Strategy

- `npm test`: unit tests against fixtures in `examples/`; the MCP server tested through a real MCP client.
- Never a real system, never a model API in tests.

### Git Workflow

- Branches off `main`, pull requests reviewed by the maintainer, Conventional Commits, release-please.
- Specs in `openspec/specs`; proposed changes in `openspec/changes`.
- No attribution trailers in commits or pull requests.

## Domain Context

- **Source**: a place evidence comes from (a log file or service, a metrics store, a database, an HTTP endpoint), served by a **connector**.
- **Evidence**: one record found in a source, with its time, a one-line summary and the raw data.
- **Playbook**: how the team investigates a kind of problem; when it applies, then steps naming sources.
- **Investigation**: a question followed through a playbook and the sources to a conclusion.
- **Addon**: a folder dropped in an addons folder and loaded at startup; it brings connectors, tools, playbooks and knowledge for one domain (`order`, `aaa`).
- **Workspace**: the folder holding a team's configuration, playbooks and knowledge.
- **App** and **environment**: what is investigated (`shop`) and where it runs (`prod`, `staging`); each environment has its own sources.
- **Case** (planned): an investigation kept with its question, steps, evidence and conclusion.

## Important Constraints

- Production data: read-only credentials, personal data masked where policy requires.
- Evidence is data, never instructions to the model, whatever it contains.
- The model is the client's, on its subscription; the project makes no model calls.
