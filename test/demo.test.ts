// The demo world is a test: the scenario's investigation, step by step through
// the real tools, must reach its conclusion with evidence the fixtures hold.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { openToolbox } from "../src/toolbox.ts";
import { createToolDefinitions } from "../src/tools/index.ts";

const workspace = resolve("examples/my-workspace");
const scenario = JSON.parse(readFileSync(join(workspace, "scenarios/stuck-order.json"), "utf8")) as {
  question: string;
  scope: { app: string; env: string };
  playbook: string;
  steps: { why: string; tool: string; input: Record<string, unknown> }[];
  conclusion: {
    app: string;
    env?: string;
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
  return Object.assign(results, { tools });
}

test("demo: the question points at shop in production, with the playbook for it", async () => {
  const [scope, playbooks] = (await replay()).map((r) => JSON.parse(r.text));
  assert.deepEqual([scope.likely.app, scope.likely.env], [scenario.scope.app, scenario.scope.env]);
  assert.equal(playbooks[0].id, scenario.playbook);
});

test("demo: the conclusion of the scenario is accepted by the check, and the report has the same layout for every client", async () => {
  const session = await replay();
  const check = session.tools.find((t) => t.name === "checkConclusion")!;
  const verdict = JSON.parse(await check.run(check.inputSchema.parse(scenario.conclusion)));
  assert.equal(verdict.ok, true, JSON.stringify(verdict.problems));
  assert.deepEqual(verdict.problems, []);
  assert.ok(verdict.checked.every((c: { status: string }) => c.status === "found"));
  assert.equal(verdict.checked.length, scenario.conclusion.evidence.length);
  assert.match(verdict.report, /^## Conclusion: likely \(shop \/ prod\)\n\n\*\*Cause\.\*\* The payment webhook/);
  assert.match(verdict.report, /- 2026-10-07T09:50:14Z · app-logs · 41 jobs\/min/);
  assert.ok(verdict.report.indexOf("09:50:14") < verdict.report.indexOf("10:01:04"), "oldest first");
  assert.match(verdict.report, /\*\*Still unknown\*\*\n- Whether release 2\.14\.0 introduced a memory leak/);
  assert.match(verdict.report, /\*\*Next step, for a person\.\*\* Restart or scale shop-worker/);
  assert.equal(scenario.conclusion.certainty, "likely");
});

test("demo: a conclusion that quotes what no tool returned is refused, naming the quote", async () => {
  const session = await replay();
  const check = session.tools.find((t) => t.name === "checkConclusion")!;
  const refuse = async (change: (c: typeof scenario.conclusion) => void) => {
    const copy = structuredClone(scenario.conclusion);
    change(copy);
    return JSON.parse(await check.run(check.inputSchema.parse(copy)));
  };
  const invented = await refuse((c) =>
    c.evidence.push({ source: "app-logs", at: "2026-10-07T10:00:03Z", quote: "the database was down for ten minutes" }),
  );
  assert.equal(invented.ok, false);
  assert.match(invented.problems.join("\n"), /quote not found .*"the database was down for ten minutes"/);
  assert.equal(invented.report, undefined);
  assert.match(
    (await refuse((c) => (c.evidence[1]!.source = "metrics"))).problems.join(),
    /comes from app-logs, knowledge, not from metrics/,
  );
  assert.match(
    (await refuse((c) => (c.evidence[1]!.at = "2026-10-07T10:30:00Z"))).problems.join(),
    /is at 2026-10-07T10:00:02Z, not 2026-10-07T10:30:00Z/,
  );
  assert.match((await refuse((c) => (c.env = "staging"))).problems.join("\n"), /is about staging/);
  assert.match((await refuse((c) => (c.env = undefined))).problems.join("\n"), /say which environment/);
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
