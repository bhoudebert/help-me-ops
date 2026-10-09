// `ops demo`: the scenario of the demo workspace replayed through the real
// tools in the terminal, with no model. It fails when the check refuses.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { runDemo } from "../src/demo.ts";
import { openToolbox } from "../src/toolbox.ts";

const demo = resolve("examples/my-workspace");
const play = async (workspace: string, options = {}) => {
  const lines: string[] = [];
  const result = await runDemo(await openToolbox(workspace), workspace, { pace: 0, ...options }, (line) =>
    lines.push(line),
  );
  return { ...result, text: lines.join("\n") };
};
const copy = () => {
  const dir = mkdtempSync(join(tmpdir(), "ops-demo-run-"));
  cpSync(demo, dir, { recursive: true, filter: (src) => !/node_modules|\.demo-repo/.test(src) });
  return dir;
};

test("demo run: every step of the scenario through the real tools, then the checked conclusion", async () => {
  const { ok, text } = await play(demo);
  assert.equal(ok, true, text);
  assert.match(text, /^help-me-ops demo: stuck-order\n/);
  assert.match(text, /You {2}Client u-881 paid but cannot find order 4512/);
  assert.match(text, /1\. Which app and environment\?\n\s+scope .*\n\s+shop \/ prod: /);
  assert.match(text, /order-stuck: Order stuck or missing \(best match\)/);
  assert.match(text, /2026-10-07T09:58:13Z order +order 4512 of u-881: awaiting_payment/);
  assert.match(
    text,
    /app-logs +ERROR payments +webhook endpoint \/hooks\/acme-pay returned 503/,
    "a log line does not repeat its time",
  );
  assert.match(text, /\(and \d+ more\)/);
  assert.match(text, /12\. Is staging, same release, fine\?/);
  assert.match(text, /Conclusion, checked\n\n\s+## Conclusion: likely \(shop \/ prod\)/);
  assert.match(text, /\*\*Still unknown\*\*/);
  assert.match(text, /ok: all 7 quotes were returned by the tools above/);
});

test("demo run: a conclusion that quotes what no tool returned is refused, and says so", async () => {
  const dir = copy();
  const file = join(dir, "scenarios/stuck-order.json");
  const scenario = JSON.parse(readFileSync(file, "utf8"));
  scenario.conclusion.evidence[1].quote = "the database was down for ten minutes";
  writeFileSync(file, JSON.stringify(scenario));
  const { ok, text } = await play(dir);
  assert.equal(ok, false);
  assert.match(text, /REFUSED: 1 problem\(s\)/);
  assert.match(
    text,
    /quote not found in anything a tool returned this session: "the database was down for ten minutes"/,
  );
  assert.doesNotMatch(text, /ok: all/);
});

test("demo run: the mask applies, and a workspace without scenarios or an unknown scenario says what to do", async () => {
  const dir = copy();
  const config = JSON.parse(readFileSync(join(dir, "ops.config.json"), "utf8"));
  writeFileSync(join(dir, "ops.config.json"), JSON.stringify({ ...config, privacy: { mask: { fields: ["user"] } } }));
  const masked = await play(dir);
  assert.match(masked.text, /order 4512 of \*\*\*: awaiting_payment/);
  assert.match(masked.text, /value\(s\) hidden by the mask/);
  assert.equal(masked.ok, false, "the scenario quotes the unmasked line: the check refuses it, as it should");

  const none = copy();
  rmSync(join(none, "scenarios"), { recursive: true });
  await assert.rejects(
    play(none),
    /has no scenarios\/ folder to replay\. The demo workspace is examples\/my-workspace/,
  );
  await assert.rejects(
    play(demo, { scenario: "nope" }),
    /No scenario "nope".*Known: missing-emails, slow-checkout, stuck-order\./,
  );
});

test("demo run: the command needs no setup, exits 0 on success, and ignores OPS_WORKSPACE unless --workspace is given", () => {
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync("node", ["src/cli.ts", "demo", ...args], {
      encoding: "utf8",
      env: { PATH: process.env.PATH!, HOME: process.env.HOME!, ...env },
    });
  const ok = run([]);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /Conclusion, checked/);
  assert.ok(!ok.stdout.includes("\u001b"), "no colour when not a terminal");
  const other = run([], { OPS_WORKSPACE: mkdtempSync(join(tmpdir(), "ops-not-a-demo-")) });
  assert.equal(other.status, 0, "your own workspace in OPS_WORKSPACE does not break the demo");
  const missing = run(["--workspace", mkdtempSync(join(tmpdir(), "ops-empty-"))]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No ops.config.json/);
  const unknown = run(["--scenario", "nope"]);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /No scenario "nope"/);
});
