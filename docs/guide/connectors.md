# Connect your sources

A **source** is where evidence lives: a log file or service, a metrics store,
a database, an HTTP endpoint. Each is served by a **connector**, listed under
its app and environment in the workspace's `ops.config.json`:

```json
{
  "apps": {
    "shop": {
      "description": "Online shop: orders, payments",
      "envs": {
        "prod": { "sources": [ … ] },
        "staging": { "sources": [ … ] }
      }
    }
  }
}
```

Each environment has its own sources, so a search in `prod` never reads
`staging`. The entries below go in a `sources` list.

## Log files: built in

```json
{
  "id": "app-logs",
  "type": "file-logs",
  "path": "/var/log/shop/app.log",
  "description": "Application logs of the API, payments and workers"
}
```

One event per line, starting with an ISO 8601 timestamp.

## Anything else: an addon, or a small module

A connector type can come from an [addon](/addons). For a single source of
your own, a module is the lightest way:

Write a TypeScript file exporting `createConnector`, and point to it:

```json
{
  "id": "orders-db",
  "type": "module",
  "module": "connectors/orders-db.ts",
  "description": "Orders table: status and last update of each order (read-only)"
}
```

`examples/workspace/connectors/orders-db.ts` is a template: replace its in-memory table
with your database client, connected with a **read-only user**, and keep the
same evidence shape:

```ts
{ source: "orders-db", at: "2026-10-07T09:58:13Z",
  summary: "order 4512 of u-881: awaiting_payment since …", data: row }
```

## Good descriptions matter

The model chooses where to look from the `description`: say what the source
covers, in the words of your system.

## Rules

- Read-only credentials, always. Connectors only search.
- Credentials in `.env`, never in the workspace files.
- Mask personal data in the summary when your policy requires it.
