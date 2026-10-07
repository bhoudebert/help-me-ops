import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { loadConfig, resolveWorkspace } from "../src/config.ts";
import { matchPlaybooks, parsePlaybook } from "../src/playbooks.ts";
import { openToolbox } from "../src/toolbox.ts";

const DEMO = resolve("examples/workspace");

test("config: the demo workspace loads; a missing or invalid file says what to do", async () => {
  const { config, baseDir } = await loadConfig(DEMO);
  assert.equal(baseDir, DEMO);
  assert.deepEqual(Object.keys(config.apps), ["shop"]);
  assert.deepEqual(Object.keys(config.apps.shop!.envs), ["prod", "staging"]);
  assert.deepEqual(
    config.apps.shop!.envs.prod!.sources.map((s) => s.id),
    ["app-logs"],
  );
  assert.deepEqual(Object.keys(config.apps.shop!.envs.staging!.addons), ["order", "metrics", "health"]);
  await assert.rejects(loadConfig("/nowhere"), /No ops.config.json in \/nowhere\. Copy examples\/workspace/);
  const dir = mkdtempSync(join(tmpdir(), "ops-"));
  const bad = (json: string) => {
    writeFileSync(join(dir, "ops.config.json"), json);
    return loadConfig(dir);
  };
  await assert.rejects(bad("{ nope"), /Invalid config/);
  await assert.rejects(
    bad(JSON.stringify({ apps: { a: { envs: { prod: { sources: [{ type: "file-logs", id: "x" }] } } } } })),
    /Invalid config/,
  );
  await assert.rejects(bad(JSON.stringify({ sources: [] })), /flat "sources" list of an earlier version/);
  await assert.rejects(bad(JSON.stringify({ apps: {} })), /declare at least one app/);
  await assert.rejects(bad(JSON.stringify({ apps: { a: { envs: {} } } })), /at least one environment/);
});

test("workspace: --workspace, then OPS_WORKSPACE, then the current folder", () => {
  assert.equal(resolveWorkspace(["search", "--workspace", "/w/a"], { OPS_WORKSPACE: "/w/b" }), "/w/a");
  assert.equal(resolveWorkspace(["search"], { OPS_WORKSPACE: "/w/b" }), "/w/b");
  assert.equal(resolveWorkspace([], {}), resolve("."));
  assert.throws(() => resolveWorkspace(["--workspace"], {}), /--workspace needs a folder/);
});

test("playbooks: front matter read, README skipped, matched by the words of the report", async () => {
  const toolbox = await openToolbox(DEMO);
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
