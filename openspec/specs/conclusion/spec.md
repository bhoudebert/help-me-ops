# Conclusion Specification

## Purpose

End an investigation with a conclusion the evidence supports, the same way in
every client, and refuse one that quotes what no tool returned.

## Requirements

### Requirement: Follow the playbook

Given a reported problem, the toolbox SHALL return the best-matching playbook
(`listPlaybooks`, then `getPlaybook`), so the client's model can follow its steps
through the sources it names, and SHALL say when no playbook matches.

### Requirement: A conclusion has a fixed shape

A conclusion SHALL hold the likely cause, a certainty (`confirmed`, `likely` or
`unknown`), the evidence (each with its source, its time or null, and a quote),
what is still unknown, the next step for a person, and the app and environment it
is about. A `checkConclusion` tool SHALL take it, declared read-only, and the
server instructions SHALL tell the assistant to call it before answering and to
answer with the report it returns.

### Requirement: Every quote comes from a result of the session

The server SHALL keep, for each session, the evidence every tool returned, and
`checkConclusion` SHALL refuse a conclusion with a quote that is not in it,
naming each quote it could not find. A quote SHALL match whatever its case and
spacing, in the summary or the data of the evidence; SHALL be at least 8
characters; SHALL come from the source it names, at the time it names (equal as a
moment, `null` for evidence with no time), and, when the conclusion names an
environment, from that environment or from evidence tied to none. A conclusion
about prod SHALL not stand on staging evidence.

#### Scenario: An invented line

- **WHEN** a conclusion quotes "the database was down for ten minutes" and no tool returned it
- **THEN** it is refused, the problem names the quote, and no report is returned

#### Scenario: The wrong source, time or environment

- **WHEN** a quote exists in the logs but the conclusion attributes it to the metrics, or to another time, or to staging while it is about prod
- **THEN** it is refused, saying where the quote really comes from

### Requirement: Certainty is earned

`confirmed` SHALL need evidence from at least two different sources; `likely`
SHALL need at least one piece of evidence; `unknown` MAY have none. Unless
`confirmed`, a conclusion SHALL say what is still unknown. A cause SHALL be a
sentence, and the next step SHALL not be empty. When the session read more than
one environment, the conclusion SHALL say which one it is about.

### Requirement: One report for every client

An accepted conclusion SHALL come back with a report in a fixed layout: the
certainty and the scope, the cause, the evidence oldest first (evidence with no
time last), what is unknown, the next step for a person, and a line saying nothing
was changed. A refused conclusion SHALL come back with its problems and the status
of each quote, and no report.

#### Scenario: Paid but no order

- **WHEN** the problem is "client u-881 paid but cannot find order 4512" and the investigation of the demo is replayed
- **THEN** the conclusion of the scenario is accepted, each quote found, and its report lists the evidence from 09:50 to 10:01 and says what is unknown: a leak in 2.14.0 or a limit too low
