# CLI Specification

## Purpose

The toolbox from a terminal, without a model.

## Requirements

### Requirement: Commands

`npm run ops --` SHALL provide `scope [question]`, `sources`,
`playbooks [question]`, `search <source> <query> [--from] [--to] [--limit]` and
`doctor` (the addons loaded or skipped, and why) and `investigate "<question>"`, which shows the matching playbook and the sources
of every app and environment; anything else SHALL print the usage. An error
SHALL be printed on stderr with a non-zero exit code.

### Requirement: Connect a client

`ops setup [claude|codex|copilot|all]` SHALL check that Node is version 24 or
more and that the workspace loads, start the server the way a client will start
it and ask it for its tools over MCP, and print, with absolute paths, what each
client needs: the `claude mcp add` command and the `.mcp.json` for Claude Code, the
`~/.codex/config.toml` block for Codex, the `.vscode/mcp.json` for Copilot in VS
Code. It SHALL exit non-zero, naming the failure, when a check fails. With
`--into <project> --write` it SHALL add the server to the project's `.mcp.json` and
`.vscode/mcp.json`, keeping every other entry, SHALL NOT replace an existing
`help-me-ops` entry or touch a file that is not valid JSON, SHALL NOT write after a
failed check, and SHALL NOT write the user's Codex configuration. Without
`--workspace` and `OPS_WORKSPACE` it SHALL use the shipped demo workspace and say so.

#### Scenario: Connect Claude Code

- **WHEN** `ops setup claude` is run
- **THEN** the workspace and the server are checked, and the command and the JSON are printed with the paths of this clone

### Requirement: Workspace and scope options

Every command SHALL accept `--workspace <dir>` (before or after the command),
`--addons <dir[:dir]>`,
`--app <name>` and `--env <name>`.
