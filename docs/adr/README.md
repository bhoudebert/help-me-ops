# Architecture decision records

| ADR                                        | Decision                                                                   | Status   |
| ------------------------------------------ | -------------------------------------------------------------------------- | -------- |
| [0001](0001-record-decisions.md)           | Record architectural decisions                                             | accepted |
| [0002](0002-read-only-by-default.md)       | Investigate, never act: every connector and tool is read-only              | accepted |
| [0003](0003-connectors-and-playbooks.md)   | Ship the method; teams fill in connectors and playbooks                    | accepted |
| [0004](0004-one-toolbox-every-client.md)   | One toolbox, every client: CLI, and MCP for Claude Code, Codex and Copilot | accepted |
| [0005](0005-tooling.md)                    | Node 24 without a build, TypeScript 7, ESLint and Prettier                 | accepted |
| [0006](0006-commits-and-releases.md)       | Conventional Commits and automated releases                                | accepted |
| [0007](0007-workspace-and-client-model.md) | The client hosts the model; a workspace folder with apps and environments  | accepted |
| [0008](0008-addons.md)                     | Extend through addons: a folder dropped in, loaded at startup              | accepted |

New records start from [template.md](template.md).
