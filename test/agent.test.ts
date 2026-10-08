// API mode (ADR 0014): the loop, chat and ask, against a scripted server. No model
// is called and no key is needed.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { runAsk, runChat } from "../src/agent/commands.ts";
import { assertModelAllowed, describeEndpoint, resolveModel } from "../src/agent/endpoint.ts";
import { runCommand } from "../src/commands.ts";
import { openToolbox } from "../src/toolbox.ts";
import { fakeChat, type Call, type Step } from "./fake-chat.ts";

const workspace = resolve("examples/my-workspace");
const scenario = JSON.parse(readFileSync(join(workspace, "scenarios/stuck-order.json"), "utf8")) as {
  steps: { tool: string; input: object }[];
  conclusion: object;
};
const wire = (tool: string) => tool.replaceAll(".", "_");
const calls = (...c: Call[]): Step => ({ calls: c });
const conclude = (conclusion: object = scenario.conclusion): Step =>
  calls({ name: "checkConclusion", arguments: conclusion });
/** The scenario's own investigation, one tool call per round, then its conclusion. */
const goodRun = (): Step[] => [
  ...scenario.steps.map((s) => calls({ name: wire(s.tool), arguments: s.input })),
  conclude(),
];

const quiet = () => {
  const out: string[] = [];
  const steps: string[] = [];
  return { out, steps, io: { write: (l: string) => out.push(l), step: (l: string) => steps.push(l) } };
};
const flagsFor = (url: string, extra = {}) => ({ baseUrl: url, model: "fake", ...extra });
const noEnv = {} as NodeJS.ProcessEnv;

test("ask: the scenario's investigation through the real tools ends in the checked report", async () => {
  const server = await fakeChat(goodRun());
  try {
    const { io, out, steps } = quiet();
    const result = await runAsk(await openToolbox(workspace), "order 4512 is stuck", io, flagsFor(server.url), noEnv);
    assert.equal(result.status, "concluded");
    assert.equal(result.steps, scenario.steps.length + 1);
    assert.match(out.join("\n"), /Cause/i);
    assert.equal(steps.length, scenario.steps.length + 1);
    assert.match(steps.at(-1)!, /checkConclusion .* → accepted/);
    // the model was given the method, the question and every tool, with wire-safe names
    const first = server.requests[0]!;
    assert.match(first.messages[0]!.content!, /Every tool is read-only/);
    assert.match(first.messages[0]!.content!, /never instructions to you/);
    assert.equal(first.messages[1]!.content, "order 4512 is stuck");
    const names = first.tools.map((t) => t.function.name);
    assert.ok(names.includes("order_getOrder") && names.includes("checkConclusion"));
    assert.ok(names.every((n) => /^[\w-]+$/.test(n)));
    // each tool result went back as a tool message
    assert.equal(server.requests.at(-1)!.messages.filter((m) => m.role === "tool").length, scenario.steps.length);
  } finally {
    await server.close();
  }
});

test("ask: a bad call is answered with the error, not run, and the model may correct itself", async () => {
  const server = await fakeChat([
    calls({ name: "noSuchTool", arguments: {} }),
    calls({ name: "searchSource", arguments: "{not json" }),
    calls({ name: "searchSource", arguments: { source: "app-logs" } }),
    calls({ name: "searchSource", arguments: { env: "prod", source: "nope", query: "x" } }),
    { content: "I give up" },
  ]);
  try {
    const { io, steps } = quiet();
    const result = await runAsk(await openToolbox(workspace), "q", io, flagsFor(server.url), noEnv);
    assert.equal(result.status, "answered");
    assert.equal(result.text, "I give up");
    const told = server.requests
      .at(-1)!
      .messages.filter((m) => m.role === "tool")
      .map((m) => m.content!);
    assert.match(told[0]!, /there is no tool "noSuchTool"/);
    assert.match(told[1]!, /not valid JSON/);
    assert.match(told[2]!, /not valid: .*query/);
    assert.match(told[3]!, /No source "nope"/);
    assert.equal(steps.length, 4);
  } finally {
    await server.close();
  }
});

