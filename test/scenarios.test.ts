// The scenarios of the demo world are tests of the world: each one's own
// investigation runs through the real tools, its conclusion is accepted by the
// check, and its `expect` is what its own answer says (so `ops eval` can score a
// model against something reachable) and what the question does not give away.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { questionFor, scoreAnswer } from "../src/agent/eval.ts";
import { defaultScenario, runDemo, scenarios } from "../src/demo.ts";
import { openToolbox } from "../src/toolbox.ts";
import { createToolDefinitions } from "../src/tools/index.ts";

const workspace = resolve("examples/my-workspace");
const all = scenarios(workspace);

test("the demo world has several incidents of different kinds, and ops demo keeps the stuck order by default", () => {
  assert.deepEqual(all.map((s) => s.id).sort(), ["missing-emails", "slow-checkout", "stuck-order"]);
  assert.equal(defaultScenario(all)!.id, "stuck-order");
  for (const s of all) {
    assert.ok(
      s.expect?.facts.some((f) => f.required),
      `${s.id}: at least one required fact`,
    );
    assert.ok(s.expect!.facts.length >= 4, `${s.id}: the facts of a deep answer`);
  }
});

for (const scenario of all) {
  test(`scenario ${scenario.id}: its investigation runs through the real tools and its conclusion is accepted`, async () => {
    const toolbox = await openToolbox(workspace);
    const tools = createToolDefinitions(toolbox);
    for (const step of (scenario as unknown as { steps: { tool: string; input: object }[] }).steps) {
      const tool = tools.find((t) => t.name === step.tool);
      assert.ok(tool, `${scenario.id}: no tool ${step.tool}`);
      const out = await tool.run(tool.inputSchema.parse(step.input));
      assert.ok(out.length > 0);
    }
    const check = tools.find((t) => t.name === "checkConclusion")!;
    const conclusion = (scenario as unknown as { conclusion: object }).conclusion;
    const verdict = JSON.parse(await check.run(check.inputSchema.parse(conclusion))) as {
      ok: boolean;
      problems: string[];
      report: string;
    };
    assert.deepEqual(verdict.problems, [], `${scenario.id}: the check refused its own conclusion`);

    // what the scenario expects is what its own report says...
    const own = scoreAnswer(scenario, verdict.report);
    assert.equal(own.cause, true, `${scenario.id}: the report names the required facts`);
    assert.equal(own.facts.length, scenario.expect!.facts.length, `${scenario.id}: and every other expected fact`);
    // ...and what the question does not give away.
    assert.equal(
      scoreAnswer(scenario, questionFor(scenario)).cause,
      false,
      `${scenario.id}: the question does not name the cause`,
    );
  });

  test(`scenario ${scenario.id}: ops demo replays it`, async () => {
    const lines: string[] = [];
    const result = await runDemo(await openToolbox(workspace), workspace, { scenario: scenario.id, pace: 0 }, (l) =>
      lines.push(l),
    );
    assert.equal(result.ok, true, lines.join("\n"));
  });
}
