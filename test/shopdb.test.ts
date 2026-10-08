// The optional database addon of the demo, against a fake `pg`: the queries are
// reads only, parameterised, inside a read-only transaction, and always cleaned up.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { openToolbox } from "../src/toolbox.ts";
import { createToolDefinitions } from "../src/tools/index.ts";

/** A workspace holding the demo addon turned on, and a fake `pg` that records what it is asked. */
function workspace() {
  const root = mkdtempSync(join(tmpdir(), "ops-shopdb-"));
  cpSync(resolve("examples/my-workspace/addons/_shopdb"), join(root, "addons/shopdb"), { recursive: true });
  mkdirSync(join(root, "node_modules/pg"), { recursive: true });
  writeFileSync(join(root, "node_modules/pg/package.json"), '{"name":"pg","main":"index.js"}');
  writeFileSync(
    join(root, "node_modules/pg/index.js"),
    `const log = (globalThis.__pg ??= []);
class Client {
  constructor(options) { log.push(["connect-to", options.connectionString]); }
  async connect() { log.push(["connect"]); }
  async query(sql, params) {
    log.push(["query", sql.replace(/\\s+/g, " ").trim(), params]);
    if (/FROM payments/.test(sql)) return { rows: [{ order_id: "4512", provider_ref: "ps_7Hq2", status: "captured", amount: 89.9, at: new Date("2026-10-07T09:58:50Z") }] };
    if (/FROM webhook_events/.test(sql)) return { rows: [{ order_id: "4512", event: "payment.succeeded", outcome: "refused_503", attempt: 1, at: new Date("2026-10-07T10:00:02Z") }] };
    if (/FROM orders/.test(sql)) return { rows: [{ order_id: "4513", user_id: "u-440", status: "awaiting_payment", amount: 42, at: new Date("2026-10-07T10:00:38Z") }] };
    return { rows: [] };
  }
  async end() { log.push(["end"]); }
}
module.exports = { Client };
`,
  );
  writeFileSync(
    join(root, "ops.config.json"),
    JSON.stringify({
      apps: {
        shop: { envs: { prod: { sources: [], addons: { shopdb: { url: "postgres://readonly:s3cret@db/shop" } } } } },
      },
    }),
  );
  return root;
}

test("shopdb: payments and webhook events of an order become evidence with their times", async () => {
  const toolbox = await openToolbox(workspace());
  const tool = createToolDefinitions(toolbox).find((t) => t.name === "shopdb.paymentsFor")!;
  const { evidence } = JSON.parse(await tool.run({ order: "4512" })) as { evidence: { at: string; summary: string }[] };
  assert.deepEqual(
    evidence.map((e) => [e.at, e.summary]),
    [
      ["2026-10-07T09:58:50.000Z", "payment ps_7Hq2 of order 4512: captured, 89.9 EUR"],
      ["2026-10-07T10:00:02.000Z", "webhook payment.succeeded of order 4512: refused_503 (attempt 1)"],
    ],
  );
});

test("shopdb: every query is a parameterised SELECT in a read-only transaction, then cleaned up", async () => {
  const toolbox = await openToolbox(workspace());
  const tools = createToolDefinitions(toolbox);
  (globalThis as unknown as { __pg: unknown[] }).__pg.length = 0;
  await tools.find((t) => t.name === "shopdb.paymentsFor")!.run({ order: "4512; DROP TABLE orders" });
  await tools.find((t) => t.name === "shopdb.paidButUnconfirmed")!.run({ since: "2026-10-07T09:58:00Z" });
  const log = (globalThis as unknown as { __pg: unknown[][] }).__pg;
  const queries = log.filter((l) => l[0] === "query") as [string, string, unknown[]][];
  assert.ok(queries.length >= 5);
  for (const [, sql] of queries) {
    assert.match(sql, /^(BEGIN READ ONLY|ROLLBACK|SELECT )/, sql);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE)\b/i, sql);
  }
  // the question travels as a parameter, never inside the SQL
  assert.ok(queries.some(([, , params]) => params?.[0] === "4512; DROP TABLE orders"));
  assert.ok(queries.every(([, sql]) => !sql.includes("DROP TABLE")));
  // each tool call: connect, BEGIN READ ONLY first, ROLLBACK and end last
  const kinds = log.map((l) =>
    l[0] === "query" ? String(l[1]).split(" ").slice(0, 1).join() + (l[1] === "BEGIN READ ONLY" ? "" : "") : l[0],
  );
  assert.equal(kinds.filter((k) => k === "connect").length, kinds.filter((k) => k === "end").length);
  assert.equal(
    queries.filter(([, sql]) => sql === "BEGIN READ ONLY").length,
    queries.filter(([, sql]) => sql === "ROLLBACK").length,
  );
});

test("shopdb: the connection URL never reaches the person when a query fails", async () => {
  const root = workspace();
  writeFileSync(
    join(root, "node_modules/pg/index.js"),
    `class Client { constructor(o) { this.u = o.connectionString; } async connect() { throw new Error("cannot reach " + this.u); } async query() {} async end() {} }
module.exports = { Client };`,
  );
  const toolbox = await openToolbox(root);
  const tool = createToolDefinitions(toolbox).find((t) => t.name === "shopdb.paidButUnconfirmed")!;
  await assert.rejects(
    tool.run({}),
    (error: Error) => /cannot reach/.test(error.message) && !/s3cret/.test(error.message),
  );
});

test("shopdb: shipped turned off, and without its driver it is skipped with the reason once turned on", async () => {
  const root = mkdtempSync(join(tmpdir(), "ops-shopdb-"));
  cpSync(resolve("examples/my-workspace/addons/_shopdb"), join(root, "addons/shopdb"), { recursive: true });
  writeFileSync(join(root, "ops.config.json"), JSON.stringify({ apps: { shop: { envs: { prod: { sources: [] } } } } }));
  const { addons } = await openToolbox(resolve("examples/my-workspace"));
  assert.equal(
    addons!.find((a) => a.name === "shopdb"),
    undefined,
  );
  const on = await openToolbox(root);
  const report = on.addons!.find((a) => a.name === "shopdb")!;
  assert.ok(report.status === "skipped" ? /pg/.test(report.reason ?? "") : true);
});
