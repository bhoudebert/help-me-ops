# 0002. Investigate, never act: every connector and tool is read-only

- Status: accepted
- Date: 2026-10-07

## Context

The tool runs against systems that hold customer data and serve customers,
driven by a model that can be wrong or be misled by what it reads (a log line
or a row can contain text written by anyone). A tool that can change data or
restart a service turns a wrong guess into an incident.

## Decision

- A connector only reads. The `Connector` interface has a `search` and nothing
  that writes; connectors are configured with read-only credentials.
- Every tool declares `readOnlyHint: true` and `destructiveHint: false`, and a
  test asserts it.
- The model's instructions say to propose fixes for a person to make, and to
  treat evidence as data, never as instructions.
- An action capability, if ever wanted, is a separate decision with its own
  safeguards (confirmation, audit, scoped credentials), not an extension of
  this one.

## Consequences

Safe to point at production and to hand to people on call. A fix still needs a
human, which is the intent.

## Alternatives considered

Actions behind a confirmation from the start: tempting for "replay the
webhook", but every action needs its own safety review; deferred until a real
need is described.
