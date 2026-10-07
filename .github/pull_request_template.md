<!-- Title: Conventional Commits, e.g. "feat(connectors): read JSON log lines". The title becomes the commit on main. -->
<!-- The path every change follows: docs/EVOLVING.md -->

## Summary

<!-- What changes and why, in a few lines. -->

## Decision and spec

<!-- ADR added or "none needed" (docs/adr/). Spec requirement added or changed (openspec/specs/...), or "no behaviour change". -->

## Verified

<!-- What was run: npm run quality, a real investigation (which client, which sources). State what was NOT verified. -->

## Checklist (docs/EVOLVING.md)

- [ ] ADR when the shape of the system changes
- [ ] Spec updated first when behaviour changes
- [ ] Reachable from every client (CLI, MCP for Claude Code, Codex, Copilot) or the spec says why not
- [ ] Read-only: no tool or connector changes the system it investigates
- [ ] Tests with the code; `npm run quality` passes
- [ ] Guide updated (`docs/guide/`); README if the overview changed; roadmap updated
- [ ] Commits and PR title follow Conventional Commits
