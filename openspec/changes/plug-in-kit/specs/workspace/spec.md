# Workspace: delta

The workspace folder, apps and environments, and the `scope` tool are folded
into `openspec/specs/workspace`. What remains:

## ADDED Requirements

### Requirement: The workspace holds knowledge and addons

A workspace SHALL also hold `knowledge/` (see the knowledge delta) and
`addons/` (see the addons delta), both optional.

### Requirement: Secrets stay out of the file

The configuration SHALL name environment variables for credentials, never hold
their values. (Addon settings do, with `${NAME}`; the options of a source come
with the addon-check change.)
