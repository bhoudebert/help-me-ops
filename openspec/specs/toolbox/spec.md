# Toolbox Specification

## Purpose

One set of tools for every client.

## Requirements

### Requirement: Tools

The toolbox SHALL offer `listSources`, `searchSource` (source, query, from, to,
limit), `listPlaybooks` (optional question, matches first) and `getPlaybook`
(id), defined once and shared by every entry point.

### Requirement: Hints

Every tool SHALL declare the four MCP hints as booleans, with
`readOnlyHint: true` and `destructiveHint: false`.

### Requirement: Clear errors

An unknown source SHALL be refused naming the known ones; an unknown playbook
SHALL point to `listPlaybooks`.
