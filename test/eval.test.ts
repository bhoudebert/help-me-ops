// `ops eval`: count what a model does on the scenarios. Against a scripted server,
// so the counting is tested and no model is called.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { formatReport, questionFor, runEval, scoreAnswer } from "../src/agent/eval.ts";
import type { Scenario } from "../src/demo.ts";
import { scenarios } from "../src/demo.ts";
import { openToolbox } from "../src/toolbox.ts";
import { fakeChat, type Step } from "./fake-chat.ts";

const workspace = resolve("examples/my-workspace");
const scenario = JSON.parse(readFileSync(join(workspace, "scenarios/stuck-order.json"), "utf8")) as {
  steps: { tool: string; input: object }[];
  conclusion: object;
};
const wire = (tool: string) => tool.replaceAll(".", "_");
const call = (name: string, input: object): Step => ({ calls: [{ name, arguments: input }] });
/** The demo's own investigation: every fact is named. */
const good = (): Step[] => [
  ...scenario.steps.map((s) => call(wire(s.tool), s.input)),
  call("checkConclusion", scenario.conclusion),
];
/** One tool, then words and no conclusion. */
const weak = (): Step[] => [call("listPlaybooks", {}), { content: "The order is awaiting payment." }];

test("the demo scenario says what a good answer names, with the required facts first", () => {
  const demo = scenarios(workspace).find((s) => s.id === "stuck-order")!;
  assert.deepEqual(
    demo.expect!.facts.filter((f) => f.required).map((f) => f.name),
    ["the webhook was refused (503)", "the payment queue was full"],
  );
  assert.ok(demo.expect!.facts.length >= 4);
});

test("the question carries the scope a person would have answered", () => {
  assert.equal(
    questionFor({
      question: "Client u-881 paid but cannot find order 4512",
      scope: { app: "shop", env: "prod" },
    } as Scenario),
    "Client u-881 paid but cannot find order 4512. It is the shop app, in the prod environment.",
  );
  assert.equal(questionFor({ question: "q" } as Scenario), "q");
  assert.equal(questionFor({ question: "q", scope: { env: "prod" } } as Scenario), "q. It is the prod environment.");
});

test("score: keywords, case ignored, any of the words; the required facts make the cause", () => {
  const s = {
    expect: {
      facts: [
        { name: "a", any: ["503"], required: true },
        { name: "b", any: ["Queue", "backlog"], required: true },
        { name: "c", any: ["oom"] },
      ],
    },
  } as Scenario;
  assert.deepEqual(scoreAnswer(s, "refused with a 503; the QUEUE was full"), { facts: ["a", "b"], cause: true });
  assert.deepEqual(scoreAnswer(s, "a 503 and an OOM"), { facts: ["a", "c"], cause: false });
  assert.deepEqual(
    scoreAnswer({} as Scenario, "anything"),
    { facts: [], cause: true },
    "nothing expected, nothing missing",
  );
});

test("eval: every setting is run the same number of times, each in a fresh session, and counted", async () => {
  const server = await fakeChat([...good(), ...weak(), ...good(), ...weak()]);
  try {
    const toolbox = await openToolbox(workspace);
    const progress: string[] = [];
    const report = await runEval(
      toolbox,
      workspace,
      { runs: 2, models: ["fake"], reasoning: ["none", "default"], baseUrl: server.url },
      {},
      globalThis.fetch,
      (line) => progress.push(line),
    );
    assert.equal(report.scenario, "stuck-order");
    assert.equal(report.settings.length, 2);
    assert.deepEqual(progress[0], "fake · reasoning none · run 1/2");
    const [none, standard] = report.settings;
    for (const setting of [none!, standard!]) {
      assert.deepEqual(
        setting.runs.map((r) => r.status),
        ["concluded", "answered"],
      );
      assert.deepEqual(
        setting.runs.map((r) => r.cause),
        [true, false],
      );
      assert.equal(setting.runs[0]!.facts.length, 5, "the demo's own conclusion names everything");
      assert.equal(setting.runs[0]!.steps, 13);
      assert.equal(setting.runs[1]!.steps, 1);
    }
    // reasoning is sent for the setting that asks, and left out for default
    const bodies = server.requests as unknown as { reasoning_effort?: string }[];
    assert.equal(bodies[0]!.reasoning_effort, "none");
    assert.equal(bodies.at(-1)!.reasoning_effort, undefined);
    // a fresh conversation each run
    const firstOfSecondRun = server.requests[13]!;
    assert.deepEqual(
      firstOfSecondRun.messages.map((m) => m.role),
      ["system", "user"],
    );

    const text = formatReport(report);
    assert.match(text, /^ops eval: stuck-order · 2 run\(s\) per setting · http:\/\/127\.0\.0\.1:\d+\/v1\n/);
    assert.match(text, /fake · reasoning none\s+1\/2\s+1\/2\s+2\.5\/5\s+7\s+/);
    assert.match(text, /fake · reasoning default\s+1\/2\s+1\/2/);
    assert.match(
      text,
      /expected: the webhook was refused \(503\) \(required\); the payment queue was full \(required\);/,
    );
    assert.match(text, /fake · reasoning none did not conclude: answered/);
  } finally {
    await server.close();
  }
});

