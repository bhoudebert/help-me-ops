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

### Requirement: A fake Datadog, optional

The demo backend SHALL also answer, on the same ports, the documented shapes of
Datadog's Logs Search v2, metrics query v1 and list-monitors v1 APIs from the
recorded logs and metrics of each environment, authenticated by the
`DD-API-KEY` and `DD-APPLICATION-KEY` headers (`403` when wrong). It SHALL
understand a stated subset of the log query syntax (`service:`, `status:`,
`host:`, `env:`, `@attribute:value`, words, `-term`, `*`) and refuse the rest
saying so, rather than answer wrongly. It is a stand-in for trying the addon
without an account, not Datadog, and the documentation SHALL say that only a real
instance proves a real call.

#### Scenario: The incident through Datadog

- **WHEN** the `datadog` addon searches the prod logs for `service:payments status:error`, queries `avg:payment_confirm_queue_depth{*}` and lists the monitors
- **THEN** the 503 of 10:00:02, a queue depth of 1240 at 10:01 and the alerting monitors come back, and staging shows none of them

### Requirement: A source repository, optional

The demo workspace SHALL ship a script (`git-demo/build.mjs`) that builds, with
fixed authors and dates, a real git repository of the shop's code with the
changes before the incident: tags `v2.13.0`, `v2.13.2` and `v2.14.0` (09:30 on 7
October), a batching-and-cache change to the worker on 5 October and a lowering
of the worker's memory limit on 6 October. The configuration SHALL set the `git`
addon up for it with `${SHOP_REPO}`, so it stays idle until the variable is set.
The suite SHALL build the repository in a temporary folder and read it through
the addon.

#### Scenario: Two suspects

- **WHEN** the repository is read for what changed before 09:31 on 7 October
- **THEN** both the cache that is never emptied and the lowered memory limit appear, so the conclusion can name two candidates and keep what is unknown

### Requirement: A mock GitHub, optional

The demo backend SHALL also answer, on the same ports, the documented shapes of
six GitHub REST endpoints (pulls, a pull request and its files, releases,
commits, issues, workflow runs) for one repository, `shop-co/shop`, from
recorded data (`data/github/`) that tells the same story as the demo repository:
the batching and cache pull request, the memory limit pull request, the 2.14.0
release, its deployments and one failed build. It SHALL authenticate with a bearer
token (`401` otherwise), answer `404` for any other repository and `405` for
anything but GET. The documentation SHALL say it is a stand-in, not GitHub.

#### Scenario: What was merged

- **WHEN** the github addon lists the pull requests merged since 5 October
- **THEN** pull requests 421, 418 and 412 come back, newest first

### Requirement: The scenario is a test

A scenario file (`examples/my-workspace/scenarios/`) SHALL hold the question, the
scope and playbook it should lead to, the tool calls of the investigation, and
the conclusion (cause, certainty, evidence as source, time and quote, unknowns,
next step, with the app and environment). The test suite SHALL replay the calls
through the real tools and SHALL fail when `checkConclusion` does not accept the
conclusion, and SHALL show it refuses the same conclusion with a quote that was
not returned, from another source, at another time or for another environment.

#### Scenario: Paid but no order

- **WHEN** the investigation of "client u-881 paid but cannot find order 4512" is replayed
- **THEN** the order is `awaiting_payment`, the webhook was refused with a 503 by the shop while the provider answered 200, the queue passed 1000 and the worker was OOMKilled after release 2.14.0, and orders 4513 and 4514 are in the same state