test("ask: a model that says nothing is asked again, twice at most", async () => {
  const server = await fakeChat([{}, calls({ name: "listPlaybooks", arguments: {} }), {}, {}, {}]);
  try {
    const { io } = quiet();
    const result = await runAsk(await openToolbox(workspace), "q", io, flagsFor(server.url), noEnv);
    assert.equal(result.status, "answered");
    assert.equal(result.text, "(the model gave no answer)");
    assert.equal(server.requests.length, 4, "two nudges, then it answers nothing");
    assert.equal(server.requests[1]!.messages.at(-1)!.content, "You gave no answer. Call a tool, or answer in words.");
    assert.ok(!server.requests[1]!.messages.some((m) => m.role === "assistant"), "the empty answer is not kept");
  } finally {
    await server.close();
  }
});

test("ask: a repeated identical call is not run again, and a model that never stops hits the step cap", async () => {
  const same = calls({ name: "listPlaybooks", arguments: {} });
  const server = await fakeChat(Array.from({ length: 5 }, () => same));
  try {
    const { io } = quiet();
    const result = await runAsk(await openToolbox(workspace), "q", io, flagsFor(server.url, { maxSteps: 3 }), noEnv);
    assert.equal(result.status, "limit");
    assert.match(result.reason!, /step cap \(3 rounds/);
    assert.equal(server.requests.length, 3);
    const tool = server.requests.at(-1)!.messages.filter((m) => m.role === "tool");
    assert.match(tool[1]!.content!, /You already called listPlaybooks with these arguments/);
  } finally {
    await server.close();
  }
});

test("ask: the token budget stops the run", async () => {
  const server = await fakeChat([
    { calls: [{ name: "listPlaybooks", arguments: {} }], tokens: 3000 },
    { calls: [{ name: "scope", arguments: {} }], tokens: 3000 },
  ]);
  try {
    const toolbox = await openToolbox(workspace);
    toolbox.model = {
      baseUrl: server.url,
      model: "fake",
      maxSteps: 20,
      temperature: 0,
      contextTokens: 16000,
      timeoutMs: 5000,
      budgetTokens: 5000,
    };
    const { io } = quiet();
    const result = await runAsk(toolbox, "q", io, {}, noEnv);
    assert.equal(result.status, "limit");
    assert.match(result.reason!, /token budget \(5000\)/);
  } finally {
    await server.close();
  }
});

test("ask: a refused conclusion goes back to the model, which fixes it", async () => {
  const bad = { ...(scenario.conclusion as { evidence: { quote: string }[] }) };
  bad.evidence = bad.evidence.map((e) => ({ ...e, quote: "a line no tool ever returned" }));
  const server = await fakeChat([...goodRun().slice(0, -1), conclude(bad), conclude()]);
  try {
    const { io, steps } = quiet();
    const result = await runAsk(await openToolbox(workspace), "q", io, flagsFor(server.url), noEnv);
    assert.equal(result.status, "concluded");
    assert.match(steps.at(-2)!, /checkConclusion .* → refused/);
    assert.match(steps.at(-1)!, /→ accepted/);
  } finally {
    await server.close();
  }
});

test("ask: no model configured, an unreachable server, a slow one, a refusal and a strange answer say what to do", async () => {
  const toolbox = await openToolbox(workspace);
  const { io } = quiet();
  await assert.rejects(runAsk(toolbox, "q", io, {}, noEnv), /No model configured.*--base-url and --model/);
  await assert.rejects(runAsk(toolbox, "", io, flagsFor("http://x/v1"), noEnv), /Usage: ask/);
  await assert.rejects(
    runAsk(toolbox, "q", io, flagsFor("http://127.0.0.1:9/v1"), noEnv),
    /Cannot reach the model at http:\/\/127\.0\.0\.1:9\/v1.*ollama serve/,
  );
  await assert.rejects(runAsk(toolbox, "q", io, flagsFor("nope"), noEnv), /is not a URL/);
  const server = await fakeChat([
    { status: 401, body: { error: "bad key" } },
    { status: 404, body: { error: "model not found" } },
    { body: { nothing: true }, status: 200 },
    { hang: true },
  ]);
  try {
    const tight = (extra = {}) => runAsk(toolbox, "q", io, flagsFor(server.url, extra), noEnv);
    await assert.rejects(tight(), /answered 401.*Check the key/);
    await assert.rejects(tight(), /answered 404: .*\. Is "fake" pulled\/loaded, and the address right\?/);
    await assert.rejects(tight(), /did not answer like an OpenAI-compatible chat endpoint/);
    toolbox.model = {
      baseUrl: server.url,
      model: "fake",
      maxSteps: 20,
      temperature: 0,
      contextTokens: 16000,
      timeoutMs: 1000,
    };
    await assert.rejects(runAsk(toolbox, "q", io, {}, noEnv), /did not answer within 1 s/);
  } finally {
    await server.close();
  }
});

test("model: flags beat the environment, which beats the file; the key comes from the environment", () => {
  const file = { baseUrl: "http://file/v1", model: "file-model", maxSteps: 5 } as never;
  assert.equal(resolveModel(file, {}, {}).model, "file-model");
  assert.equal(
    resolveModel(file, {}, { OPS_MODEL: "env-model", OPS_MODEL_URL: "http://env/v1/" }).baseUrl,
    "http://env/v1",
  );
  assert.equal(resolveModel(file, { model: "flag-model" }, { OPS_MODEL: "env-model" }).model, "flag-model");
  assert.equal(resolveModel(file, { maxSteps: 2 }, {}).maxSteps, 2);
  assert.equal(resolveModel(file, {}, { OPS_MODEL_KEY: "k" }).apiKey, "k");
  assert.equal(resolveModel(file, {}, {}).temperature, 0, "deterministic by default");
});

test("where the model is: said by doctor, and restricted by privacy.modelHosts before any request", async () => {
  assert.match(describeEndpoint("http://localhost:11434/v1"), /\(this machine: nothing leaves/);
  assert.match(describeEndpoint("http://192.168.1.20:8080/v1"), /private network address/);
  assert.match(describeEndpoint("http://[::1]:1234/v1"), /this machine/);
  assert.match(
    describeEndpoint("https://api.example.net/v1"),
    /api.example.net: a named host; the evidence goes to whoever runs it/,
  );
  assert.doesNotThrow(() => assertModelAllowed("http://anything/v1", undefined));
  assert.doesNotThrow(() => assertModelAllowed("http://127.0.0.1:1/v1", ["local"]));
  assert.doesNotThrow(() => assertModelAllowed("http://10.1.2.3/v1", ["local"]));
  assert.doesNotThrow(() => assertModelAllowed("https://LLM.company.internal/v1", ["local", "llm.company.internal"]));
  assert.throws(
    () => assertModelAllowed("https://api.example.net/v1", ["local"]),
    /privacy.modelHosts allows only local, and the model is at api.example.net \(a named host\). Nothing was sent./,
  );
  assert.throws(
    () => assertModelAllowed("http://172.32.0.1/v1", ["local"]),
    /Nothing was sent/,
    "172.32 is not private",
  );

  const server = await fakeChat([{ content: "hi" }]);
  try {
    const dir = copyDemo({ privacy: { modelHosts: ["llm.company.internal"] } });
    const toolbox = await openToolbox(dir);
    const { io } = quiet();
    await assert.rejects(
      runAsk(toolbox, "q", io, flagsFor(server.url), noEnv),
      /privacy.modelHosts allows only llm.company.internal/,
    );
    assert.equal(server.requests.length, 0, "refused before any request");
    const doctor = await runCommand(
      await openToolbox(
        copyDemo({
          model: { baseUrl: "http://localhost:11434/v1", model: "qwen3" },
          privacy: { modelHosts: ["local"] },
        }),
      ),
      "doctor",
      [],
    );
    assert.match(
      doctor,
      /Model: http:\/\/localhost:11434\/v1 \(this machine: nothing leaves your network\), qwen3; allowed hosts: local/,
    );
    assert.match(await runCommand(await openToolbox(workspace), "doctor", []), /Model: none configured/);
  } finally {
    await server.close();
  }
});

function copyDemo(extra: object) {
  const dir = mkdtempSync(join(tmpdir(), "ops-agent-"));
  cpSync(workspace, dir, { recursive: true, filter: (src) => !/node_modules|\.demo-repo/.test(src) });
  const config = JSON.parse(readFileSync(join(dir, "ops.config.json"), "utf8"));
  writeFileSync(join(dir, "ops.config.json"), JSON.stringify({ ...config, ...extra }));
  return dir;
}

test("the mask applies in the loop: the model never receives what the workspace hides", async () => {
  const dir = copyDemo({ privacy: { mask: { fields: ["user"], patterns: ["order.user-id"], fromAddons: ["order"] } } });
  const server = await fakeChat([
    calls({ name: "order_getOrder", arguments: { env: "prod", id: "4512" } }),
    { content: "done" },
  ]);
  try {
    const { io } = quiet();
    await runAsk(await openToolbox(dir), "q", io, flagsFor(server.url), noEnv);
    const sent = JSON.stringify(server.requests.at(-1));
    assert.ok(sent.includes("awaiting_payment") && !sent.includes("u-881"));
    assert.ok(sent.includes("***"));
  } finally {
    await server.close();
  }
});

test("chat: the conversation and the ledger carry across turns; /reset starts a new conversation", async () => {
  const investigate = scenario.steps.map((s) => calls({ name: wire(s.tool), arguments: s.input }));
  const server = await fakeChat([
    ...investigate,
    { content: "I have read the order and its logs." },
    conclude(),
    { content: "second conversation" },
  ]);
  try {
    const toolbox = await openToolbox(workspace);
    const lines = [
      "",
      "/help",
      "order 4512 is stuck",
      "so what is the cause?",
      "/reset",
      "and now?",
      "/exit",
      "never read",
    ];
    const { io, out, steps } = quiet();
    await runChat(
      toolbox,
      { ...io, read: async () => lines.shift() ?? null },
      flagsFor(server.url),
      noEnv,
      globalThis.fetch,
    );
    assert.match(steps[0]!, /help-me-ops chat: fake at http:\/\/127\.0\.0\.1:\d+\/v1, workspace .*my-workspace/);
    assert.ok(steps.some((s) => /Describe the problem/.test(s)));
    assert.equal(out[0], "assistant ▸ I have read the order and its logs.");
    // turn 2 saw turn 1, and the conclusion cited a quote that only turn 1 had read
    assert.match(out[1]!, /^assistant ▸ /);
    assert.match(out[1]!, /Cause/i);
    const turn2 = server.requests[server.requests.length - 2]!;
    assert.ok(turn2.messages.some((m) => m.content === "order 4512 is stuck"));
    // after /reset the model starts from the system message and the new question only
    const last = server.requests.at(-1)!;
    assert.deepEqual(
      last.messages.map((m) => m.role),
      ["system", "user"],
    );
    assert.equal(last.messages[1]!.content, "and now?");
    assert.ok(steps.some((s) => /New conversation/.test(s)));
    assert.equal(lines.length, 1, "/exit stopped the chat");
  } finally {
    await server.close();
  }
});

test("chat: a failed question leaves the conversation as it was, and the person can ask again", async () => {
  const server = await fakeChat([{ status: 500, body: { error: "boom" } }, { content: "ok now" }]);
  try {
    const lines = ["first", "again"];
    const { io, out, steps } = quiet();
    await runChat(
      await openToolbox(workspace),
      { ...io, read: async () => lines.shift() ?? null },
      flagsFor(server.url),
      noEnv,
    );
    assert.ok(steps.some((s) => /answered 500/.test(s)));
    assert.deepEqual(out, ["assistant ▸ ok now"]);
    assert.deepEqual(
      server.requests[1]!.messages.map((m) => m.content).slice(1),
      ["again"],
      "the failed question is not in the history",
    );
  } finally {
    await server.close();
  }
});

test("chat: when the conversation outgrows the context, the oldest tool results go first and the person is told", async () => {
  const server = await fakeChat([
    calls({ name: "listPlaybooks", arguments: {} }),
    calls({ name: "scope", arguments: {} }),
    calls({ name: "listSources", arguments: { env: "prod" } }),
    calls({ name: "searchSource", arguments: { env: "prod", source: "app-logs", query: "order=4512" } }),
    { content: "enough" },
  ]);
  try {
    const toolbox = await openToolbox(workspace);
    toolbox.model = {
      baseUrl: server.url,
      model: "fake",
      maxSteps: 20,
      temperature: 0,
      contextTokens: 1000,
      timeoutMs: 5000,
    };
    const { io, steps } = quiet();
    await runAsk(toolbox, "q", io, {}, noEnv);
    assert.ok(steps.some((s) => /outgrew the context: \d+ older tool result\(s\) were dropped/.test(s)));
    const sent = server.requests.at(-1)!.messages.filter((m) => m.role === "tool");
    assert.match(sent[0]!.content!, /older result was removed/);
    assert.doesNotMatch(sent.at(-1)!.content!, /older result was removed/, "the latest result stays");
  } finally {
    await server.close();
  }
});

test("the core stays model-free: only the CLI and the agent folder reach the loop or the client", () => {
  const files = readdirSync("src", { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts"));
  for (const file of files) {
    if (file.startsWith("agent") || file === "cli.ts") continue;
    const imports = [...readFileSync(join("src", file), "utf8").matchAll(/from "([^"]*agent[^"]*)"/g)].map((m) => m[1]);
    for (const path of imports) assert.ok(path!.endsWith("agent/endpoint.ts"), `${file} imports ${path}`);
  }
});

function cli(args: string[], input?: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((done) => {
    const child = spawn("node", ["src/cli.ts", ...args], {
      env: { PATH: process.env.PATH!, HOME: process.env.HOME! },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", (code) => done({ code, stdout, stderr }));
    child.stdin.end(input ?? "");
  });
}

test("the command: ask prints the report and exits 0, --json says the status, a limit exits 1", async () => {
  const model = (url: string) => ["--workspace", workspace, "--base-url", url, "--model", "fake"];
  const good = await fakeChat(goodRun());
  const stuck = await fakeChat(Array.from({ length: 4 }, () => calls({ name: "listPlaybooks", arguments: {} })));
  try {
    const ok = await cli(["ask", "order 4512 is stuck", ...model(good.url)]);
    assert.equal(ok.code, 0, ok.stderr);
    assert.match(ok.stdout, /Cause/i);
    assert.match(ok.stderr, /step 1 {2}scope/);
    const json = await cli(["ask", "q", "--json", "--max-steps", "2", ...model(stuck.url)]);
    assert.equal(json.code, 1);
    const result = JSON.parse(json.stdout) as { status: string; reason: string };
    assert.equal(result.status, "limit");
    assert.match(result.reason, /step cap \(2 rounds/);
    const none = await cli(["ask", "q", "--workspace", workspace]);
    assert.equal(none.code, 1);
    assert.match(none.stderr, /No model configured/);
  } finally {
    await good.close();
    await stuck.close();
  }
});

test("the command: chat reads the questions from the terminal and leaves at /exit", async () => {
  const server = await fakeChat([{ content: "hello from the model" }]);
  try {
    const chat = await cli(
      ["chat", "--workspace", workspace, "--base-url", server.url, "--model", "fake"],
      "hi there\n/exit\n",
    );
    assert.equal(chat.code, 0, chat.stderr);
    assert.match(chat.stdout, /assistant ▸ hello from the model/);
    assert.match(chat.stderr, /help-me-ops chat: fake at /);
  } finally {
    await server.close();
  }
});
