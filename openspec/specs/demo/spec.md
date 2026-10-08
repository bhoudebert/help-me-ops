# Demo Specification

## Purpose

A world to investigate that works from a fresh clone, so the kit can be tried,
shown and tested without a real system.

## Requirements

### Requirement: A world to investigate

The repository SHALL ship a demo workspace, `examples/my-workspace`, with one app
(`shop`) in two environments (`prod`, `staging`), fake services as fixtures
read by addons (`logs`, `order`, `metrics`, `health`), a playbook, and a
scenario in which the fault exists only in `prod`.

#### Scenario: Same release, one environment broken

- **WHEN** the worker's memory and queue are queried in `prod` and in `staging`
- **THEN** `prod` shows memory reaching the limit and a queue past the webhook's refusal threshold, and `staging` shows neither

### Requirement: The scenario is a test

A scenario file (`examples/my-workspace/scenarios/`) SHALL hold the question, the
scope and playbook it should lead to, the tool calls of the investigation, and
the conclusion (cause, certainty, evidence as source, time and quote, unknowns,
next step). The test suite SHALL replay the calls through the real tools and
SHALL fail when a quote of the conclusion is not in a result, or has another
time.

#### Scenario: Paid but no order

- **WHEN** the investigation of "client u-881 paid but cannot find order 4512" is replayed
- **THEN** the order is `awaiting_payment`, the webhook was refused with a 503 by the shop while the provider answered 200, the queue passed 1000 and the worker was OOMKilled after release 2.14.0, and orders 4513 and 4514 are in the same state
