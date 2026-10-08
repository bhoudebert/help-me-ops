# PostgreSQL: a database, SELECT only

Read a database to answer what no log says (did the customer pay? what state is
the order in?). PostgreSQL is not a switch-on addon like the others: it is a
**template** you start from, and a full demo.

**Status:** template + demo (run for real against PostgreSQL 17) · **Read-only:** yes, twice ([why](#safety))

## What you need

| You need                              | Why                                     | How to get it                                                                                                                  |
| ------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| The **`pg` driver** in your workspace | the addon imports it                    | `cd <your workspace> && npm install pg` (not in the help-me-ops clone: an addon looks for packages from its own folder upward) |
| A **read-only database user**         | the database itself must refuse a write | `CREATE ROLE readonly LOGIN PASSWORD '...'; GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly;`                          |
| The **connection URL** of that user   | the one setting                         | `postgres://readonly:password@host:5432/database`                                                                              |
| Network access to the database        | the connection goes there               | from the machine running help-me-ops                                                                                           |

## Set it up

**1. Scaffold the addon** into your workspace:

```bash
npm run ops -- --workspace my-workspace init addon orders-db --template sql
cd my-workspace && npm install pg
```

**2. Edit the two files** it wrote in `my-workspace/addons/orders-db/`: follow the `TODO` comments (your table, your columns, what each tool is called).

**3. Put the URL in `.env`** (in the help-me-ops clone) and refer to it from the environment:

```bash
PROD_DATABASE_URL=postgres://readonly:...@db.internal:5432/shop
```

```json
"prod": { "sources": [], "addons": { "orders-db": { "url": "${PROD_DATABASE_URL}" } } }
```

**4. Check and restart.** `npm run ops -- doctor` must say `orders-db ... loaded`. Without the driver it says `skipped ... Cannot find package 'pg'`.

The generated `tools.ts` is plain functions: one parameterised `SELECT` per tool, returning rows the core turns into evidence. [How an addon is written](/addons).

## What it can do

Whatever you write: one tool per question you want answered, each a `SELECT`. The demo's `shopdb` has two:

| Tool                        | What it does                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `shopdb.paymentsFor`        | the payments and webhook events of an order: did the provider take the money, did the shop handle the confirmation |
| `shopdb.paidButUnconfirmed` | orders paid but still `awaiting_payment`, with the money involved                                                  |

## Safety

Two walls, not one:

- the **database user** can only `SELECT`: the database refuses a write, whatever the code does;
- every query runs inside `BEGIN READ ONLY`, with the question as a parameter (`$1`), never glued into the SQL.

Your part: create the read-only user, and write only parameterised `SELECT`s.

## Try it without an account

The demo workspace has a real PostgreSQL in Docker with a `readonly` user and the shop's data: [same investigation, with a real database](/database). It finds that three customers paid 165.20 EUR and have no order, and shows an `UPDATE` refused.

## If it does not work

| `doctor` or an error says                | It means                                           | Do                                 |
| ---------------------------------------- | -------------------------------------------------- | ---------------------------------- |
| `skipped ... Cannot find package 'pg'`   | the driver is not in the workspace                 | `cd <workspace> && npm install pg` |
| `idle ... waiting for PROD_DATABASE_URL` | the URL variable is not set                        | put it in `.env`, restart          |
| a connection error when a tool is called | the database is not reachable, or the URL is wrong | check host, port, user, password   |
| `permission denied for table ...`        | the read-only user cannot read that table          | `GRANT SELECT` on it               |

## Limits

One driver per addon: for MySQL or another database, scaffold the same way and use its driver. A tool returns at most 100 rows.
