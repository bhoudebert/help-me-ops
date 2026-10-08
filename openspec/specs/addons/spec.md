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

### Requirement: A manifest and plain functions

An addon folder holding `addon.json` and `tools.ts` SHALL be loaded without the
author writing any MCP, zod or evidence code. The manifest declares an
`apiVersion`, a `description`, `settings` and `tools` with their `params`; each
tool is an exported function of `tools.ts` taking `(params, context)`, where the
context holds the app, environment, validated settings, the workspace folder and
`fetch`. A folder holding both `addon.json` and `addon.ts` SHALL be skipped with
a reason, and so SHALL a manifest tool without its function, or an exported
function the manifest does not declare.

#### Scenario: A tool from a function

- **WHEN** `addon.json` declares tool `getOrder` with param `id` and `tools.ts` exports `getOrder`
- **THEN** `order.getOrder` is served with `app`, `env` and `id`, and calling it runs the function with the validated params and the addon's settings for that environment

### Requirement: Parameters and settings in the manifest

Parameters and settings SHALL be declared as `"string"`, `"number"`,
`"integer"` or `"boolean"`, or as an object with `type`, `description`,
`optional` or `default`, `enum`; a setting MAY name the environment variable it
is read from (typed from its text), and MAY be `secret`. Names SHALL be letters,
digits and underscores. Invalid parameters SHALL be refused naming the
parameter; the value of a secret setting SHALL never appear in an error.

### Requirement: Scaffold an addon

`ops init addon <name> --template file|api|sql` SHALL write a working addon
folder (`addon.json` and `tools.ts`) into `<workspace>/addons/`, with comments
saying what to change, and SHALL refuse to overwrite an existing folder, writing
nothing. The name SHALL be lowercase letters, digits and hyphens. The `sql`
template SHALL run inside a read-only transaction with a parameterised `SELECT`;
the `api` template SHALL only GET.

#### Scenario: Scaffold, then check

- **WHEN** `init addon billing --template api` is run and the settings are put in the configuration
- **THEN** `doctor` lists `billing` as loaded and its tool is served as `billing.getItem`

#### Scenario: Existing folder

- **WHEN** the folder `addons/billing` already exists
- **THEN** the command fails saying so and the folder is unchanged

### Requirement: Idle until set up

An addon with settings that no environment sets up (no entry under `addons` in
the configuration, none of its environment variables set, and settings that do
not validate when empty), or whose configured settings only wait for
`${VARIABLE}`s this machine does not have, SHALL be reported as `idle` (naming
the variables it waits for), serve no tool and print nothing at start. A
variable missing in one environment while another is set up SHALL make that
environment's tools refuse, naming the variable. In an environment that does not set it up while another does,
its tools SHALL refuse with a message saying what to add. An addon set up with
settings that do not validate SHALL stay noted as unavailable.

#### Scenario: Shipped, not used

- **WHEN** a workspace sets up no shipped addon
- **THEN** `doctor` lists them as `idle` with what to add, the tool list holds none of their tools, and the start-up notices do not mention them

#### Scenario: Configured, credentials absent

- **WHEN** the configuration sets `rest` up with `${SHOP_API_TOKEN}` and that variable is not set
- **THEN** `rest` is `idle`, `doctor` says it waits for `SHOP_API_TOKEN`, and nothing is printed at start

### Requirement: A shipped `rest` addon

The repository SHALL ship a `rest` addon whose `get` tool performs GET requests
only, on paths under the prefixes its `allow` setting lists, on the host of its
`baseUrl`. It SHALL refuse a path that goes up (`..`, encoded or not), names
another host, carries a query or fragment, or lies outside the prefixes; SHALL
NOT follow redirects; SHALL cap the answer and the time; SHALL send its token
only in the configured header; and SHALL never show the token in an error. A JSON
list SHALL become one evidence per item, with the item's time field.

#### Scenario: Outside the allowed paths

- **WHEN** `rest.get` is asked for `/admin/users` and only `/orders` and `/health` are allowed
- **THEN** it refuses and no request is made

### Requirement: A shipped `datadog` addon

The repository SHALL ship a `datadog` addon with three tools: `searchLogs` (the
Logs Search v2 API), `queryMetric` (the v1 metrics query) and `monitors` (the v1
list of monitors). It SHALL send the two Datadog keys as the `DD-API-KEY` and
`DD-APPLICATION-KEY` headers, reach `https://api.<site>` (or a `baseUrl` override),
refuse a site that is not a hostname and a time that is neither ISO 8601 nor
relative (`now-15m`), cap the logs at 100 and the points at about 50 per series,
not follow redirects, time out, and never show the keys in an error. It SHALL
issue no request other than these three, and the only non-GET is the log
search, a query that changes nothing. A refused key SHALL be reported as such
with what to check.

Until it has been verified against a real Datadog instance, the addon and each of
its tools SHALL be described as experimental to people and to the assistant, and
the documentation SHALL say it may not work as is.

#### Scenario: Logs of an incident

- **WHEN** `datadog.searchLogs` is called with `service:payments status:error` and a time range
- **THEN** one POST of the documented search body is sent, and each returned log becomes evidence with its timestamp and a `status service: message` line

### Requirement: Plain data becomes evidence

What a tool function returns, records, one record, a string or nothing, SHALL
be turned into evidence: the record's `at`, `time` or `timestamp` (an ISO 8601
date) as its time, its `summary` or else a compact `key=value` line as its
summary, the record as its data, whose dates and big numbers are made JSON-safe.
A result SHALL be capped at 100 and the cap said in the result.

### Requirement: The definition in code

An `addon.ts` MAY instead default-export a definition, or a function receiving
`{ z, defineTool }` and returning one, for full control. A definition has an
`apiVersion`, and optionally `settings`, `env`, `tools` and `connectors`. The
folder name, lowercase letters, digits and hyphens, is the addon's name.

### Requirement: An addon owns its dependencies

An addon MAY import packages installed next to it; one that cannot be imported
SHALL be skipped with the reason, and the others SHALL keep working.

### Requirement: Namespaced, read-only tools

An addon's tools SHALL be namespaced by the addon, take `app` and `env` like
the core tools, and declare the four MCP hints with `readOnlyHint: true` and
`destructiveHint: false`; their result SHALL name the app, environment and tool.
The tools of a manifest addon always declare them; a tool of an `addon.ts` that
does not SHALL cause its addon to be skipped.

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
