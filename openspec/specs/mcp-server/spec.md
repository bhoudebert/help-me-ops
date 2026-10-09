# MCP Server Specification

## Purpose

Serve the toolbox to Claude Code, Codex and GitHub Copilot.

## Requirements

### Requirement: Transport and clients

The server SHALL run on stdio (`npm run mcp`), write only protocol to stdout,
and ship client configuration, pointed at the demo workspace: `.mcp.json` (Claude
Code), `.vscode/mcp.json` (Copilot), and a documented `config.toml` entry
(Codex). The workspace SHALL be taken from `--workspace` or `OPS_WORKSPACE`.

### Requirement: The method in the instructions

The server instructions SHALL give the method: the scope (app and environment)
first, asking the person when it is unclear, then the playbook, the
identifiers of the report searched in the sources, a timeline of quoted
evidence with source and time, and a conclusion checked with `checkConclusion`
(the likely cause, the certainty, the evidence as quotes of tool results, the
unknowns and the next step for a person), answered with the report it returns;
never a claim without evidence; never a change to the system.

### Requirement: Prompt

An `investigate` prompt SHALL carry the method and the reported problem.

#### Scenario: Order stuck in Claude Code

- **WHEN** the user runs `/mcp__help-me-ops__investigate order 4512 stuck`
- **THEN** the model receives the method and the problem, and the tools to follow it

### Requirement: The same server over HTTP, for a team

A second entry point SHALL serve the same tools, instructions and prompt over
Streamable HTTP (`npm run mcp:http`), built by the same factory as the stdio
server. Each MCP session SHALL have its own tools and so its own ledger for the
checked conclusion. The server SHALL answer only requests with a valid bearer
token (401 otherwise), SHALL bind a session to the token that opened it, and SHALL
refuse to start without tokens (except `--no-auth` on a loopback address) and
refuse to listen beyond loopback without a public host name. It SHALL refuse a
request whose Host is not an allowed one or that has an Origin, cap a request body
at 1 MB and the sessions at 100, and log one JSON line per session event and per
tool call with the identity, never the input or the evidence.

#### Scenario: Two people, one server

- **WHEN** alice and bob each open a session and alice reads a log line
- **THEN** a conclusion quoting that line is accepted in alice's session and refused in bob's

#### Scenario: No token

- **WHEN** a request reaches `/mcp` without a valid `Authorization: Bearer` header
- **THEN** the server answers 401 and runs nothing
