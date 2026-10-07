import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileLogs } from "../src/connectors/fileLogs.ts";
import { createConnectors } from "../src/connectors/registry.ts";

const logs = fileLogs({ id: "app-logs", description: "app", path: "examples/logs/app.log" });

test("file logs: lines with the term, oldest first, with their time", async () => {
  const found = await logs.search({ query: "order=4512" });
  assert.equal(found.length, 6);
  assert.deepEqual(found[0], {
    source: "app-logs",
    at: "2026-10-07T09:58:12Z",
    summary: "2026-10-07T09:58:12Z INFO  api       POST /orders user=u-881 -> order=4512 created, total=89.90 EUR",
    data: {
      line: "2026-10-07T09:58:12Z INFO  api       POST /orders user=u-881 -> order=4512 created, total=89.90 EUR",
    },
  });
});

test("file logs: a time window, a limit, case ignored", async () => {
  const window = await logs.search({ query: "ORDER=4512", from: "2026-10-07T10:00:00Z", to: "2026-10-07T10:05:00Z" });
  assert.deepEqual(
    window.map((e) => e.at),
    ["2026-10-07T10:00:02Z", "2026-10-07T10:02:03Z"],
  );
  assert.equal((await logs.search({ query: "order", limit: 2 })).length, 2);
  assert.deepEqual(await logs.search({ query: "nothing like this" }), []);
});

test("file logs: a line without a time is kept only without a window", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ops-"));
  writeFileSync(join(dir, "plain.log"), "boot sequence 4512\n2026-10-07T10:00:00Z order 4512\n");
  const plain = fileLogs({ id: "plain", description: "p", path: join(dir, "plain.log") });
  assert.equal((await plain.search({ query: "4512" })).length, 2);
  assert.equal((await plain.search({ query: "4512", from: "2026-10-07T00:00:00Z" })).length, 1);
});

test("registry: built-in and module sources; unique ids; a module must export createConnector", async () => {
  const sources = await createConnectors(
    [
      { type: "file-logs", id: "app-logs", description: "logs", path: "examples/logs/app.log" },
      { type: "module", id: "orders-db", description: "orders", module: "examples/connectors/orders-db.ts" },
    ],
    process.cwd(),
  );
  assert.deepEqual(
    sources.map((s) => [s.id, s.kind]),
    [
      ["app-logs", "logs"],
      ["orders-db", "database"],
    ],
  );
  const [row] = await sources[1]!.search({ query: "4512" });
  assert.equal(row!.summary, "order 4512 of u-881: awaiting_payment since 2026-10-07T09:58:13Z");

  await assert.rejects(
    createConnectors(
      [
        { type: "file-logs", id: "same", description: "a", path: "x.log" },
        { type: "file-logs", id: "same", description: "b", path: "y.log" },
      ],
      process.cwd(),
    ),
    /Two sources are named same/,
  );
  const dir = mkdtempSync(join(tmpdir(), "ops-"));
  writeFileSync(join(dir, "empty.ts"), "export const nothing = 1;\n");
  await assert.rejects(
    createConnectors([{ type: "module", id: "bad", description: "b", module: "empty.ts" }], dir),
    /does not export createConnector/,
  );
});
