# Workspace: delta

## ADDED Requirements

### Requirement: One folder per team

A workspace SHALL be one directory holding `ops.config.json`, `playbooks/` and
`knowledge/`. The CLI and the MCP server SHALL accept `--workspace <dir>`, and
default to the current directory.

#### Scenario: Run from another repository

- **WHEN** the server is started with `--workspace ../shop/ops`
- **THEN** sources, playbooks and knowledge are read from that folder only

### Requirement: Apps and environments

The configuration SHALL declare apps, each with environments, each with its
sources. Tools that read evidence SHALL take `app` and `env`; when omitted and
unambiguous they SHALL default, otherwise they SHALL ask which to use.

#### Scenario: Same question, two environments

- **WHEN** order 4512 is searched in `shop` `prod` and in `shop` `staging`
- **THEN** each search reads only that environment's sources

### Requirement: Resolve the scope

A `scope` tool SHALL list the apps and environments, and propose the likely
ones for a question, with the reason, without reading any evidence.

### Requirement: Secrets stay out of the file

The configuration SHALL name environment variables for credentials, never hold
their values.
