# CLI Specification

## Purpose

The toolbox from a terminal, without a model.

## Requirements

### Requirement: Commands

`npm run ops --` SHALL provide `scope [question]`, `sources`,
`playbooks [question]`, `search <source> <query> [--from] [--to] [--limit]` and
`investigate "<question>"`, which shows the matching playbook and the sources
of every app and environment; anything else SHALL print the usage. An error
SHALL be printed on stderr with a non-zero exit code.

### Requirement: Workspace and scope options

Every command SHALL accept `--workspace <dir>` (before or after the command),
`--app <name>` and `--env <name>`.
