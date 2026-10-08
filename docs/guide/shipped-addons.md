# Ready-made addons

Some addons ship with help-me-ops, so you configure them instead of writing
them. They are always installed and **idle**: they serve no tool and print
nothing until an environment of your `ops.config.json` sets them up (or, when
the configuration refers to `${VARIABLES}`, until those are set).

```bash
npm run ops -- doctor
#   rest   idle   (built-in) … no environment sets it up: add "addons": { "rest": { … } }
```

To use one, add its settings to the environment that has it, as for any addon
([settings and credentials](/addons#settings-and-credentials)), restart, and
`doctor` shows it `loaded`.

## rest: your own REST API

Read-only GETs of a REST API of your own (an internal service, a status
endpoint, an admin API) when you do not want to write an addon. Tool:
`rest.get`, with a `path` and an optional `query`.

```json
"prod": {
  "sources": [],
  "addons": {
    "rest": {
      "baseUrl": "https://api.internal.example.com/v1",
      "allow": "/orders,/health",
      "token": "${PROD_API_TOKEN}"
    }
  }
}
```

| Setting       | What                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseUrl`     | The API's base URL. Also `REST_BASE_URL`.                                                                                                               |
| `allow`       | Comma-separated **path prefixes** the assistant may read: `/orders` allows `/orders` and `/orders/4512`, not `/ordersx` or `/admin`. Also `REST_ALLOW`. |
| `token`       | Optional, **secret**: kept out of every message. Also `REST_TOKEN`. Use a read-only token.                                                              |
| `tokenHeader` | `authorization` (default) sends `Bearer <token>`; any other name, e.g. `x-api-key`, sends the token as is.                                              |

Then ask: "what does `/orders/4512` say?" The assistant calls
`rest.get {path: "/orders/4512"}`; a JSON list becomes one piece of evidence per
item, an object becomes one, and a time field (`at`, `time`, `timestamp`,
`updated_at`, `created_at`, `date`) becomes the evidence's time.

### Try it live, with the demo backend

The demo workspace ships a small backend: the shop's own REST API, serving the
recorded data over HTTP (prod on port 8088, staging on 8089, behind a bearer
token), as a service of the Docker compose file. `ops.config.json` already sets
`rest` up for it with variables, so it stays idle until you set them.

```bash
# from the help-me-ops clone
docker compose -f examples/my-workspace/docker/compose.yml up -d backend
cat >> .env <<'EOF'
SHOP_API_PROD_URL=http://127.0.0.1:8088
SHOP_API_STAGING_URL=http://127.0.0.1:8089
SHOP_API_TOKEN=demo-token
EOF
npm run ops -- --workspace examples/my-workspace doctor     # rest: loaded
```

Restart your client and ask: "which orders in prod are awaiting payment, read
from the shop's API?" The assistant calls `rest.get` with `/orders` and
`status=awaiting_payment`, and gets 4512, 4513 and 4514, each with its time.
The same question for staging returns one order, so the environments stay
apart. Try `/admin` (refused: not under an allowed prefix), then
`curl -X POST localhost:8088/orders` (the backend itself answers 405). Clean up
with `docker compose -f examples/my-workspace/docker/compose.yml down -v`.

Variables not set? `doctor` shows `rest idle … waiting for SHOP_API_PROD_URL`:
a configured addon whose credentials are absent stays quiet and serves nothing.

### Why it is safe to point at a real API

The addon cannot be talked into anything else than reading what you allowed:

- the method is **GET**, nothing else exists in the code;
- the path must sit under an **allowed prefix**; `..` (also as `%2e%2e`), `//host`,
  `?`, `#` and `\` are refused, and the host never changes;
- **redirects are not followed**, since they could leave the allowed paths;
- the answer is capped at 1 MB and a request times out after 10 seconds;
- a failing call never prints the token.

Still give it a token that can only read: that is your part
([read-only](/addons#read-only-your-part)).

## datadog: logs, metrics and monitors (experimental)

::: warning Experimental: it may or may not work against your Datadog
This addon is written from Datadog's **documented** APIs and tested against
recorded responses in those shapes and a mock. It has **not** been run against a
real Datadog account, so details (a field, a scope, a limit, a region) can
differ and it may fail on yours. Its tools say so to the assistant too. Use a
read-only key, run the [checklist below](#check-it-on-your-own-datadog) before you
rely on it, and open an issue with what you see: that is how it becomes
verified.
:::

Datadog has a public HTTP API, and this addon reads three things from it,
nothing else. (help-me-ops is independent of Datadog, Inc., and is not
affiliated with or endorsed by it: [independence and trademarks](/legal).)

| Tool          | Datadog API                       | For                                                                      |
| ------------- | --------------------------------- | ------------------------------------------------------------------------ |
| `searchLogs`  | `POST /api/v2/logs/events/search` | logs by Datadog query (`service:payments status:error @order:4512`)      |
| `queryMetric` | `GET /api/v1/query`               | a metric over a time range (`avg:payment_confirm_queue_depth{env:prod}`) |
| `monitors`    | `GET /api/v1/monitor`             | what is alerting, by name or tag                                         |

Each result becomes evidence with its time: a log line with its status and
service, a point of a series, a monitor with its state. Times can be ISO 8601 or
relative (`now-15m`). The logs search is a POST because that is how Datadog takes
a search; it changes nothing, and it is the only request that is not a GET.

```json
"prod": {
  "sources": [],
  "addons": {
    "datadog": {
      "apiKey": "${DD_API_KEY}",
      "appKey": "${DD_APP_KEY}",
      "site": "datadoghq.eu"
    }
  }
}
```

| Setting   | What                                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`  | A Datadog API key, **secret**. Also `DD_API_KEY`.                                                                           |
| `appKey`  | An application key with read scopes (`logs_read_data`, `timeseries_query`, `monitors_read`), **secret**. Also `DD_APP_KEY`. |
| `site`    | Your Datadog site, default `datadoghq.com` (`datadoghq.eu`, `us3.datadoghq.com`, `us5.datadoghq.com` ...). Also `DD_SITE`.  |
| `baseUrl` | Optional. Replaces `https://api.<site>`: a proxy, or the demo's fake. Also `DD_BASE_URL`.                                   |

Credentials come from the environment (`${DD_API_KEY}`), and a `403` says what
to check: the keys, their scopes, and the site.

### Try it without an account: a mock of the Datadog API

The demo backend (the one of the REST demo) also mocks Datadog: the same three
APIs, in **Datadog's documented request and response shapes**, answering from
the demo's logs and metrics. The demo configuration already sets the addon up
for it, with variables:

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

Restart your client and ask: "in Datadog, show the payment errors in prod
between 9 and 11 on 7 October 2026, and which monitors are alerting." The
assistant calls `datadog.searchLogs` with `service:payments status:error`, then
`datadog.monitors`, and finds the 503 at 10:00:02 and the queue monitor in
`Alert`. Staging shows nothing alerting.

::: warning What the mock is, and is not
It is a stand-in so you can see the flow, run the tests and demo without an
account. It follows Datadog's documented shapes and authentication (the two
headers, `403` when they are wrong), but it understands only a subset of the
log query syntax (`service:`, `status:`, `host:`, `env:`, `@attribute:value`,
words, `-term`) and **says so** when asked for more (`OR`, parentheses). Its
clock stands at 10:30 on 7 October 2026; give absolute times to the demo data.
Only a real Datadog proves that a real call works, as below.
:::

### Check it on your own Datadog

The addon is tested against recorded responses in Datadog's shapes and against
the fake, **never against a real account**. Five minutes on yours settles it:

1. Create an API key and an application key with the read scopes above.
2. Put them in `.env` (`DD_API_KEY`, `DD_APP_KEY`, and `DD_SITE` if you are not on `datadoghq.com`), and add the `datadog` block to one environment of your `ops.config.json`.
3. `npm run ops -- doctor`: `datadog` must be `loaded`.
4. Ask for a log you know exists ("show the logs of service X in the last hour") and compare with the Datadog UI; ask for a metric you know; ask which monitors are alerting.
5. If something differs from the UI, open an issue with the request it made (a `403` names what to check), the query and what Datadog answered.

## Coming

A `git` addon (what changed in a repository on disk, through fixed read-only
commands) comes next, then `github` (pull requests and releases through its API,
with a read-only token and a list of repositories).
