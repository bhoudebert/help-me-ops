# The first investigation loop

## Why

The skeleton gives a model the tools and the method over MCP, but the terminal
only shows the playbook. Teams without an MCP client, scripts and CI need the
investigation itself; and every client should end with the same kind of
answer: a timeline, a cause, its evidence, what is unknown.

## What changes

- **An investigator in the terminal** (`npm run ops -- investigate "…"` with an
  API key): a model loop over the same toolbox, following the matching
  playbook, bounded in steps and tokens, with a trace of each step.
- **A structured conclusion** for every client: cause, certainty, evidence
  (source, time, quote), unknowns, next step. Schema-validated in the terminal;
  the same layout asked for over MCP.
- **Evidence checked by code**: every quote in the conclusion must come from a
  search result of the session.

## Open questions (for the maintainer)

- Which model and provider in the terminal: Anthropic first, others later?
- Case files now or later: keep each investigation, or only print it?
- A first real connector beyond the log file: PostgreSQL, Loki, Prometheus?

## Impact

- Specs: new `investigation` capability (delta here); `cli` changes
  `investigate`.
- Code: `src/investigate.ts` (loop), `src/conclusion.ts` (schema, evidence
  check); the MCP instructions refer to the same layout.
- ADR: one for the API-mode investigator (model, limits, trace).
