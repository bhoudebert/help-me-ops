# Addons: delta

The loader, discovery, settings, connector types, isolation, the manifest
with plain functions, the scaffold and the check are folded into `openspec/specs/addons`. What remains
(ADR 0009):

## ADDED Requirements

### Requirement: Shipped addons for common services

The repository SHALL ship `github` (pull requests, releases and issues through
its API, with a read-only token and a list of repositories), tested against
fixtures and a local fake. (`rest`, `datadog` and `git` are folded into
`openspec/specs/addons`.)

### Requirement: Credentials of every source

A source's options SHALL be able to name an environment variable for a
credential (`${NAME}`) as an addon's settings do, so a configuration holds no
secret.
