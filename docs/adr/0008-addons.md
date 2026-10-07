# 0008. Extend through addons: a folder dropped in, loaded at startup

- Status: accepted
- Date: 2026-10-07

## Context

ADR 0003 gave teams two extension points, connectors referenced from
`ops.config.json` and Markdown playbooks. Real teams want more than a
connector: a domain (`order`) that brings its own tools with their own
parameters (environment, ids), its playbooks and runbooks, or a source of code
the model can read next to the logs. They want to add it the way a game takes
an addon, by dropping a folder in, and to update this repository without
breaking it.

## Decision

- An **addon** is a folder holding an `addon.ts` whose default export is a
  definition, or a function receiving `{ z }` and returning one (so an addon
  needs no packages of its own; `defineAddon` only types it) and optionally `playbooks/`, `knowledge/`, a `README.md` and an
  `.env.example`. An addon can bring connectors, tools and written knowledge.
  A folder with only Markdown is a valid addon.
- Addons are **discovered, not registered**: at startup the server and the CLI
  scan the addon folders and load every folder that holds an `addon.ts`, or
  only written knowledge. Nothing is listed in `ops.config.json`. A folder
  whose name starts with `_` is skipped, to turn an addon off without deleting
  it.
- Addon folders are a **list of paths**, loaded in this order, the later
  winning on a name clash with a warning: the built-ins in this repository's
  `addons/`, the folders of `--addons` and `OPS_ADDONS` (`:`-separated), then
  `<workspace>/addons/`. Real addons live in the team's own repository, next to
  the code they describe; a company can share a folder across apps as its own
  repository, cloned and reviewed by the team.
- Tools of an addon are namespaced by the addon (`order.get_order`,
  `aaa.search_code`), declare their four MCP hints and return `Evidence`.
- An addon reads its settings from environment variables first; the
  workspace configuration may override them per app and environment. The
  settings are a zod schema in the addon, validated at startup.
- An addon declares the `apiVersion` of the addon API it was written for. Core
  keeps a version stable and breaks it only in a major release with a
  migration note. The built-in connectors ship as addons using the same API.
- A failing addon (bad manifest, wrong `apiVersion`, invalid settings, an
  error at load) is **skipped with one line saying why**; the rest keeps
  working. `ops doctor` lists loaded and skipped addons.
- `ops addon check <dir>` verifies the manifest, the settings schema, the
  hints and a sample call against fixtures. Core CI runs the shipped addons
  through it.
- **Addons are never fetched at runtime.** No download from a URL or a registry:
  a team clones and reviews what it runs.

## Consequences

A team adds a domain by copying a folder, keeps it in its own repository and
reviews it like its code; updating this repository never touches it. The cost is
trust: an addon is code run with the user's credentials, and Node offers no
sandbox. ADR 0002 stays the rule for addon authors, checked for hints and
return shapes by `ops addon check`, but it cannot be proved; the real
protection is a read-only account per source, and the guide says so.

## Alternatives considered

A registry of installable packages: heavier, and a supply-chain risk for code
that runs with production credentials. Addons listed in the configuration:
one more step between "drop in" and "works". Addons inside `src/`: the update
of this repository would overwrite or conflict with them. Sandboxing addons
in a worker or a container: a larger project; deferred until someone needs to
run addons they do not trust.

This extends ADR 0003 (connectors are now one thing an addon brings).
