# Same investigation, with a real database

The [demo](/demo) reads recorded files. This page runs the **same shop on a real
PostgreSQL**, so you see what changes when an addon talks to a live database:
the assistant finds in one query what no log says. It takes five minutes and
needs Docker.

## What a database adds

In the logs, order 4512 waits for a webhook that never arrived. The logs cannot
say whether the customer **paid**. The database can:

- the `payments` table: the provider **captured** the money at 09:58:50;
- the `webhook_events` table: the shop **refused** the confirmation, twice, with
  a 503;
- the join of both: three customers (4512, 4513, 4514) **paid 165.20 EUR and have
  no order**.

That is the difference between "a webhook failed" and "three paying customers
are affected, here is who and how much". The assistant gets it from two tools
you did not write any MCP code for.

## Turn it on

You run everything from the help-me-ops clone, and the demo workspace is
`examples/my-workspace`.

**1. Start the database.** It creates two databases, `shop_prod` (with the
fault) and `shop_staging` (healthy), and a user `readonly` that can only
`SELECT`:

```bash
docker compose -f examples/my-workspace/docker/compose.yml up -d
```

**2. Install the driver in the workspace.** An addon owns its packages, and
finds them from its own folder upward, so `pg` goes in the workspace:

```bash
cd examples/my-workspace && npm install && cd ../..
```

**3. Give it the connection URLs.** Credentials live in the environment, never
in a file. Add to your `.env` in the clone:

```bash
SHOPDB_PROD_URL=postgres://readonly:readonly@127.0.0.1:5433/shop_prod
SHOPDB_STAGING_URL=postgres://readonly:readonly@127.0.0.1:5433/shop_staging
```

**4. Turn the addon on.** It is shipped off, as `_shopdb` (a leading `_` means
off). Rename it:

```bash
mv examples/my-workspace/addons/_shopdb examples/my-workspace/addons/shopdb
npm run ops -- --workspace examples/my-workspace doctor
```

`doctor` must list `shopdb` as `loaded`. If something is missing it says what:
no driver (`Cannot find package 'pg'`), an unset variable, a wrong URL.

Restart your client, and ask the same question as in the demo. The assistant now
has two more tools, `shopdb.paymentsFor` and `shopdb.paidButUnconfirmed`, and
the playbook tells it when to use them.

## What you should see

After the logs show the 503, the assistant checks whether the customer paid:

1. **`shopdb.paymentsFor`** with order 4512: `payment ps_7Hq2 … captured, 89.9 EUR`
   at 09:58:50, then `webhook payment.succeeded … refused_503` at 10:00:02 and
   10:02:02.
2. **`shopdb.paidButUnconfirmed`**: orders 4512, 4513 and 4514, **paid and still
   `awaiting_payment`**: 165.20 EUR in total.
3. In **staging**, the same call returns nothing: nobody is stuck there.

Its conclusion now says it did not guess: the money was taken, the shop refused
the confirmation, and three customers wait.

## Try to break it

help-me-ops only reads, and here is the proof, with the admin out of the way.
The assistant's user cannot write, even if someone asks it to:

```bash
docker compose -f examples/my-workspace/docker/compose.yml exec db \
  psql -U readonly shop_prod -c "UPDATE orders SET status = 'confirmed' WHERE id = '4512'"
# ERROR:  permission denied for table orders
```

Two walls, not one: the database user is `SELECT`-only, and the addon opens a
read-only transaction anyway. Your own addon should do the same, whatever the
database.

## Read the addon

It is two small files in `examples/my-workspace/addons/shopdb/`:

- `addon.json`: the setting (`url`, secret) and two tools with their parameters;
- `tools.ts`: two functions, each one `SELECT` with a `$1` parameter. It
  returns rows; the core turns them into evidence with a time and a line.

No MCP, no zod, no evidence format. Start your own from it with
`npm run ops -- init addon orders-db --template sql`.

## Clean up

```bash
docker compose -f examples/my-workspace/docker/compose.yml down -v
mv examples/my-workspace/addons/shopdb examples/my-workspace/addons/_shopdb
```

::: info Not part of the tests
The test suite never uses a real database: it runs the addon against a fake
driver and checks the queries are reads only. The five minutes above are the
real thing, by hand.
:::
