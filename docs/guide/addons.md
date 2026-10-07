# Write an addon

An **addon** is a folder you drop in: it brings tools, connector types,
playbooks. Nothing to register; restart and it is there. Delete the folder and
it is gone. Rename it `_order` to turn it off.

```
ops/
  ops.config.json
  addons/
    order/
      addon.ts
      playbooks/slow-checkout.md     optional, served with your playbooks
```

## Where addons are read from

In this order, a later one replacing an earlier one of the same name (a warning
names both):

1. `addons/` of this repository: the built-ins (`logs`, the `file-logs` type).
2. The folders of `--addons a:b` and `OPS_ADDONS`: for addons a company shares.
3. `<workspace>/addons/`: yours, kept in your own repository next to the code
   they describe.

Updating this repository never touches your addons. An addon is never
downloaded: clone and review what you run.

## A tool with its own settings

```ts
// ops/addons/order/addon.ts
export default ({ z }) => ({
  apiVersion: 1,
  settings: z.object({ dbUrl: z.string(), tenant: z.string().default("eu") }),
  env: { dbUrl: "ORDER_DB_URL" }, // the variable each setting is read from
  tools: [
    {
      name: "getOrder",
      description: "One order: its status and last update. Read-only.",
      inputSchema: z.object({ id: z.string() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      run: async ({ id }, { app, env, settings }) => [
        { source: "order", at: null, summary: `order ${id} …`, data: {} },
      ],
    },
  ],
});
```

- The tool is served as `order.getOrder`, with `app` and `env` added, like the
  core tools. Its result names the app and environment it read.
- `settings` come from the environment variable named in `env`, and the
  configuration overrides them per environment:

  ```json
  "prod": { "sources": [], "addons": { "order": { "dbUrl": "${ORDER_DB_URL}", "tenant": "eu" } } }
  ```

  `${NAME}` is the environment variable NAME: a credential never sits in the file.

- The default export is a function receiving `{ z }` (zod), so the addon needs
  no `node_modules` of its own.
- Tools must declare `readOnlyHint: true` and `destructiveHint: false`, or the
  addon is skipped. An addon is code you run with your credentials; Node has no
  sandbox, so give each source a **read-only account**.

## A connector type

An addon can bring a type of source (`type` in `ops.config.json`), as the
built-in `addons/logs` does for `file-logs`: declare its `options` (zod) and a
`create` returning a connector.

## When something is wrong

An addon that fails (bad definition, wrong `apiVersion`, a tool without the
read-only hints, an error at load) is **skipped with a line saying why**; the
rest keeps working. In an environment where its settings are invalid, its tools
refuse with the reason and the other environments work.

```bash
npm run ops -- --workspace ops doctor
```

lists every addon as loaded, skipped or replaced, with the reason.
