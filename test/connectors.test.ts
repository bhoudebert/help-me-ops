import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileLogs } from "../addons/logs/fileLogs.ts";
import { addonFolders, loadAddons } from "../src/addons/loader.ts";
import { connectorTypes } from "../src/addons/runtime.ts";
import { createConnectors } from "../src/connectors/registry.ts";

const types = connectorTypes((await loadAddons(addonFolders(process.cwd(), []))).addons);

const logs = fileLogs({ id: "app-logs", description: "app", path: "examples/my-workspace/logs/prod.log" });

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
  assert.deepEqual(await logs.search({ query: "zzz qqq" }), []);
  // every word, in any order, case ignored: a natural question finds the line
  const words = await logs.search({ query: "Queue FULL webhook" });
  assert.equal(words.length, 1);
  assert.match(words[0]!.summary, /webhook endpoint \/hooks\/acme-pay returned 503 to provider \(queue full\)/);
  assert.deepEqual(await logs.search({ query: "unicorn" }), [], "a word that is not there is no match");
  // no line has every word: the lines with the most of them, best first, marked as partial
  const partial = await logs.search({ query: "queue unicorn" });
  assert.ok(partial.length >= 2);
  assert.ok(partial.every((e) => (e.data as { partial: string }).partial === "1 of 2 words"));
  const ranked = await logs.search({ query: "refused unicorn webhook 503 gone" });
  assert.match(ranked[0]!.summary, /503/, "the line with the most of the words comes first");
  assert.ok((ranked[0]!.data as { partial: string }).partial.startsWith("2 of 5"));
  assert.deepEqual(await logs.search({ query: "   " }), [], "an empty search finds nothing");
});

test("file logs: a line without a time is kept only without a window", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ops-"));
  writeFileSync(join(dir, "plain.log"), "boot sequence 4512\n2026-10-07T10:00:00Z order 4512\n");
  const plain = fileLogs({ id: "plain", description: "p", path: join(dir, "plain.log") });
  assert.equal((await plain.search({ query: "4512" })).length, 2);
  assert.equal((await plain.search({ query: "4512", from: "2026-10-07T00:00:00Z" })).length, 1);
});

test("registry: built-in and module sources; unique ids; a module must export createConnector", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ops-"));
  writeFileSync(
    join(dir, "mine.ts"),
    'export const createConnector = ({ id, description }) => ({ id, kind: "custom", description, search: async () => [] });\n',
  );
  const { connectors: sources } = await createConnectors(
    [
      { type: "file-logs", id: "app-logs", description: "logs", path: "examples/my-workspace/logs/prod.log" },
      { type: "module", id: "mine", description: "mine", module: "mine.ts" },
    ],
    dir,
    types,
  );
  assert.deepEqual(
    sources.map((s) => [s.id, s.kind]),
    [
      ["app-logs", "logs"],
      ["mine", "custom"],
    ],
  );

  await assert.rejects(
    createConnectors(
      [
        { type: "file-logs", id: "same", description: "a", path: "x.log" },
        { type: "file-logs", id: "same", description: "b", path: "y.log" },
      ],
      process.cwd(),
      types,
    ),
    /Two sources are named same/,
  );
  writeFileSync(join(dir, "empty.ts"), "export const nothing = 1;\n");
  await assert.rejects(
    createConnectors([{ type: "module", id: "bad", description: "b", module: "empty.ts" }], dir),
    /does not export createConnector/,
  );
});

test("registry: a type nobody provides is left out; wrong options are refused", async () => {
  const left = await createConnectors([{ type: "postgres", id: "db", description: "d" }], process.cwd(), types);
  assert.deepEqual(left.connectors, []);
  assert.match(left.skipped[0]!, /source db: no connector type "postgres"/);
  await assert.rejects(
    createConnectors([{ type: "file-logs", id: "x", description: "d" }], process.cwd(), types),
    /Source x \(file-logs\)/,
  );
  await assert.rejects(
    createConnectors([{ type: "module", id: "m", description: "d" }], process.cwd(), types),
    /a module source needs "module"/,
  );
});
