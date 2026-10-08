# Toolbox Specification

## Purpose

One set of tools for every client.

## Requirements

### Requirement: Tools

The toolbox SHALL offer `scope` (optional question), `listSources` (app, env),
`searchSource` (app, env, source, query, from, to, limit), `listPlaybooks`
(optional question, matches first), `searchKnowledge` (query, app, limit),
`getPlaybook` (id) and `checkConclusion` (the conclusion), defined once and
shared by every entry point.

### Requirement: Evidence is read in one environment

`listSources` and `searchSource` SHALL read the sources of one app and
environment, resolved as the workspace spec says, and their results SHALL name
the app and environment (and the source) they come from.

### Requirement: Hints

Every tool SHALL declare the four MCP hints as booleans, with
`readOnlyHint: true` and `destructiveHint: false`.

### Requirement: Clear errors

An unknown app, environment or source SHALL be refused naming the known ones; an unknown playbook
SHALL point to `listPlaybooks`.
