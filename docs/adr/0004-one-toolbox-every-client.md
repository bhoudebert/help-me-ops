# 0004. One toolbox, every client: CLI, and MCP for Claude Code, Codex and Copilot

- Status: accepted
- Date: 2026-10-07

## Context

People investigate from where they already work: a terminal, Claude Code,
Codex, or GitHub Copilot in VS Code. All three agents speak MCP.

## Decision

Tools are defined once (`src/tools/index.ts`) with their schema, description
and four MCP hints, and served by thin entry points: `src/mcp.ts` (stdio, for
every MCP client) and `src/cli.ts` (the terminal). Client configuration ships
with the repository: `.mcp.json` (Claude Code), `.vscode/mcp.json` (Copilot),
and a `config.toml` entry documented for Codex. The method (playbook first,
quote evidence, conclude with certainty and unknowns) lives in the server
instructions and an `investigate` prompt, so each client gets the same.

An API-mode investigator (the terminal running its own model) reuses the same
definitions when it comes.

## Consequences

A capability added once reaches every client. Client-specific features
(elicitation, resources) are added only where a client supports them, with a
fallback.

## Alternatives considered

One integration per client: three times the work, behaviour drifting apart.
