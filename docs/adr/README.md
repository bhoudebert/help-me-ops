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

| [0009](0009-addon-authoring.md) | Write an addon as a manifest and plain functions, with no MCP knowledge | accepted |
| [0010](0010-mask-at-the-tool-boundary.md) | Mask what the tools return, at the one place every answer passes | accepted |
| [0011](0011-addons-declare-whats-personal.md) | Addons declare what is personal, as JSON that can only hide | accepted |
| [0012](0012-declare-the-data-and-a-strict-mode.md) | Declare which sources hold personal data, and an optional strict mode | accepted |
| [0013](0013-stable-placeholders.md) | Stable placeholders, as an option next to the stars | accepted |
| [0014](0014-api-mode-and-local-models.md) | An optional API mode: the toolbox driven by a model you choose, local or hosted | accepted |

New records start from [template.md](template.md).
