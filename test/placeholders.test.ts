// Stable placeholders: a hidden value becomes user-3f2a instead of ***, the same
// everywhere in a session, and given back to a tool it stands for the value (ADR 0013).
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createMasker, PrivacyConfig } from "../src/privacy.ts";
import { openToolbox } from "../src/toolbox.ts";
import { createToolDefinitions } from "../src/tools/index.ts";

const masker = (mask: object) => createMasker(PrivacyConfig.parse({ mask }))!;
const answer = (...data: object[]) =>
  JSON.stringify({
    evidence: data.map((d) => ({ source: "db", at: null, summary: `row ${JSON.stringify(d)}`, data: d })),
  });
const dataOf = (text: string) => (JSON.parse(text) as { evidence: { data: any; summary: string }[] }).evidence;

test("placeholders: the same value is the same placeholder, a different one is not, and the label is the key", () => {
  const m = masker({ fields: ["email", "customer"], placeholders: true });
  const a = dataOf(
    m.answer(answer({ email: "jane@example.com", customer: "CUST-1" }, { email: "jane@example.com" })).text,
  );
  assert.match(a[0]!.data.email, /^email-[0-9a-f]{4}$/);
  assert.equal(a[1]!.data.email, a[0]!.data.email, "stable across records");
  assert.match(a[0]!.data.customer, /^customer-[0-9a-f]{4}$/);
  const b = dataOf(m.answer(answer({ email: "joe@example.com" })).text);
  assert.notEqual(b[0]!.data.email, a[0]!.data.email);
  assert.doesNotMatch(JSON.stringify([a, b]), /jane@|joe@/, "the value is hidden in the summary too");
  assert.equal(m.stable, true);
  assert.match(m.describe(), /as stable placeholders \(like user-3f2a\)/);
});

test("placeholders: off by default, and then the stars are what they were", () => {
  const m = masker({ fields: ["email"] });
  assert.equal(m.stable, false);
  assert.equal(dataOf(m.answer(answer({ email: "jane@example.com" })).text)[0]!.data.email, "***");
  assert.equal(m.restore({ q: "x" }).q, "x");
});

test("placeholders: not computable from a guess, and not the same in another session", () => {
  const one = dataOf(
    masker({ fields: ["email"], placeholders: true }).answer(answer({ email: "jane@example.com" })).text,
  );
  const two = dataOf(
    masker({ fields: ["email"], placeholders: true }).answer(answer({ email: "jane@example.com" })).text,
  );
  assert.notEqual(one[0]!.data.email, two[0]!.data.email);
});

test("placeholders: patterns use them too, and restore gives the values back in an input", () => {
  const m = masker({ patterns: ["email"], placeholders: true });
  const out = JSON.parse(m.answer(answer({ note: "mail jane@example.com twice: jane@example.com" })).text);
  const placeholder = /email-[0-9a-f]{4}/.exec(out.evidence[0].data.note)![0];
  assert.equal(out.evidence[0].data.note, `mail ${placeholder} twice: ${placeholder}`);
  assert.deepEqual(m.restore({ query: placeholder, nested: [`x ${placeholder}`], n: 3 }), {
    query: "jane@example.com",
    nested: ["x jane@example.com"],
    n: 3,
  });
  assert.equal(m.hideKnown("no such user jane@example.com"), `no such user ${placeholder}`);
  assert.equal(m.restore({ query: "email-0000" }).query, "email-0000", "only what was handed out is restored");
});

function demo(mask: object) {
  const dir = mkdtempSync(join(tmpdir(), "ops-ph-"));
  cpSync(resolve("examples/my-workspace"), dir, {
    recursive: true,
    filter: (src) => !/node_modules|\.demo-repo/.test(src),
  });
  const config = JSON.parse(readFileSync(join(dir, "ops.config.json"), "utf8"));
  writeFileSync(join(dir, "ops.config.json"), JSON.stringify({ ...config, privacy: { mask } }));
  return dir;
}

test("in the demo: the user is one placeholder in the order and in the logs, and following it finds the log lines", async () => {
  const tools = createToolDefinitions(
    await openToolbox(demo({ fromAddons: ["order"], patterns: ["order.user-id"], placeholders: true })),
  );
  const run = (name: string, input: object) => tools.find((t) => t.name === name)!.run(input);
  const order = await run("order.getOrder", { env: "prod", id: "4512" });
  const placeholder = /user-[0-9a-f]{4,}/.exec(order)![0];
  assert.ok(!order.includes("u-881"));
  // the assistant follows the user into the logs by the placeholder
  const logs = await run("searchSource", { env: "prod", source: "app-logs", query: placeholder });
  assert.match(logs, /"evidence": \[\s*\{/, "the real value was searched");
  assert.ok(logs.includes(placeholder) && !logs.includes("u-881"));
  // an error that echoes the input does not give the value away
  await assert.rejects(
    run("searchSource", { env: "prod", source: "u-881", query: "x" }),
    (error: Error) => error.message.includes(placeholder) && !error.message.includes("u-881"),
  );
});
