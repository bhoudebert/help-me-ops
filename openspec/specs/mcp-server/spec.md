# MCP Server Specification

## Purpose

Serve the toolbox to Claude Code, Codex and GitHub Copilot.

## Requirements

### Requirement: Transport and clients

The server SHALL run on stdio (`npm run mcp`), write only protocol to stdout,
and ship client configuration: `.mcp.json` (Claude Code), `.vscode/mcp.json`
(Copilot), and a documented `config.toml` entry (Codex).

### Requirement: The method in the instructions

The server instructions SHALL give the method: the playbook first, the
identifiers of the report searched in the sources, a timeline of quoted
evidence with source and time, and a conclusion with the likely cause, the
certainty, the unknowns and the next step for a person; never a claim without
evidence; never a change to the system.

### Requirement: Prompt

An `investigate` prompt SHALL carry the method and the reported problem.

#### Scenario: Order stuck in Claude Code

- **WHEN** the user runs `/mcp__help-me-ops__investigate order 4512 stuck`
- **THEN** the model receives the method and the problem, and the tools to follow it
