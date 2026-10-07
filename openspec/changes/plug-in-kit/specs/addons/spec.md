# Addons: delta

The loader, discovery, settings, connector types, isolation, and the manifest
with plain functions are folded into `openspec/specs/addons`. What remains
(ADR 0009):

## ADDED Requirements

### Requirement: Scaffold an addon

`ops init addon <name> --template file|api|sql` SHALL write a working addon
folder into `<workspace>/addons/` with comments saying what to change, and SHALL
refuse to overwrite an existing folder. The `sql` template SHALL read through a
read-only transaction with `SELECT` only; the `api` template SHALL only GET.

### Requirement: Shipped addons for common services

The repository SHALL ship `datadog` (logs, metrics), `github` (code, issues,
pull requests) and `rest` (read-only GETs of a team's own API, restricted to the
path prefixes its settings list), each using only Node's built-ins and `fetch`
and tested against recorded responses.

### Requirement: Check an addon

`ops addon check <dir>` SHALL verify the manifest, the settings, the tools, and
a sample call against fixtures, and exit non-zero on a failure.

### Requirement: Credentials of every source

A source's options SHALL be able to name an environment variable for a
credential (`${NAME}`) as an addon's settings do, so a configuration holds no
secret.
