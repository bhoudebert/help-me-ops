# Addons: delta

The loader, discovery, settings, connector types and isolation are folded into
`openspec/specs/addons`. What remains:

## ADDED Requirements

### Requirement: Check an addon

`ops addon check <dir>` SHALL verify the manifest, the settings schema, the
tool hints and a sample call against fixtures, and exit non-zero on a failure.

### Requirement: Credentials of every source

A source's options SHALL be able to name an environment variable for a
credential (`${NAME}`) as an addon's settings do, so a configuration holds no
secret.
