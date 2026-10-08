# Write an addon

An **addon** teaches help-me-ops to read one more place: your orders database,
Datadog, GitHub, your own REST API. It is a folder with two small files, and you
need no knowledge of AI, MCP or this project's internals.

```
my-workspace/addons/order/
  addon.json    what it is: settings, and the tools with their parameters
  tools.ts      the code: one plain function per tool
```

Drop the folder in, restart, and the assistant can use `order.getOrder`. Delete
it and it is gone. Rename it `_order` to turn it off.

## Start from a template

You do not begin from a blank page. This writes a working addon into your
workspace, with `TODO` comments saying what to change:

```bash
npm run ops -- --workspace my-workspace init addon billing --template api
```

| Template | For                                              | You change                                  |
| -------- | ------------------------------------------------ | ------------------------------------------- |
| `file`   | a text file: logs, an export                     | the file path (a setting), the tool names   |
| `api`    | a REST API, with a token                         | the URL path and the fields you want quoted |
| `sql`    | a PostgreSQL database (`SELECT` only, read-only) | the table, the columns; `npm install pg`    |

It never overwrites: if the folder exists, nothing is written. Then give the
addon its settings under the environment that uses it in `ops.config.json`
(see [Settings and credentials](#settings-and-credentials)) and run `doctor`:
the addon must show as `loaded`, with a note if a setting is still missing.

## The idea in one example

`addon.json` says what the addon offers:

```json
{
  "apiVersion": 1,
  "description": "The shop's orders",
  "settings": {
    "dbUrl": { "type": "string", "env": "ORDER_DB_URL", "secret": true, "description": "Read-only Postgres URL" }
  },
  "tools": {
    "getOrder": {
      "description": "One order: its status and when it last changed",
      "params": { "id": { "type": "string", "description": "The order number, e.g. 4512" } }
    }
  }
}
```

`tools.ts` does it. One function per tool, named like the tool:

```ts
import pg from "pg"; // installed next to the addon: `npm install pg`

export async function getOrder({ id }: { id: string }, { settings }: { settings: { dbUrl: string } }) {
  const db = new pg.Client(settings.dbUrl);
  await db.connect();
  try {
    const { rows } = await db.query("SELECT id, user_id, status, updated_at FROM orders WHERE id = $1", [id]);
    return rows.map((row) => ({
      ...row,
      at: row.updated_at, // when it happened
      summary: `order ${row.id} of ${row.user_id}: ${row.status} since ${row.updated_at}`, // one readable line
    }));
  } finally {
    await db.end();
  }
}
```

That is the whole addon. Three working ones to copy from are in
`examples/my-workspace/addons/`: `order`, `metrics` and `health`.

## What you get without writing it

- The tool is served to Claude Code, Codex and Copilot as `order.getOrder`, with
  `app` and `env` added, so the same addon works in `prod` and in `staging`.
- Parameters are checked before your function runs.
- **The tool is always read-only.** You cannot declare it otherwise.
- What you return becomes evidence the assistant can quote.

## addon.json

| Field         | What it is                                                                |
| ------------- | ------------------------------------------------------------------------- |
| `apiVersion`  | `1`. The version of this format; a mismatch skips the addon, with a line. |
| `description` | What the addon is, for people.                                            |
| `settings`    | What it needs to run: a URL, a token, a file. See below.                  |
| `tools`       | Each tool: a `description` and its `params`.                              |

**The `description` of a tool matters most.** The assistant chooses tools from
it: say what the tool returns, in the words of your system.

**Parameters** are `"string"`, `"number"`, `"integer"`, `"boolean"`, or an object:

```json
{ "type": "string", "description": "Only orders changed since", "optional": true }
{ "type": "string", "enum": ["paid", "unpaid"], "default": "paid" }
```

Names are letters, digits and underscores.

## tools.ts

Each function takes `(params, context)`:

| `context.…`  | What it is                                               |
| ------------ | -------------------------------------------------------- |
| `settings`   | Your addon's settings for the app and environment asked. |
| `app`, `env` | Which app and environment this call is for.              |
| `workspace`  | The workspace folder, to resolve relative paths.         |
| `fetch`      | `fetch`, for calling an API.                             |

**What to return** (the assistant quotes it, so return what a person on call
would want to read):

| You return                | The assistant gets                   |
| ------------------------- | ------------------------------------ |
| a list of records         | one piece of evidence per record     |
| one record                | one piece of evidence                |
| a string                  | one piece of evidence with that text |
| nothing, or an empty list | "nothing found"                      |

For a record, `at` (or `time`, `timestamp`) is when it happened, as an ISO 8601
date, and `summary` is one readable line. Without them the addon still works: the
time is looked for in those fields and the summary is built from the record's
values. Long results are cut at 100 and the cut is said.

If something is wrong, `throw new Error("a message a person can act on")`.

## Settings and credentials

A setting is read from the environment variable named in `env`, and the
workspace configuration can override it per environment:

```json
"prod":    { "addons": { "order": { "dbUrl": "${ORDER_DB_URL}" } } },
"staging": { "addons": { "order": { "dbUrl": "${STAGING_ORDER_DB_URL}" } } }
```

`${NAME}` stands for the environment variable `NAME`, so **a credential never
sits in a file**. Put the variables in `.env` (git-ignored). A setting marked
`"secret": true` is kept out of every message, errors included. If a setting is
missing in one environment, that addon's tools refuse there with the reason, and
the other environments keep working.

## Dependencies: a database driver, an SDK

An addon owns its packages. Install them next to it, in the addon folder or in
the workspace (never in the help-me-ops clone: the addon looks for them from its
own folder upward). `my-workspace` below stands for **your workspace folder** (the
one holding `ops.config.json`), not for this repository:

```bash
cd my-workspace && npm install pg
```

If a package is missing, the addon is **skipped with the reason** (`doctor`
shows `Cannot find package 'pg'`) and everything else keeps working.

## Read-only: your part

The tool is declared read-only, but your function is your code, and the core
cannot check what it does. So:

- use a **read-only account**: a database user with `SELECT` only, a token with
  read scope;
- never run anything but reads; no `INSERT`, `UPDATE`, no `POST` that acts;
- for a database, take named, parameterised queries (`WHERE id = $1`), not SQL
  built from the question.

The assistant proposes fixes; a person applies them.

## When something is wrong

An addon that cannot load is **skipped with one line saying why**, and the rest
keeps working:

```bash
npm run ops -- --workspace my-workspace doctor
```

lists every addon as loaded, skipped or replaced, with the reason: a wrong
`apiVersion`, a tool in `addon.json` without its function (or the reverse), an
invalid parameter, a missing package.

## Where addons are read from

In this order, a later one replacing an earlier one of the same name (a warning
names both):

1. `addons/` of this repository: the built-ins.
2. The folders of `--addons a:b` and `OPS_ADDONS`: for addons a company shares.
3. `<workspace>/addons/`: yours, kept in your own repository next to the code
   they describe.

Updating this repository never touches your addons. An addon is never
downloaded: clone and review what you run.

## Advanced: one `addon.ts`

For full control (zod schemas, your own evidence, a new type of source for
`ops.config.json`), write `addon.ts` instead of the pair, exporting a function of
`{ z, defineTool }`. Use one form or the other in a folder, not both. See
`addons/logs/addon.ts`, the built-in `file-logs` source type.
