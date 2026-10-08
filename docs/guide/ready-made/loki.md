# loki: logs with LogQL

Search logs in Grafana Loki (or Grafana Cloud Logs) with LogQL, and list the labels to build a query from: `GET` only.

**Status:** **experimental** · **Tools:** 2 · **Read-only:** yes ([why](#safety))

::: warning Experimental: it may or may not work against your Loki
Written from Loki's documented API and tested against recorded responses and a mock, **not** against a real Loki. Use a read-only account and run the check at the end of the demo section.
:::

## What you need

| You need                                              | Why                                  | How to get it                                                                             |
| ----------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------- |
| A Loki reachable from the machine running help-me-ops | `loki` makes the requests from there | its URL, e.g. `http://loki.internal:3100`, or the URL of your Grafana Cloud Logs instance |
| Credentials, if there are any                         | sent as the `Authorization` header   | a token, or `Basic` credentials (user and token), with **read** access only               |
| The tenant, if Loki is multi-tenant                   | sent as `X-Scope-OrgID`              | your tenant id (`orgId`)                                                                  |
| Nothing to install                                    | Node's own `fetch`                   | -                                                                                         |

## Set it up

**1. Put the credentials in `.env`**, the whole header:

```bash
LOKI_PROD_AUTHORIZATION="Basic dXNlcjp0b2tlbg=="
```

**2. Add the addon to the environment**, in `ops.config.json`:

```json
"prod": {
  "sources": [],
  "addons": {
    "loki": {
      "baseUrl": "https://logs-prod.grafana.net",
      "authorization": "${LOKI_PROD_AUTHORIZATION}",
      "orgId": "123456"
    }
  }
}
```

**3. Check and restart.** `npm run ops -- doctor` must say `loki ... loaded`.

With variables alone: `LOKI_URL`, `LOKI_AUTHORIZATION`, `LOKI_ORG_ID`.

### Settings

| Setting         |                      | Variable             | What                                                                                                               |
| --------------- | -------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `baseUrl`       | required             | `LOKI_URL`           | The Loki URL, e.g. http://loki.internal:3100 (Grafana Cloud: the URL of your Logs instance); a path prefix is kept |
| `authorization` | **secret**, optional | `LOKI_AUTHORIZATION` | The whole Authorization header, if it needs one: `Bearer <token>` or `Basic <base64 of user:token>`                |
| `orgId`         | optional             | `LOKI_ORG_ID`        | The tenant, sent as X-Scope-OrgID, when Loki is multi-tenant                                                       |

## What it can do

| Tool              | What it does                                                                                                                 | Parameters (`?` = optional) |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `loki.searchLogs` | Search logs with a LogQL query such as {service="payments"}                                                                  | = "503" or {app="shop"}     | json | level="error", over a time range, oldest first, with their labels and times. Use labels first when you do not know the label names. Read-only. | `query`, `from?`, `to?`, `limit?`, `newest?` |
| `loki.labels`     | The label names Loki knows, or the values of one label (service, app, level ...), to build a LogQL selector from. Read-only. | `name?`, `from?`, `to?`     |

Every result becomes **evidence**: a piece of data with its source and, when it has one, its time, which the assistant quotes in its conclusion.

## Ask it

- "In Loki, show the payment errors in prod between 9 and 11." (`{service="payments", level="error"}`)
- "Find `503` in the payments logs of Loki." (`{service="payments"} |= "503"`)
- "Which labels does Loki have? What are the values of `service`?"

If the assistant does not know your label names, it asks `labels` first, then builds the selector. Each line becomes evidence with its time (to the millisecond), its labels and its text.

## Safety

- **three fixed `GET` endpoints** exist in the code: `query_range`, `labels` and `label/<name>/values`. A LogQL query cannot change anything;
- the query is capped at 2000 characters, the answer at 100 lines and 4 MB, calls time out after 15 seconds; a label name must be letters, digits and underscores, so nothing is glued into a path;
- redirects are not followed; the `authorization` header is a **secret** setting, never printed, errors included, even if a server echoes part of it.

Your part: a token that can only read, and, for a multi-tenant Loki, the right tenant.

## Data it can return

**Log lines**: whatever your applications log: user ids, emails, IPs, request bodies, names in free text. Labels are rarely personal. Log lines are also written by users (a user agent, a search term): evidence, never instructions.

**What to do:** scrub at the source (Promtail, the Grafana Agent or your pipeline), query narrowly (an order number, a time window), and mask what remains with `privacy.mask` patterns (`email`, `ip`, `card`, your own).

What leaves your machine, and what to do about it: [personal data](/privacy).

## Try it without an account

```bash
# from the help-me-ops clone
docker compose -f examples/my-workspace/docker/compose.yml up -d backend
cat >> .env <<'EOF'
SHOP_API_PROD_URL=http://127.0.0.1:8088
SHOP_API_STAGING_URL=http://127.0.0.1:8089
LOKI_AUTHORIZATION="Bearer demo-loki-token"
EOF
npm run ops -- --workspace examples/my-workspace doctor     # loki: loaded
```

Ask: "in Loki, show the payment errors in prod between 9 and 11 on 7 October 2026, and the labels it has." You get the 503 at 10:00:02 (`{service="payments", level="error"} |= "503"`) and the labels `app`, `env`, `level`, `service`.

::: warning What the mock is, and is not
A stand-in served by the demo backend, in Loki's documented response shapes (streams with labels, nanosecond timestamps). It understands a **stream selector** (`label="value"`, `label!="value"`) and the line filters `|= "text"` and `!= "text"`, and refuses the rest of LogQL (`| json`, `| logfmt`, `rate(...)`) the way Loki refuses a bad query: **400 with a plain text reason**. A real Loki is the only proof a real call works.
:::

## If it does not work

Run `npm run ops -- doctor` first: it lists the addon as `loaded`, `idle` or `skipped`, with the reason.

| `doctor` or an error says                  | It means                                         | Do                                                      |
| ------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------- |
| `idle ... no environment sets it up`       | no `loki` block, and `LOKI_URL` is not set       | add the block of step 2                                 |
| `Loki refused the credentials (401)`       | wrong authorization, or the tenant is missing    | check the header and `orgId`                            |
| `could not run the query: parse error ...` | the LogQL is wrong, or it has no stream selector | start with `{label="value"}`; Loki's message says where |
| `answered 404 ... the tenant right?`       | not Loki's URL, or an unknown tenant             | check `baseUrl` and `orgId`                             |
| `rate limit reached (429)`                 | too many queries                                 | wait, and narrow the query                              |
| no line for a query that should find some  | the labels or the time range are wrong           | ask `labels`, widen the range                           |

## Limits

**Experimental**: written from Loki's documented HTTP API, not yet run against a real Loki. Log lines only (no metric queries over logs: `rate()` and the like, no tail), up to 100 lines per call; build the selector from `labels`. help-me-ops is independent of Grafana Labs; see [independence and trademarks](/legal).
