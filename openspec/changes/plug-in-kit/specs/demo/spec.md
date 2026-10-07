# Demo: delta

## ADDED Requirements

### Requirement: A world to investigate

The repository SHALL ship a demo workspace with one app and two environments,
fake services as fixtures, and a scenario (question, expected cause, key
evidence) in which the fault exists only in one environment.

### Requirement: A scripted investigation without a model

`ops demo` SHALL replay the scenario's investigation through the real tools,
printing each step and ending with a conclusion checked by `check_conclusion`,
with no network access and no API key.

#### Scenario: The scenario is a test

- **WHEN** the test suite runs the scripted investigation
- **THEN** it reaches the scenario's expected cause with only evidence from the fixtures
