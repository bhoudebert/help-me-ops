# 0003. Ship the method; teams fill in connectors and playbooks

- Status: accepted
- Date: 2026-10-07

## Context

Every system is different: its logs, its databases, its queues, what "an order
is stuck" means. A generic tool cannot know them; a tool built for one system
cannot be reused.

## Decision

Two extension points, both plain files a team owns:

- **Connectors** implement one small interface (`Connector`: an id, a kind, a
  description, `search` returning `Evidence`). Common ones ship built in (log
  files today); a team's own are TypeScript modules exporting
  `createConnector`, referenced from `ops.config.json`.
- **Playbooks** are Markdown files: when they apply, in the words people report
  problems with, and the steps naming the sources to search. The model follows
  a matching playbook before improvising.

`ops.config.json` (git-ignored, from `ops.config.example.json`) lists the
sources of one installation.

## Consequences

A team gets value from one connector and one playbook, and grows from there.
Playbooks double as written runbooks for people. The quality of an
investigation depends on what the team writes, which is visible and
reviewable.

## Alternatives considered

A plugin registry with packages: heavier than a file path for teams that own
their code. Playbooks as code: harder for non-developers on call to write.
