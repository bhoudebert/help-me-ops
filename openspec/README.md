# Specifications

`specs/<capability>/spec.md` describes what the system does today, as
requirements with scenarios. `changes/` holds proposals that add or modify
requirements before they are implemented; once built, a change is folded into
the specs and its folder moves to `changes/archive/` (dated), kept as the
record of how it was decided.

| Capability | Covers                                                                                |
| ---------- | ------------------------------------------------------------------------------------- |
| workspace  | A team's folder: apps, environments, the scope of a question                          |
| addons     | Folders dropped in: tools, connector types, playbooks; discovery, settings, isolation |
| demo       | The demo workspace: a shop in prod and staging, a scenario that is a test             |
| connectors | Sources of evidence: the contract, read-only, log files, team modules, configuration  |
| playbooks  | How a team investigates a kind of problem, in Markdown, matched to a report           |
| knowledge  | Runbooks and past incidents in Markdown, searched by words, returned as evidence      |
| toolbox    | The tools shared by every client, their hints and errors                              |
| mcp-server | The server for Claude Code, Codex and Copilot: tools, instructions, prompt            |
| cli        | The terminal commands                                                                 |

| Change                                         | Status   |
| ---------------------------------------------- | -------- |
| [plug-in-kit](changes/plug-in-kit/proposal.md) | proposed |
