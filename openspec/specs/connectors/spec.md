# Connectors Specification

## Purpose

Bring evidence from the systems being investigated, whatever they are, without
ever changing them.

## Requirements

### Requirement: One contract

A source SHALL be served by a connector with an id, a kind (logs, metrics,
database, http, custom), a description and a `search` taking a query, an
optional time window and a limit (default 50), returning evidence: source, time
(ISO 8601, or none), a one-line summary and the raw record.

### Requirement: Read-only

A connector SHALL NOT change the system it reads; it SHALL be configured with
read-only credentials.

### Requirement: Log files

The built-in `file-logs` connector SHALL return the lines containing the query
(case ignored), in file order, with the time read from an ISO 8601 timestamp at
the start of the line; within a time window, lines without a time SHALL be
left out.

#### Scenario: Order in the logs

- **WHEN** `app-logs` is searched for `order=4512` between 10:00 and 10:05
- **THEN** the two lines of that window mentioning it come back with their times

### Requirement: Team modules

A source of type `module` SHALL load a TypeScript file, relative to the workspace,
exporting `createConnector`; a module without it SHALL be refused naming the
file. Source ids SHALL be unique within an environment.

### Requirement: Configuration

The sources of each environment of each app SHALL be read from the
workspace's `ops.config.json` (see the workspace spec), validated; an invalid
file SHALL say what is wrong.
