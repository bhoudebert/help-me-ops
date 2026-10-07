# Conclusion: delta

## ADDED Requirements

### Requirement: Follow the playbook

Given a reported problem, the toolbox SHALL return the best-matching playbook
for the resolved app and environment, so the client's model can follow its
steps through the sources it names, and SHALL say when no playbook matches.

### Requirement: A conclusion grounded in evidence

An investigation SHALL end with a conclusion: the likely cause, a certainty
(confirmed, likely, unknown), the evidence (source, time, quote), what is still
unknown, and the next step for a person. Every quote SHALL come from a search
result of the session; the `check_conclusion` tool SHALL refuse a conclusion quoting anything else,
naming the quotes it could not find.

#### Scenario: Paid but no order

- **WHEN** the problem is "client u-881 paid but cannot find order 4512"
- **THEN** the conclusion says the order is awaiting payment because the payment webhook was refused (503) while the confirmation worker was down, quoting the log lines and the order row, with "replay the webhook once the worker is back" as the next step
