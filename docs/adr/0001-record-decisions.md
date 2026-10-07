# 0001. Record architectural decisions

- Status: accepted
- Date: 2026-10-07

## Context

People and coding agents change this code. A choice that is not written down
gets undone by the next contributor who does not know why it was made.

## Decision

Significant decisions are recorded here, one file per decision, from
`template.md`: the context, the decision, its consequences, and the
alternatives that lost. A record is never rewritten: a later decision
supersedes it and says so.

## Consequences

Reading `docs/adr/` explains why the system is shaped as it is. Small features
inside an existing shape need no record.

## Alternatives considered

Decisions in pull request descriptions only: lost among merged PRs, invisible
to agents working from the repository.
