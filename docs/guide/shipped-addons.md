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

## Coming

`github` (code, issues, pull requests) and `datadog` (logs, metrics) follow the
same way: configure, restart, ask.
