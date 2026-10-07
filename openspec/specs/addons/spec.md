# Addons Specification

## Purpose

Let a team extend help-me-ops by dropping a folder in, and update the kit
without breaking what it added.

## Requirements

### Requirement: Discovered, not registered

At startup the server and the CLI SHALL scan the addon folders and load every
folder holding an `addon.ts`, or only written knowledge (`playbooks/`,
`knowledge/`). Nothing SHALL need to be listed in `ops.config.json`. A folder
whose name starts with `_` or `.` SHALL be skipped, and so SHALL a folder that
holds none of these.

#### Scenario: Drop a folder in

- **WHEN** a folder `order/` with an `addon.ts` is copied into `<workspace>/addons/` and the server restarts
- **THEN** its tools are listed, namespaced `order.…`, with no change to the configuration

#### Scenario: Turn one off

- **WHEN** the folder is renamed `_order`
- **THEN** it is not loaded and nothing else changes

### Requirement: A list of addon folders

Addons SHALL be loaded from, in order: this repository's `addons/`, the folders
of `--addons` and `OPS_ADDONS` (`:`-separated), then `<workspace>/addons/`.
When two addons share a name the later SHALL win and the report SHALL name
both folders.

### Requirement: The definition

An `addon.ts` SHALL default-export a definition, or a function receiving `{ z }`
and returning one, so an addon needs no packages of its own. A definition has
an `apiVersion`, and optionally `settings`, `env`, `tools` and `connectors`. The
folder name, lowercase letters, digits and hyphens, is the addon's name.

### Requirement: Namespaced, read-only tools

An addon's tools SHALL be namespaced by the addon, take `app` and `env` like
the core tools, declare the four MCP hints with `readOnlyHint: true` and
`destructiveHint: false`, and return `Evidence`; their result SHALL name the
app, environment and tool. A tool that does not declare them SHALL cause its
addon to be skipped.

### Requirement: Settings from the environment

An addon's `settings` schema SHALL be filled, per app and environment, from
the environment variables its `env` map names, overridden by the
environment's `addons.<name>` in the configuration, where `${NAME}` stands for
the environment variable NAME. They SHALL be validated at startup; an
environment where they are invalid SHALL be noted and its tool calls refused
with the reason, the others working.

### Requirement: Connector types

An addon MAY bring connector types, usable as `type` in a source with the
options the type declares. The built-in `file-logs` type SHALL be one, in
`addons/logs`. A source whose type no loaded addon provides SHALL be left out
with a warning, and the rest of its environment SHALL work.

### Requirement: Written knowledge

An addon's `playbooks/` SHALL be served with the workspace's, their ids
prefixed by the addon name.

### Requirement: A failing addon never takes the rest down

An addon with an invalid name or definition, an unsupported `apiVersion`, a
tool without the read-only hints, or an error at load SHALL be skipped with one
line saying why; the other addons and the core tools SHALL keep working.
`doctor` SHALL list every addon as loaded, skipped or replaced, with the reason
and the notes, and the CLI and the server SHALL print the non-loaded ones to
stderr at start.

#### Scenario: Wrong API version

- **WHEN** an addon declares an `apiVersion` the core does not support
- **THEN** it is skipped with a line naming both versions, and the server starts

### Requirement: Never fetched

The core SHALL NOT download an addon from a URL or a registry; addons are
folders already on disk.
