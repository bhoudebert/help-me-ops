# API mode: delta

The other requirements are folded into `openspec/specs/api-mode`. What remains:

## ADDED Requirements

### Requirement: Measuring a model

`ops eval` SHALL run the scenarios of the workspace against the configured model a
given number of times and report, per scenario, how many runs reached a conclusion,
how many the check accepted, how many matched the expected cause, and the median
steps, tokens and time. It SHALL make no claim beyond what it ran.
