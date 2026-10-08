import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { runCommand, USAGE } from "../src/commands.ts";
import { openToolbox } from "../src/toolbox.ts";
import { createToolDefinitions } from "../src/tools/index.ts";

const toolbox = await openToolbox(resolve("examples/my-workspace"));

test("tools: every tool states all four hints, and none may change the system", () => {
  const tools = createToolDefinitions(toolbox);
  assert.deepEqual(
    tools.map((t) => t.name),
    [
      "scope",
      "listSources",
      "searchSource",
      "listPlaybooks",
      "getPlaybook",
      "health.checkHealth",
      "metrics.listMetrics",
      "metrics.queryMetric",
      "order.getOrder",
      "order.listOrders",
    ],
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
  const tool = (name: string) => createToolDefinitions(toolbox).find((t) => t.name === name)!;
  const [search, playbook, order] = [tool("searchSource"), tool("getPlaybook"), tool("order.getOrder")];
  const found = JSON.parse(await search.run({ env: "prod", source: "app-logs", query: "order=4512" }));
  assert.deepEqual([found.app, found.env, found.source], ["shop", "prod", "app-logs"]);
  assert.equal(found.evidence.length, 6);
  const row = JSON.parse(await order.run({ env: "prod", id: "4512" }));
  assert.equal(row.evidence[0].data.status, "awaiting_payment");
  assert.deepEqual(JSON.parse(await order.run({ env: "staging", id: "4512" })).evidence, []);
  assert.match(await playbook.run({ id: "order-stuck" }), /^# Order stuck or missing\n\nWhen: a client cannot find/);
  await assert.rejects(
    search.run({ env: "prod", source: "nope", query: "x" }),
    /No source "nope" in shop\/prod\. Known: app-logs\./,
  );
  await assert.rejects(search.run({ source: "app-logs", query: "x" }), /Several envs \(prod, staging\)/);
  await assert.rejects(playbook.run({ id: "nope" }), /No playbook "nope"/);
});

test("commands: sources, playbooks, search with options, investigate, usage", async () => {
  await assert.rejects(runCommand(toolbox, "sources", []), /Several envs/);
  assert.match(await runCommand(toolbox, "sources", ["--app", "shop", "--env", "prod"]), /"id": "app-logs"/);
  assert.match(await runCommand(toolbox, "scope", ["order", "4512", "in", "production"]), /"env": "prod"/);
  assert.match(await runCommand(toolbox, "scope", []), /"workspace": ".*my-workspace"/);
  assert.match(await runCommand(toolbox, "playbooks", ["order", "stuck"]), /"id": "order-stuck"/);
  const window = JSON.parse(
    await runCommand(toolbox, "search", [
      "app-logs",
      "order=4512",
      "--env",
      "prod",
      "--from",
      "2026-10-07T10:00:00Z",
      "--limit",
      "1",
    ]),
  );
  assert.deepEqual(
    window.evidence.map((e: any) => e.at),
    ["2026-10-07T10:00:02Z"],
  );
  const plan = await runCommand(toolbox, "investigate", ["order", "4512", "is", "stuck"]);
  assert.match(plan, /^Question: order 4512 is stuck\nPlaybook: Order stuck or missing \(order-stuck\)/);
  assert.match(plan, /- shop\/prod: app-logs \(logs\)/);
  assert.match(plan, /- shop\/staging: app-logs \(logs\)/);
  assert.match(await runCommand({ ...toolbox, playbooks: [] }, "investigate", ["cpu", "high"]), /No playbook matches/);
  await assert.rejects(runCommand(toolbox, "search", ["app-logs"]), /Usage: search/);
  await assert.rejects(runCommand(toolbox, "investigate", []), /Usage: investigate/);
  assert.equal(await runCommand(toolbox, "what", []), USAGE);
});
