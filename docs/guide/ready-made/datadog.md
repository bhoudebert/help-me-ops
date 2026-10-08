# datadog: logs, metrics and monitors

Read logs, metrics and monitors from Datadog through its HTTP API: three fixed read queries, nothing else.

**Status:** **experimental** · **Tools:** 3 · **Read-only:** yes ([why](#safety))

::: warning Experimental: it may or may not work against your Datadog
Written from Datadog's documented API and tested against recorded responses and a mock, **not** against a real account. Use a read-only application key and run the check at the end of this page.
:::

## What you need

| You need                                | Why                                                                         | How to get it                                                                                                |
| --------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| A Datadog account with Logs and metrics | the data being read                                                         | your organisation's Datadog                                                                                  |
| An **API key**                          | identifies your organisation                                                | _Organization Settings > API Keys_                                                                           |
| An **application key** with read scopes | authorises the reads: `logs_read_data`, `timeseries_query`, `monitors_read` | _Organization Settings > Application Keys_; give it only these scopes                                        |
| Your **Datadog site**                   | the API host is `api.<site>`                                                | `datadoghq.com` (default), `datadoghq.eu`, `us3.datadoghq.com`, `us5.datadoghq.com`, `ap1.datadoghq.com` ... |
| Network access to `api.<site>`          | the requests go there                                                       | from the machine running help-me-ops                                                                         |

## Set it up

**1. Create the two keys** as above, with read scopes only.

**2. Put them in `.env`** (in the help-me-ops clone, git-ignored):

```bash
DD_API_KEY=...
DD_APP_KEY=...
DD_SITE=datadoghq.eu        # only if you are not on datadoghq.com
```

**3. Add the addon to an environment** in `ops.config.json`:

```json
"prod": {
  "sources": [],
  "addons": {
    "datadog": { "apiKey": "${DD_API_KEY}", "appKey": "${DD_APP_KEY}", "site": "datadoghq.eu" }
  }
}
```

**4. Check and restart.** `npm run ops -- doctor` must say `datadog ... loaded`. If both keys are set as variables, the addon is also set up in every environment without a block; use a block per environment when prod and staging use different Datadog organisations or keys.

### Settings

| Setting   |                         | Variable      | What                                                                                                        |
| --------- | ----------------------- | ------------- | ----------------------------------------------------------------------------------------------------------- |
| `apiKey`  | **secret**, required    | `DD_API_KEY`  | A Datadog API key (Organization Settings > API Keys)                                                        |
| `appKey`  | **secret**, required    | `DD_APP_KEY`  | A Datadog application key with read scopes (logs_read_data, timeseries_query, monitors_read)                |
| `site`    | default `datadoghq.com` | `DD_SITE`     | Your Datadog site: datadoghq.com, datadoghq.eu, us3.datadoghq.com, us5.datadoghq.com, ap1.datadoghq.com ... |
| `baseUrl` | optional                | `DD_BASE_URL` | Replaces `https://api.<site>`: for a proxy, or the demo's fake Datadog                                      |

## What it can do

| Tool                  | What it does                                                                                                                             | Parameters (`?` = optional)                  |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `datadog.searchLogs`  | Search the logs of Datadog with its query syntax (service:payments status:error @order:4512), oldest first, with their times. Read-only. | `query`, `from?`, `to?`, `limit?`, `newest?` |
| `datadog.queryMetric` | Query a Datadog metric over a time range, as points with their times, e.g. avg:payment_confirm_queue_depth{env:prod}. Read-only.         | `query`, `from?`, `to?`                      |
| `datadog.monitors`    | The monitors of Datadog and their state (Alert, Warn, No Data, OK), optionally filtered by name or tag: what is alerting. Read-only.     | `name?`, `tag?`                              |

Every result becomes **evidence**: a piece of data with its source and, when it has one, its time, which the assistant quotes in its conclusion.

## Ask it

- "In Datadog, show the payment errors in prod between 9 and 11 yesterday." (`service:payments status:error`)
- "What was the queue depth in Datadog around 10:00?" (`avg:payment_confirm_queue_depth{env:prod}`)
- "Which Datadog monitors are alerting for the shop?"
- "Find the Datadog logs for order 4512." (`@order:4512`, an attribute of your logs)

Times can be ISO 8601 or relative (`now-15m`).

## Safety

- **three fixed endpoints** exist in the code: logs search, metrics query, list monitors. The logs search is a `POST` because that is how Datadog takes a search; it changes nothing, and it is the only request that is not a `GET`;
- the keys are **secret** settings, never printed, errors included;
- redirects are not followed, answers are capped (100 logs, about 50 points per series, 2 MB), calls time out;
- a time that is neither ISO 8601 nor relative, and a site that is not a hostname, are refused **before any request**.

Your part: use an application key with read scopes only, so Datadog itself refuses anything more.

## Try it without an account

The demo backend also mocks these three Datadog APIs, in Datadog's documented request and response shapes, answering from the demo's logs and metrics. It needs Docker.

```bash
# from the help-me-ops clone
docker compose -f examples/my-workspace/docker/compose.yml up -d backend
cat >> .env <<'EOF'
SHOP_API_PROD_URL=http://127.0.0.1:8088
SHOP_API_STAGING_URL=http://127.0.0.1:8089
DD_API_KEY=demo-api-key
DD_APP_KEY=demo-app-key
EOF
npm run ops -- --workspace examples/my-workspace doctor     # datadog: loaded
```

Ask: "in Datadog, show the payment errors in prod between 9 and 11 on 7 October 2026, and which monitors are alerting." You get the 503 at 10:00:02 and the queue monitor in `Alert`; staging shows nothing alerting.

::: warning What the mock is, and is not
It is a stand-in so you can see the flow, run the tests and demo without an account. It follows Datadog's documented shapes and authentication (the two headers, `403` when wrong) but understands only a subset of the log query syntax (`service:`, `status:`, `host:`, `env:`, `@attribute:value`, words, `-term`) and says so when asked for more (`OR`, parentheses). Give it absolute times: its clock stands at 10:30 on 7 October 2026.
:::

### Check it on your own Datadog

The addon is tested against recorded responses and the mock, **never against a real account**. Five minutes settle it: do steps 1 to 4, ask for a log you know exists and compare with the Datadog UI, ask for a metric you know, ask which monitors alert. If something differs, open an issue with the query and what Datadog answered (a `403` names what to check).

## If it does not work

Run `npm run ops -- doctor` first: it lists the addon as `loaded`, `idle` or `skipped`, with the reason.

| `doctor` or an error says               | It means                                        | Do                                                             |
| --------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| `idle ... waiting for DD_APP_KEY`       | only some of the variables are set              | set the missing one in `.env`                                  |
| `Datadog refused the keys (403)`        | a wrong key, a missing scope, or the wrong site | check both keys, the scopes, and `DD_SITE`                     |
| `Datadog rate limit reached (429)`      | too many requests                               | wait, and narrow the query                                     |
| `is not a Datadog site`                 | `site` is not a hostname such as `datadoghq.eu` | fix `site`                                                     |
| `time ... must be ISO 8601 or relative` | a time such as `yesterday`                      | use `2026-10-07T09:00:00Z` or `now-1h`                         |
| `could not run the query`               | Datadog rejected the metric query               | use `aggregation:metric{scope}`, e.g. `avg:system.cpu.user{*}` |

## Limits

**Experimental**: written from Datadog's documented APIs, not yet run against a real account, so it may not work as is on yours (a field, a scope, a limit, a region). Its tools say so to the assistant. The label comes off once someone has verified it on a real Datadog. Logs are limited to 100 per call and metric series to about 50 points, so narrow the time range. help-me-ops is independent of Datadog, Inc.; see [independence and trademarks](/legal).
