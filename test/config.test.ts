import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { configPath, loadConfig } from "../src/config.ts";
import { matchPlaybooks, parsePlaybook } from "../src/playbooks.ts";
import { openToolbox } from "../src/toolbox.ts";

test("config: the example loads; a missing or invalid file says what to do", async () => {
  const { config } = await loadConfig(resolve("ops.config.example.json"));
  assert.deepEqual(
    config.sources.map((s) => s.id),
    ["app-logs", "orders-db"],
  );
  assert.equal(configPath({ OPS_CONFIG: "/x/ops.json" }), "/x/ops.json");
  assert.equal(configPath({}), resolve("ops.config.json"));
  await assert.rejects(loadConfig("/nowhere/ops.config.json"), /Copy ops.config.example.json to ops.config.json/);
  const dir = mkdtempSync(join(tmpdir(), "ops-"));
  writeFileSync(join(dir, "bad.json"), JSON.stringify({ sources: [{ type: "file-logs", id: "x" }] }));
  await assert.rejects(loadConfig(join(dir, "bad.json")), /Invalid config/);
});

test("playbooks: front matter read, README skipped, matched by the words of the report", async () => {
  const toolbox = await openToolbox(resolve("ops.config.example.json"));
  assert.deepEqual(
    toolbox.playbooks.map((p) => p.id),
    ["order-stuck"],
  );
  const [stuck] = toolbox.playbooks;
  assert.equal(stuck!.name, "Order stuck or missing");
  assert.deepEqual(
    matchPlaybooks(toolbox.playbooks, "my client cannot find his order 4512").map((p) => p.id),
    ["order-stuck"],
  );
  assert.deepEqual(matchPlaybooks(toolbox.playbooks, "the CPU is high"), []);
  assert.deepEqual(parsePlaybook("bare", "Just steps."), { id: "bare", name: "bare", when: "", body: "Just steps." });
});
