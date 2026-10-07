# Addons: delta

## ADDED Requirements

### Requirement: Discovered, not registered

At startup the server and the CLI SHALL scan the addon folders and load every
folder holding an `addon.ts`, or only written knowledge (`playbooks/`,
`knowledge/`). Nothing SHALL need to be listed in `ops.config.json`. A folder
whose name starts with `_` SHALL be skipped.

#### Scenario: Drop a folder in

- **WHEN** a folder `order/` with an `addon.ts` is copied into `<workspace>/addons/` and the server restarts
- **THEN** its tools are listed, namespaced `order.…`, with no change to the configuration

#### Scenario: Turn one off

- **WHEN** the folder is renamed `_order`
- **THEN** it is not loaded and nothing else changes

### Requirement: A list of addon folders

Addons SHALL be loaded from, in order: this repository's `addons/`, the folders
of `--addons` and `OPS_ADDONS` (`:`-separated), then `<workspace>/addons/`.
When two addons share a name the later SHALL win and a warning SHALL name both.

### Requirement: Namespaced, read-only tools

An addon's tools SHALL be namespaced by the addon, declare the four MCP hints
with `readOnlyHint: true` and `destructiveHint: false`, and return `Evidence`.
A tool that does not declare them SHALL cause its addon to be skipped.

### Requirement: Settings from the environment

An addon SHALL declare its settings as a schema, read from environment
variables first, overridable per app and environment in the workspace
configuration, and validated at startup. Credentials SHALL never be stored in
the configuration.

### Requirement: A failing addon never takes the rest down

An addon with an invalid manifest, an unsupported `apiVersion`, invalid
settings or an error at load SHALL be skipped with one line saying why; the
other addons and the built-in tools SHALL keep working. `ops doctor` SHALL list
the addons loaded and skipped, with the reason.

#### Scenario: Wrong API version

- **WHEN** an addon declares an `apiVersion` the core does not support
- **THEN** it is skipped with a line naming both versions, and the server starts

### Requirement: Check an addon

`ops addon check <dir>` SHALL verify the manifest, the settings schema, the
tool hints and a sample call against fixtures, and exit non-zero on a failure.

### Requirement: Never fetched

The core SHALL NOT download an addon from a URL or a registry; addons are
folders already on disk.
