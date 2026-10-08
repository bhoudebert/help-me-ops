# rest: your own REST API

Read an HTTP API of your own (an internal service, a status endpoint, an admin API) without writing an addon: a read-only `GET` of the paths you allow, nothing else.

**Status:** ready · **Tools:** 1 · **Read-only:** yes ([why](#safety))

## What you need

| You need                                                 | Why                                  | How to get it                                                  |
| -------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------- |
| An HTTP(S) API the machine running help-me-ops can reach | `rest` makes the requests from there | its base URL, e.g. `https://api.internal.example.com/v1`       |
| The **path prefixes** the assistant may read             | nothing outside them is reachable    | you decide: `/orders,/health`                                  |
| A **read-only token**, if the API needs one              | it is sent on every request          | an API key or token limited to read scopes; never an admin one |
| Nothing to install                                       | it uses Node's own `fetch`           | -                                                              |

## Set it up

**1. Choose what to expose.** List the path prefixes: `/orders` allows `/orders` and `/orders/4512`, but not `/ordersx` or `/admin`.

**2. Put the secret in `.env`** (in the help-me-ops clone, git-ignored), never in a file you commit:

```bash
PROD_API_TOKEN=a-read-only-token
```

**3. Add it to the environment that has this API**, in `ops.config.json`:

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

**4. Check and restart.** `npm run ops -- doctor` must say `rest ... loaded`; restart your AI client so it lists `rest.get`.

Each environment has its own block, so staging can point to another URL. You can also set everything with variables alone (`REST_BASE_URL`, `REST_ALLOW`, `REST_TOKEN`), which applies the same API to every environment.

### Settings

| Setting       |                         | Variable            | What                                                                                                                     |
| ------------- | ----------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `baseUrl`     | required                | `REST_BASE_URL`     | Base URL of the API, e.g. https://api.internal.example.com/v1                                                            |
| `allow`       | required                | `REST_ALLOW`        | Comma-separated path prefixes the assistant may read, e.g. /orders,/health. Nothing else is reachable.                   |
| `token`       | **secret**, optional    | `REST_TOKEN`        | A read-only token, if the API needs one                                                                                  |
| `tokenHeader` | default `authorization` | `REST_TOKEN_HEADER` | Header carrying the token: 'authorization' sends `Bearer <token>`, any other name sends the token as is (e.g. x-api-key) |

## What it can do

| Tool       | What it does                                                                                                                                                     | Parameters (`?` = optional) |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `rest.get` | GET one path of the team's REST API and return what it answers (one record per item of a list). Read-only: only paths under the configured prefixes can be read. | `path`, `query?`            |

Every result becomes **evidence**: a piece of data with its source and, when it has one, its time, which the assistant quotes in its conclusion.

## Ask it

- "What does `/orders/4512` say on the internal API?"
- "List the orders awaiting payment from the shop's API, in prod."
- "Check `/health` of the API in staging."

The assistant calls `rest.get` with a `path` and, if needed, a `query` such as `status=awaiting_payment`. A JSON list becomes one piece of evidence per item, an object becomes one; a time field (`at`, `time`, `timestamp`, `updated_at`, `created_at`, `date`) becomes the evidence's time.

## Safety

The addon cannot be talked into anything but reading what you allowed:

- the method is **GET**; nothing else exists in the code;
- the path must sit under an **allowed prefix**; `..` (also encoded as `%2e%2e`), `//host`, `?`, `#` and `\` are refused, and the host never changes;
- **redirects are not followed**, since they could leave the allowed paths;
- the answer is capped at 1 MB and a call times out after 10 seconds;
- the token is a **secret** setting: it is never printed, errors included.

Your part: give it a token that can only read ([read-only](/addons#read-only-your-part)).

## Data it can return

Whatever the API answers on the paths you allow, including every field of a record (names, emails, addresses).

**What to do:** allow only the paths that return no personal data, or put a view in front of the API that leaves those fields out.

What leaves your machine, and what to do about it: [personal data](/privacy).

## Try it without an account

The demo workspace ships a small backend: the shop's own REST API serving the recorded data over HTTP (prod on port 8088, staging on 8089, behind a token), as a service of its Docker compose file. It needs Docker.

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

Restart your client and ask: "which orders in prod are awaiting payment, read from the shop's API?" You get orders 4512, 4513 and 4514 with their times; staging returns one order, so the environments stay apart. Ask for `/admin`: refused, and no request is made. Clean up with `docker compose -f examples/my-workspace/docker/compose.yml down -v`.

## If it does not work

Run `npm run ops -- doctor` first: it lists the addon as `loaded`, `idle` or `skipped`, with the reason.

| `doctor` or an error says                    | It means                                                                                   | Do                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------- |
| `idle ... no environment sets it up`         | no environment has a `rest` block, and not all of `REST_BASE_URL` and `REST_ALLOW` are set | add the block of step 3                       |
| `idle ... waiting for PROD_API_TOKEN`        | the block refers to `${PROD_API_TOKEN}` and it is not set                                  | put it in `.env`, restart                     |
| `path /admin is not under an allowed prefix` | the path is outside `allow`                                                                | extend `allow` if it is meant to be readable  |
| `GET /orders answered 401` or `403`          | the API refused the token                                                                  | check the token, its scope, and `tokenHeader` |
| `was redirected (301)`                       | the API moved; redirects are never followed                                                | use the final URL as `baseUrl`                |
| `the answer is larger than 1000000 bytes`    | the path returns too much                                                                  | use `query` to filter or page                 |

## Limits

A call returns at most 1 MB and 100 pieces of evidence; the demo backend and your API must be reachable from the machine running help-me-ops; the addon sends one header for the token.
