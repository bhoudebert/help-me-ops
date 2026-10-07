# Investigation: delta

## ADDED Requirements

### Requirement: Follow the playbook

Given a reported problem, the investigator SHALL take the best-matching
playbook and follow its steps through the sources it names, searching the
identifiers of the report, and SHALL say when no playbook matches and what it
did instead.

### Requirement: A conclusion grounded in evidence

The investigation SHALL end with a conclusion: the likely cause, a certainty
(confirmed, likely, unknown), the evidence (source, time, quote), what is still
unknown, and the next step for a person. Every quote SHALL come from a search
result of the session; a conclusion quoting anything else SHALL be refused.

#### Scenario: Paid but no order

- **WHEN** the problem is "client u-881 paid but cannot find order 4512"
- **THEN** the conclusion says the order is awaiting payment because the payment webhook was refused (503) while the confirmation worker was down, quoting the log lines and the order row, with "replay the webhook once the worker is back" as the next step

### Requirement: Bounded

An investigation SHALL stop after a set number of steps and tokens, saying
what it had established so far.