test("eval: a limit or a refusal is counted, what was never named is listed, and a missing scenario says so", async () => {
  const server = await fakeChat(Array.from({ length: 3 }, () => call("listPlaybooks", {})));
  try {
    const toolbox = await openToolbox(workspace);
    toolbox.model = {
      baseUrl: server.url,
      model: "fake",
      maxSteps: 1,
      temperature: 0,
      contextTokens: 16000,
      timeoutMs: 5000,
      retries: 2,
      retryDelayMs: 1,
      headers: {},
    };
    const report = await runEval(toolbox, workspace, { runs: 1, models: ["fake"], reasoning: ["default"] }, {});
    assert.equal(report.settings[0]!.runs[0]!.status, "limit");
    const text = formatReport(report);
    assert.match(text, /never named: the webhook was refused \(503\); the payment queue was full;/);
    assert.match(text, /did not conclude: the step cap \(1 rounds/);
    await assert.rejects(
      runEval(toolbox, workspace, { scenario: "nope", runs: 1, models: ["fake"], reasoning: ["default"] }, {}),
      /No scenario "nope".*known: stuck-order/,
    );
  } finally {
    await server.close();
  }
});

test("eval: a server that is not there on the first run stops the eval; a later failure is a result", async () => {
  const toolbox = await openToolbox(workspace);
  await assert.rejects(
    runEval(
      toolbox,
      workspace,
      { runs: 2, models: ["m"], reasoning: ["default"], baseUrl: "http://127.0.0.1:9/v1" },
      {},
    ),
    /Cannot reach the model/,
  );
  const server = await fakeChat([{ content: "fine" }, { status: 500, body: { error: "boom" } }]);
  try {
    const report = await runEval(
      toolbox,
      workspace,
      { runs: 2, models: ["m"], reasoning: ["default"], baseUrl: server.url },
      {},
    );
    assert.deepEqual(
      report.settings[0]!.runs.map((r) => r.status),
      ["answered", "error"],
    );
    assert.match(report.settings[0]!.runs[1]!.note!, /answered 500/);
  } finally {
    await server.close();
  }
});

test("eval: privacy.modelHosts applies before any request", async () => {
  const toolbox = await openToolbox(workspace);
  toolbox.privacy = { modelHosts: ["llm.company.internal"], data: {}, strict: false };
  await assert.rejects(
    runEval(
      toolbox,
      workspace,
      { runs: 1, models: ["m"], reasoning: ["default"], baseUrl: "http://127.0.0.1:9/v1" },
      {},
    ),
    /privacy.modelHosts allows only llm.company.internal/,
  );
});

test("the command: ops eval prints the table, --json the numbers, and it needs a model", async () => {
  const server = await fakeChat([...good(), ...good()]);
  const run = (args: string[]) =>
    new Promise<{ code: number | null; stdout: string; stderr: string }>((done) => {
      const child = spawn("node", ["src/cli.ts", "eval", "--workspace", workspace, ...args], {
        env: { PATH: process.env.PATH!, HOME: process.env.HOME! },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", (code) => done({ code, stdout, stderr }));
    });
  try {
    const table = await run(["--runs", "1", "--model", "fake", "--base-url", server.url]);
    assert.equal(table.code, 0, table.stderr);
    assert.match(table.stdout, /ops eval: stuck-order · 1 run\(s\) per setting/);
    assert.match(table.stdout, /fake · reasoning default\s+1\/1\s+1\/1\s+5\.0\/5/);
    assert.match(table.stderr, /fake · reasoning default · run 1\/1/);
    const json = await run(["--runs", "1", "--model", "fake", "--base-url", server.url, "--json"]);
    const report = JSON.parse(json.stdout) as { settings: { runs: { status: string }[] }[] };
    assert.equal(report.settings[0]!.runs[0]!.status, "concluded");
    const none = await run([]);
    assert.equal(none.code, 1);
    assert.match(none.stderr, /ops eval needs a model/);
  } finally {
    await server.close();
  }
});
