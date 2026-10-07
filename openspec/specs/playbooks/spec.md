# Playbooks Specification

## Purpose

Capture how a team investigates a kind of problem, so the model follows the
team's method instead of improvising.

## Requirements

### Requirement: Markdown files

A playbook SHALL be a Markdown file in the playbooks folder (README.md
excepted) with front matter `name` and `when` (the words people use to report
the problem) and steps in the body naming the sources to search.

### Requirement: Matching a report

Playbooks SHALL be matched to a reported problem by the words they share with
`name` and `when`, best first; a problem sharing none SHALL match none.

#### Scenario: A client cannot find an order

- **WHEN** the problem is "my client cannot find his order 4512"
- **THEN** "Order stuck or missing" is the first match
