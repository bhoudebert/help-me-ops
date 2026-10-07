# CLI Specification

## Purpose

The toolbox from a terminal, without a model.

## Requirements

### Requirement: Commands

`npm run ops --` SHALL provide `sources`, `playbooks [question]`,
`search <source> <query> [--from] [--to] [--limit]` and
`investigate "<question>"`, which shows the matching playbook and the sources
until the investigation loop exists; anything else SHALL print the usage. An
error SHALL be printed on stderr with a non-zero exit code.
