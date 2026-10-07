# Knowledge: delta

## ADDED Requirements

### Requirement: Search the team's written knowledge

A `search_knowledge` tool SHALL search the Markdown files of the workspace's
`knowledge/` and `playbooks/` by full-text, for an app, and return passages
with their file path and heading, ranked, read-only.

#### Scenario: A runbook matches

- **WHEN** `search_knowledge` is called with "payment webhook 503" for `shop`
- **THEN** the passages of the runbook mentioning the webhook come back with their file and heading

### Requirement: Knowledge is evidence

Knowledge passages SHALL be returned as `Evidence` so a conclusion can cite
them next to logs and rows, and SHALL be treated as data like any other.
