# Addons: delta

The loader, discovery, settings, connector types and isolation are folded into
`openspec/specs/addons`. What remains (ADR 0009):

## ADDED Requirements

### Requirement: A manifest and plain functions

An addon folder holding `addon.json` and `tools.ts` SHALL be loaded without the
author writing any MCP, zod or evidence code. The manifest declares an
`apiVersion`, a `description`, `settings` and `tools` with their `params`; each
tool is an exported function of `tools.ts` taking `(params, context)`. A folder
holding both `addon.json` and `addon.ts` SHALL be skipped with a reason, and so
SHALL a manifest tool without its function, or the reverse.

#### Scenario: A tool from a function

- **WHEN** `addon.json` declares tool `getOrder` with param `id` and `tools.ts` exports `getOrder`
- **THEN** `order.getOrder` is served with `app`, `env` and `id`, and calling it runs the function with the validated params and the addon's settings for that environment

### Requirement: Parameters and settings in the manifest

Parameters and settings SHALL be declared as `"string"`, `"number"`,
`"integer"` or `"boolean"`, or as an object with `type`, `description`,
`optional` or `default`, `enum`; a setting MAY name the environment variable it
is read from. Invalid parameters SHALL be refused naming the parameter. Settings
marked `secret` SHALL never be printed.

### Requirement: Read-only hints are not the author's

A manifest addon's tools SHALL always declare `readOnlyHint: true`,
`destructiveHint: false`, `idempotentHint: true` and `openWorldHint: true`.

### Requirement: Plain data becomes evidence

What a tool function returns, records, one record, a string or nothing, SHALL
be turned into evidence: the record's `at`, `time` or `timestamp` as its time,
its `summary` or else a compact `key=value` line as its summary, the record as
its data. A result SHALL be capped, and the cap said in the result.

### Requirement: An addon owns its dependencies

An addon MAY import packages installed next to it; one that cannot be imported
SHALL be skipped with the reason, and the others SHALL keep working. Addons
shipped with this repository SHALL use only Node's built-ins and `fetch`.

### Requirement: Scaffold an addon

`ops init addon <name> --template file|api|sql` SHALL write a working addon
folder into `<workspace>/addons/` with comments saying what to change, and SHALL
refuse to overwrite an existing folder. The `sql` template SHALL read through a
read-only transaction with `SELECT` only; the `api` template SHALL only GET.

### Requirement: Shipped addons for common services

The repository SHALL ship `datadog` (logs, metrics), `github` (code, issues,
pull requests) and `rest` (read-only GETs of a team's own API, restricted to the
path prefixes its settings list), each tested against recorded responses.

### Requirement: Check an addon

`ops addon check <dir>` SHALL verify the manifest, the settings, the tools, and
a sample call against fixtures, and exit non-zero on a failure.

### Requirement: Credentials of every source

A source's options SHALL be able to name an environment variable for a
credential (`${NAME}`) as an addon's settings do, so a configuration holds no
secret.
