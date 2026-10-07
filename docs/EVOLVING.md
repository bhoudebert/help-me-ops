# How help-me-ops evolves

Every feature goes through the same path, whoever builds it, a person or a
coding agent. Each change is designed before it is coded, specified before it
is tested, and explained before it is released.

```
idea ─▶ decision ─▶ spec ─▶ code + tests ─▶ docs ─▶ showcase ─▶ PR ─▶ release
        (ADR)      (openspec)  (every client) (guide)   (site)    (review) (automatic)
```

## 1. Idea

Ideas live in `ROADMAP.md` or an issue. Before building, talk it through: which
problem is investigated, who investigates it, what evidence they need, what the
tool returns. A feature that cannot be described in those terms is not ready.

## 2. Decision: an ADR when the shape of the system changes

A new kind of connector, a new execution path (an API-mode investigator, a
case store), a new dependency or service, a rule that cuts across features:
write a record in `docs/adr/` from `template.md`, with the alternatives that
lost.

## 3. Spec: what the system shall do

Update or add `openspec/specs/<capability>/spec.md`: SHALL statements, each with
at least one scenario (WHEN / THEN). A larger change starts as a proposal in
`openspec/changes/<name>/` (proposal, tasks, spec deltas) and is folded into
the specs, then archived in `openspec/changes/archive/`, once built.

## 4. Code and tests, for every client

- **One toolbox, every client.** Logic lives in modules (`src/connectors/`,
  `src/tools/`, `src/*.ts`); the CLI and the MCP server are thin entry points.
  A capability reachable from one client is reachable from the others (Claude
  Code, Codex and Copilot share the MCP server) unless the spec says why not.
- **Read-only, enforced.** No tool or connector writes to the system it
  investigates; tests assert every tool's `readOnlyHint`.
- **Tests with the code**, against fixtures (`examples/`), never against a
  real system or a model API. `npm run quality` must pass.
- **Verify for real** where it matters (a real source, a real client) and say
  what was and was not verified.

## 5. Docs

The guide (`docs/guide/`): what the feature is for, how to use it from the
terminal and from each client, how to extend it. The README when the overview
changes. `docs/ENGINEERING.md` when the architecture or a connector changes.
`ROADMAP.md`: remove what is done, add what was learnt.

## 6. Showcase

A feature a user would notice earns its place on the site (`site/index.html`).
Real examples, no invented figures.

## 7. Pull request

Conventional Commits, one concern per commit, in the order of this path
(`docs(adr)`, `docs(spec)`, `feat`, `test`, `docs`). The PR title is a
Conventional Commit too. The template's checklist mirrors this document. The
maintainer reviews and merges.

## 8. Release

Nothing to do by hand: release-please turns `feat` and `fix` commits on `main`
into a release pull request with the version and the changelog.
