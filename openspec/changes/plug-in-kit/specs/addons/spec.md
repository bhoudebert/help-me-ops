# Addons: delta

The loader, discovery, settings, connector types, isolation, the manifest
with plain functions and the scaffold are folded into `openspec/specs/addons`. What remains
(ADR 0009):

## ADDED Requirements

### Requirement: Shipped addons for common services

The repository SHALL ship `git` (the history, files and diffs of a repository
on disk, through fixed read-only commands) and `github` (pull requests,
releases and issues through its API, with a read-only token and a list of
repositories), each tested against fixtures. (`rest` and `datadog` are folded
into `openspec/specs/addons`.)

### Requirement: Check an addon

`ops addon check <dir>` SHALL verify the manifest, the settings, the tools, and
a sample call against fixtures, and exit non-zero on a failure.

### Requirement: Credentials of every source

A source's options SHALL be able to name an environment variable for a
credential (`${NAME}`) as an addon's settings do, so a configuration holds no
secret.
