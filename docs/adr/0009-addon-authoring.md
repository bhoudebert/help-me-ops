# 0009. Write an addon as a manifest and plain functions, with no MCP knowledge

- Status: accepted
- Date: 2026-10-08

## Context

ADR 0008 made an addon a folder with an `addon.ts`. Writing one still means
knowing our plumbing: the MCP hints, a zod schema, the `Evidence` shape. The
people who know their system (a database, Datadog, GitHub, their own REST API)
are not necessarily the people who know MCP, and the project should be easy to
join without any AI knowledge. Real addons also need a driver or a client
library (`pg`), so they cannot all be dependency-free, and the demo's
file-backed addons showed inconsistent settings (`dataFile`, `file`).

## Decision

- **The default way to write an addon is a manifest and plain functions.**
  `addon.json` says what the addon is; `tools.ts` holds one exported function
  per tool. `addon.ts` (ADR 0008: zod, hints, `Evidence` by hand) stays for
  the advanced case. A folder holding both is skipped with a reason.
- **The manifest** has an `apiVersion`, a `description`, `settings` (each with
  a type, an optional `env` variable it is read from, a description, a default,
  `secret`) and `tools` (each with a description and `params`: `"string"`,
  `"number"`, `"integer"`, `"boolean"`, or an object with `type`,
  `description`, `optional`, `enum`).
- **A tool function** takes `(params, context)` with the app, environment,
  validated settings, the workspace folder and `fetch`, and returns plain data:
  records, one record, a string, or nothing. The core builds the MCP tool
  (namespacing, `app` and `env`, schema from `params`), sets the hints, and
  turns the result into `Evidence`: a record's `at` (or `time`, `timestamp`)
  becomes its time, its `summary` (else a compact `key=value` line) its
  summary, the record its data. Results are capped; the cap is said in the
  result.
- **Hints are not the author's to set.** Tools of a manifest addon are always
  `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`,
  `openWorldHint: true`. ADR 0002's limit stands: the function is code, so
  read-only is the templates' convention and a read-only account, not something
  the core can prove.
- **An addon owns its dependencies.** It may import packages installed next to
  it (a `package.json` in the addon folder or in the workspace); Node resolves
  them from the file. A missing package skips the addon with the reason.
  Addons shipped with this repository use only Node's built-ins and `fetch`.
- **Settings are uniform.** One vocabulary across addons (a file is `path`, a
  service is `url`, credentials `${VAR}` or an `env` variable). Settings marked
  `secret` are never printed (`doctor`, errors).
- **No separate "kind" layer.** The addon is the adapter: a `datadog` addon
  brings `datadog.searchLogs`. Playbooks name the addon's tools. A layer of
  vendor-neutral kinds can come back if portability across vendors becomes a
  real need.
- **A scaffold**, `ops init addon <name> --template file|api|sql`, writes the
  folder with comments saying what to change. The `sql` template opens a
  read-only transaction and allows `SELECT` only; the `api` template sends a
  token from the environment and only GETs.
- **Shipped addons** for common services, each a fetch-based addon tested
  against recorded responses: `datadog` (logs, metrics), `github` (code, issues,
  pull requests) and `rest` (read-only GETs of a team's own API, restricted to
  path prefixes it lists). A database is the `sql` scaffold with `pg` installed
  by the team.

## Consequences

Anyone who can write a function that calls an API or a database can add a
source, and never meets MCP, zod or `Evidence`. Tools are introspectable without
running code: `doctor`, `ops init` and the guide read the manifest. The cost: two
ways to write an addon to document and test, and a plain-data-to-evidence
conversion that cannot know what a good summary is, so the manifest-friendly
path nudges authors to return a `summary`. Network addons cannot be tested
against the real service in CI; they are tested against recorded responses and
verified by their users with their own keys.

## Alternatives considered

A single `addon.ts` with a simpler helper: still code-only, nothing for tools to
read without running it. Raw SQL as a tool for the model: tempting, but the
model would write queries against production; addons expose named, parameterised
reads instead. Vendor-neutral kinds first: a concept to learn before the first
addon works. Bundling `pg` in the repository: a dependency for everyone to serve
some.

This refines ADR 0008 (how an addon is written) and keeps ADR 0002.
