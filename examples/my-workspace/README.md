# The demo workspace

A workspace is the folder that describes the system to investigate. This one is
the demo: an online shop (`shop`) in `prod` and `staging`, with a stuck order to
find. Copy it to start your own; [what is in each folder](https://bhoudebert.github.io/help-me-ops/guide/workspace).

```
ops.config.json   apps, environments, sources, and the settings of each addon
addons/           order, metrics, health (read recorded files); _shopdb (a real database, off)
playbooks/        how the shop's team investigates a stuck order
logs/, data/      the demo's fake backend: sample logs and recorded data
scenarios/        the test script of the demo (the assistant never reads it)
docker/           optional: a real PostgreSQL for the _shopdb addon
package.json      optional: the driver (pg) that _shopdb needs
```

All commands below run **from the help-me-ops clone** (the folder holding its
`package.json`), not from here.

## 1. The demo with files: nothing to set up

Open the clone in Claude Code (`claude`), Copilot or Codex: the shipped client
files already point at this folder. Ask:

> Client u-881 paid but cannot find order 4512. What happened?

Or from the terminal, to see what the assistant sees:

```bash
npm run ops -- --workspace examples/my-workspace doctor
```

## 2. The same shop on a real database (optional, needs Docker)

The logs cannot say whether a customer **paid**; the database can. Turn on the
`_shopdb` addon and the assistant finds that three customers paid 165.20 EUR and
have no order.

**a. Start PostgreSQL** (databases `shop_prod` and `shop_staging`, and a user
`readonly` that can only `SELECT`):

```bash
docker compose -f examples/my-workspace/docker/compose.yml up -d
```

**b. Install the driver in this workspace** (an addon finds its packages from its
own folder upward, so not in the clone):

```bash
(cd examples/my-workspace && npm install)
```

**c. Put the connection URLs in `.env`**, in the clone (create it with
`cp .env.example .env` if you have none; it is git-ignored). The two lines are
already in `.env.example`, commented; this adds them:

```bash
grep '^# SHOPDB' .env.example | sed 's/^# //' >> .env
```

You get these two lines in `.env`:

```
SHOPDB_PROD_URL=postgres://readonly:readonly@127.0.0.1:5433/shop_prod
SHOPDB_STAGING_URL=postgres://readonly:readonly@127.0.0.1:5433/shop_staging
```

A URL reads `postgres://USER:PASSWORD@HOST:PORT/DATABASE`: here the `readonly`
user (password `readonly`), the Docker container published on `127.0.0.1` port
`5433`, and one database per environment. `ops.config.json` already refers to
them as `"url": "${SHOPDB_PROD_URL}"` and `"${SHOPDB_STAGING_URL}"`, so nothing
else to edit. Credentials stay in the environment, never in a config file.

**d. Turn the addon on**: a folder starting with `_` is off, so rename it.

```bash
mv examples/my-workspace/addons/_shopdb examples/my-workspace/addons/shopdb
```

**e. Check it, then restart your client** (the server reads `.env` at start):

```bash
npm run ops -- --workspace examples/my-workspace doctor
```

```
  shopdb           loaded    (workspace) …/examples/my-workspace/addons/shopdb
```

Ask the same question again. The assistant now also calls `shopdb.paymentsFor`
and `shopdb.paidButUnconfirmed`.

### If `doctor` does not say `loaded`

| `doctor` says                                      | Fix                                                    |
| -------------------------------------------------- | ------------------------------------------------------ |
| no `shopdb` line                                   | the folder is still `_shopdb`: do step d               |
| `skipped … Cannot find package 'pg'`               | step b, in `examples/my-workspace`                     |
| `unavailable in shop/prod: … url`                  | the URL variable is missing in `.env` (step c)         |
| `environment variable SHOPDB_PROD_URL is not set`  | same; check you ran from the clone, where `.env` lives |
| a connection error when the assistant calls a tool | the container is not up: `docker compose … ps`, step a |

### Try to break it

The assistant's user cannot write, even if asked:

```bash
docker compose -f examples/my-workspace/docker/compose.yml exec db \
  psql -U readonly shop_prod -c "UPDATE orders SET status = 'confirmed' WHERE id = '4512'"
# ERROR:  permission denied for table orders
```

### Turn it off and clean up

```bash
docker compose -f examples/my-workspace/docker/compose.yml down -v
mv examples/my-workspace/addons/shopdb examples/my-workspace/addons/_shopdb
```

## 3. The shop's REST API, live (optional, needs Docker)

A small backend serves this workspace's recorded data over HTTP, and the `rest`
addon reads it: the same shop, from a running server.

```bash
docker compose -f examples/my-workspace/docker/compose.yml up -d backend
cat >> .env <<'EOF'
SHOP_API_PROD_URL=http://127.0.0.1:8088
SHOP_API_STAGING_URL=http://127.0.0.1:8089
SHOP_API_TOKEN=demo-token
EOF
npm run ops -- --workspace examples/my-workspace doctor     # rest: loaded
```

`ops.config.json` already holds the `rest` settings (`baseUrl`, `allow`, `token`
as `${VARIABLES}`), so there is nothing to edit; until the variables are set,
`doctor` shows `rest idle … waiting for SHOP_API_PROD_URL`. Ask: "which orders in
prod are awaiting payment, read from the shop's API?" Details and what to try:
[ready-made addons](https://bhoudebert.github.io/help-me-ops/guide/shipped-addons).

## 4. Make it yours

Copy this folder into your own repository, rename the app and environments in
`ops.config.json`, and replace what the addons read with your read-only systems.
`npm run ops -- init addon <name> --template file|api|sql` starts an addon for
you. Delete `data/`, `logs/`, `scenarios/` and `docker/` when you no longer need
them. The full guide: <https://bhoudebert.github.io/help-me-ops/guide/getting-started>.
