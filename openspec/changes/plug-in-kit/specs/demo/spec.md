# Demo: delta

The demo world and the scenario as a test are folded into
`openspec/specs/demo`. What remains:

## ADDED Requirements

### Requirement: A scripted investigation without a model

`ops demo` SHALL replay the scenario's investigation through the real tools,
printing each step and ending with its conclusion checked by `check_conclusion`,
with no network access and no API key.

#### Scenario: The scenario is a test

- **WHEN** the test suite runs the scripted investigation
- **THEN** it reaches the scenario's expected cause with only evidence from the fixtures
