# prometheus: metrics and alerts

Read metrics and the alerts that are firing from Prometheus (or Mimir, Thanos, VictoriaMetrics, which speak its API): PromQL queries, `GET` only.

**Status:** **experimental** · **Tools:** 3 · **Read-only:** yes ([why](#safety))

::: warning Experimental: it may or may not work against your Prometheus
Written from Prometheus' documented API and tested against recorded responses and a mock, **not** against a real Prometheus. Use a read-only account and run the check at the end of the demo section.
:::

## What you need

| You need                                                                    | Why                                        | How to get it                                                                          |
| --------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| A Prometheus (or compatible) reachable from the machine running help-me-ops | `prometheus` makes the requests from there | its URL, e.g. `http://prometheus.internal:9090`; a path prefix (`/prometheus`) is kept |
| Credentials, if it is behind a proxy or is Mimir or Grafana Cloud           | sent as the `Authorization` header         | a token or basic credentials with **read** access only                                 |
| The tenant, for Mimir or Cortex                                             | sent as `X-Scope-OrgID`                    | your tenant id                                                                         |
| Nothing to install                                                          | Node's own `fetch`                         | -                                                                                      |

## Set it up

**1. Put the credentials in `.env`** (in the help-me-ops clone, git-ignored), if there are any. The variable holds the **whole header**:

```bash
PROM_PROD_AUTHORIZATION="Bearer eyJ..."
```

**2. Add the addon to the environment that has this Prometheus**, in `ops.config.json`:

```json
"prod": {
  "sources": [],
  "addons": {
    "prometheus": {
      "baseUrl": "http://prometheus.internal:9090",
      "authorization": "${PROM_PROD_AUTHORIZATION}"
    }
  }
}
```

**3. Check and restart.** `npm run ops -- doctor` must say `prometheus ... loaded`; restart your AI client.

Each environment has its own block, so staging can point to another Prometheus. With variables alone (`PROMETHEUS_URL`, and `PROMETHEUS_AUTHORIZATION` if needed) the same Prometheus applies to every environment.

### Settings

| Setting         |                      | Variable                   | What                                                                                                                |
| --------------- | -------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `baseUrl`       | required             | `PROMETHEUS_URL`           | The Prometheus (or Mimir, Thanos, VictoriaMetrics) URL, e.g. http://prometheus.internal:9090; a path prefix is kept |
| `authorization` | **secret**, optional | `PROMETHEUS_AUTHORIZATION` | The whole Authorization header, if it needs one: `Bearer <token>` or `Basic <base64>`                               |
| `orgId`         | optional             | `PROMETHEUS_ORG_ID`        | The tenant, sent as X-Scope-OrgID, for Mimir or Cortex                                                              |

## What it can do

| Tool                    | What it does                                                                                                                                                                             | Parameters (`?` = optional)      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `prometheus.queryRange` | A PromQL query over a time range, as points with their times (thinned to about 50 per series), e.g. payment_confirm_queue_depth{env="prod"} or rate(http_requests_total[5m]). Read-only. | `query`, `from?`, `to?`, `step?` |
| `prometheus.query`      | A PromQL query at one instant: the current value of a metric, or of an expression like sum(rate(errors_total[5m])). Read-only.                                                           | `query`, `at?`                   |
| `prometheus.alerts`     | The alerts Prometheus is evaluating, with their state (firing or pending), labels and when they became active: what is alerting. Read-only.                                              | `state?`                         |

Every result becomes **evidence**: a piece of data with its source and, when it has one, its time, which the assistant quotes in its conclusion.

## Ask it

- "What was `payment_confirm_queue_depth` in Prometheus between 9:40 and 10:40?"
- "Which Prometheus alerts are firing?"
- "What is the worker's memory right now?" (`worker_memory_mb`)
- "Show the 5-minute error rate of the API over the last hour." (`rate(http_requests_total{status=~"5.."}[5m])`)

Each point becomes evidence with its time, its series (`metric{labels}`) and its value.

## Safety

- **three fixed `GET` endpoints** exist in the code: `query_range`, `query`, `alerts`. A PromQL query cannot change anything;
- the query is capped at 2000 characters; a range query that would return more than 11,000 points per series is refused **before any request**, and long series are thinned to about 50 points;
- redirects are not followed, the answer is capped at 4 MB, calls time out after 15 seconds;
- the `authorization` header is a **secret** setting: never printed, errors included (a server that echoes the token back is redacted too).

Your part: give it read access only, and remember that a heavy PromQL query costs your Prometheus: its own limits (`--query.max-samples`, timeouts) still apply.

## Data it can return

Metrics are rarely personal, but **labels can be**: a `user_id`, a `customer` or an email as a label value is returned with the series, and so are the annotations of an alert (which sometimes name the people to page).

**What to do:** keep personal values out of metric labels (Prometheus advises it anyway: high cardinality), and mask what remains with `privacy.mask` (fields `user`, `email`, patterns).

What leaves your machine, and what to do about it: [personal data](/privacy).

## Try it without an account

```bash
# from the help-me-ops clone
docker compose -f examples/my-workspace/docker/compose.yml up -d backend
cat >> .env <<'EOF'
SHOP_API_PROD_URL=http://127.0.0.1:8088
SHOP_API_STAGING_URL=http://127.0.0.1:8089
PROMETHEUS_AUTHORIZATION="Bearer demo-prom-token"
EOF
npm run ops -- --workspace examples/my-workspace doctor     # prometheus: loaded
```

Ask: "what was the payment queue depth in Prometheus between 9 and 11 on 7 October 2026, and which alerts are firing?" You get the climb to 1240 jobs at 10:01 and the two firing alerts of prod (`PaymentQueueBackingUp`, `WorkerMemoryNearLimit`); staging has none.

::: warning What the mock is, and is not
A stand-in served by the demo backend under `/prometheus`, in Prometheus' documented response shapes. It understands a **metric name with optional `env` and `job` labels** (a subset of PromQL) and refuses the rest in Prometheus' own error shape (`bad_data`), and answers the recorded points of the demo whatever the `step`. A real Prometheus is the only proof a real call works.
:::

## If it does not work

Run `npm run ops -- doctor` first: it lists the addon as `loaded`, `idle` or `skipped`, with the reason.

| `doctor` or an error says                            | It means                                                                 | Do                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------ |
| `idle ... no environment sets it up`                 | no environment has a `prometheus` block, and `PROMETHEUS_URL` is not set | add the block of step 2                                |
| `idle ... waiting for PROM_PROD_AUTHORIZATION`       | the block refers to `${...}` and it is not set                           | put it in `.env`, restart                              |
| `Prometheus refused the credentials (401)`           | wrong or missing authorization, or the tenant                            | check the header (`Bearer ...`), and `orgId` for Mimir |
| `could not run the query: bad_data: parse error ...` | the PromQL is wrong                                                      | fix the expression; Prometheus' message says where     |
| `that is more than 11000 points`                     | the range is long for the step                                           | use a bigger `step` or a shorter range                 |
| `not JSON: is the URL the one of Prometheus?`        | a login page or a proxy answered                                         | check `baseUrl` and its path prefix                    |
| `overloaded or the query timed out (503)`            | the query is too heavy                                                   | narrow the range, the labels or the expression         |

## Limits

**Experimental**: written from Prometheus' documented HTTP API, not yet run against a real Prometheus. It uses `GET` only (long queries that need `POST` are not supported), reads the instant and range queries and the alerts (not the targets, rules or metadata endpoints), and thins long series to about 50 points. Compatible stores (Mimir, Thanos, VictoriaMetrics) are expected to work and are not tested. help-me-ops is independent of the Prometheus project and the Cloud Native Computing Foundation; see [independence and trademarks](/legal).
