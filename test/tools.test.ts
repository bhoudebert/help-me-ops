import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { runCommand, USAGE } from "../src/commands.ts";
import { openToolbox } from "../src/toolbox.ts";
import { createToolDefinitions } from "../src/tools/index.ts";

const toolbox = await openToolbox(resolve("ops.config.example.json"));

test("tools: every tool states all four hints, and none may change the system", () => {
  const tools = createToolDefinitions(toolbox);
  assert.deepEqual(
    tools.map((t) => t.name),
    ["listSources", "searchSource", "listPlaybooks", "getPlaybook"],
  );
  for (const tool of tools) {
    const hints = Object.values(tool.annotations);
    assert.equal(hints.length, 4, tool.name);
    assert.ok(
      hints.every((h) => typeof h === "boolean"),
      tool.name,
    );
    assert.equal(tool.annotations.readOnlyHint, true, `${tool.name} is read-only (ADR 0002)`);
    assert.equal(tool.annotations.destructiveHint, false, tool.name);
  }
});

test("tools: search a source, read a playbook, clear errors for unknown names", async () => {
  const [, search, , playbook] = createToolDefinitions(toolbox);
  const found = JSON.parse(await search!.run({ source: "orders-db", query: "4512" }));
  assert.equal(found[0].data.status, "awaiting_payment");
  assert.match(await playbook!.run({ id: "order-stuck" }), /^# Order stuck or missing\n\nWhen: a client cannot find/);
  await assert.rejects(search!.run({ source: "nope", query: "x" }), /No source "nope"\. Known: app-logs, orders-db\./);
  await assert.rejects(playbook!.run({ id: "nope" }), /No playbook "nope"/);
});

test("commands: sources, playbooks, search with options, investigate, usage", async () => {
  assert.match(await runCommand(toolbox, "sources", []), /"id": "app-logs"/);
  assert.match(await runCommand(toolbox, "playbooks", ["order", "stuck"]), /"id": "order-stuck"/);
  const window = JSON.parse(
    await runCommand(toolbox, "search", ["app-logs", "order=4512", "--from", "2026-10-07T10:00:00Z", "--limit", "1"]),
  );
  assert.deepEqual(
    window.map((e: any) => e.at),
    ["2026-10-07T10:00:02Z"],
  );
  const plan = await runCommand(toolbox, "investigate", ["order", "4512", "is", "stuck"]);
  assert.match(plan, /^Question: order 4512 is stuck\nPlaybook: Order stuck or missing \(order-stuck\)/);
  assert.match(plan, /- orders-db \(database\)/);
  assert.match(await runCommand({ ...toolbox, playbooks: [] }, "investigate", ["cpu", "high"]), /No playbook matches/);
  await assert.rejects(runCommand(toolbox, "search", ["app-logs"]), /Usage: search/);
  await assert.rejects(runCommand(toolbox, "investigate", []), /Usage: investigate/);
  assert.equal(await runCommand(toolbox, "what", []), USAGE);
});
