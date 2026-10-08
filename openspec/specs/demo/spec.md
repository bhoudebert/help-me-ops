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

### Requirement: A real database, optional

The demo workspace SHALL ship an optional PostgreSQL version of the same shop:
a `docker/compose.yml` and `init.sql` creating `shop_prod` (with the fault) and
`shop_staging`, seeded with orders, payments and webhook events, and a
`readonly` user granted `SELECT` only; a `package.json` declaring the driver; and
a database addon shipped turned off (`_shopdb`) whose tools read through that
user, in a read-only transaction, with parameterised `SELECT`s. The suite SHALL
test the addon against a fake driver, never a real database.

#### Scenario: Paid, and no order

- **WHEN** the addon is turned on and `shopdb.paidButUnconfirmed` is called in `prod`
- **THEN** orders 4512, 4513 and 4514 are returned as captured and still `awaiting_payment`, and the same call in `staging` returns nothing

#### Scenario: A write is refused

- **WHEN** the `readonly` user tries an `UPDATE`
- **THEN** the database answers `permission denied`

### Requirement: A live backend, optional

The demo workspace SHALL ship a small backend (`docker/backend/server.mjs`, Node
only, also a `backend` service of the compose file) serving the recorded data of
each environment as the shop's REST API over HTTP, one port per environment
(`/orders`, `/orders/<id>`, `/health`), behind a demo bearer token, answering
`405` to anything but GET. The configuration SHALL set up the `rest` addon for
it with `${VARIABLES}`, so it stays idle until they are set. The suite SHALL start
the backend on free ports and read it through the `rest` addon.

#### Scenario: The same order, live

- **WHEN** the backend is running and the variables are set, and `rest.get` reads `/orders` with `status=awaiting_payment` in `prod`
- **THEN** orders 4512, 4513 and 4514 come back with their times, and `staging` shows only its own order

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
