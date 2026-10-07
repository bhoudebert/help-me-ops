// The demo world is a test: the scenario's investigation, step by step through
// the real tools, must reach its conclusion with evidence the fixtures hold.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { openToolbox } from "../src/toolbox.ts";
import { createToolDefinitions } from "../src/tools/index.ts";

const workspace = resolve("examples/workspace");
const scenario = JSON.parse(readFileSync(join(workspace, "scenarios/stuck-order.json"), "utf8")) as {
  question: string;
  scope: { app: string; env: string };
  playbook: string;
  steps: { why: string; tool: string; input: Record<string, unknown> }[];
  conclusion: {
    certainty: string;
    evidence: { source: string; at: string; quote: string }[];
    unknowns: string[];
    next: string;
  };
};

async function replay() {
  const tools = createToolDefinitions(await openToolbox(workspace));
  const results: { tool: string; input: Record<string, unknown>; text: string }[] = [];
  for (const step of scenario.steps) {
    const tool = tools.find((t) => t.name === step.tool);
    assert.ok(tool, `the scenario uses ${step.tool}, which the toolbox must have`);
    results.push({ tool: step.tool, input: step.input, text: await tool.run(tool.inputSchema.parse(step.input)) });
  }
  return results;
}

test("demo: the question points at shop in production, with the playbook for it", async () => {
  const [scope, playbooks] = (await replay()).map((r) => JSON.parse(r.text));
  assert.deepEqual([scope.likely.app, scope.likely.env], [scenario.scope.app, scenario.scope.env]);
  assert.equal(playbooks[0].id, scenario.playbook);
});

test("demo: every quote of the conclusion comes from a result of the investigation", async () => {
  const results = await replay();
  const seen = results.flatMap((r) =>
    r.tool === "scope" || r.tool === "listPlaybooks" ? [] : JSON.parse(r.text).evidence,
  );
  const summaries = seen.map((e: { source: string; at: string | null; summary: string }) => e);
  for (const { source, at, quote } of scenario.conclusion.evidence) {
    const found = summaries.find((e) => e.summary.includes(quote) && e.source === source);
    assert.ok(found, `no result holds "${quote}" from ${source}`);
    assert.equal(found.at, at, quote);
  }
  assert.equal(scenario.conclusion.certainty, "likely");
  assert.ok(scenario.conclusion.unknowns.length > 0 && scenario.conclusion.next.length > 0);
});

test("demo: the fault is in prod only, the other orders are found, staging is healthy", async () => {
  const results = await replay();
  const staging = results.at(-1)!;
  const memory = JSON.parse(staging.text);
  assert.equal(memory.env, "staging");
  assert.ok(memory.evidence.every((e: { data: { value: number } }) => e.data.value < 256));
  const others = JSON.parse(results.find((r) => r.tool === "order.listOrders")!.text);
  assert.deepEqual(
    others.evidence.map((e: { data: { id: string } }) => e.data.id),
    ["4512", "4513", "4514"],
  );
  // The provider answered: the refusal was ours.
  const health = JSON.parse(results.find((r) => r.tool === "health.checkHealth")!.text);
  assert.ok(health.evidence.some((e: { summary: string }) => /acme-pay provider status -> 200/.test(e.summary)));
  assert.ok(health.evidence.some((e: { summary: string }) => /hooks\/acme-pay -> 503/.test(e.summary)));
});

test("demo: the same question in staging finds no such order", async () => {
  const tools = createToolDefinitions(await openToolbox(workspace));
  const order = tools.find((t) => t.name === "order.getOrder")!;
  assert.deepEqual(JSON.parse(await order.run({ env: "staging", id: "4512" })).evidence, []);
});
