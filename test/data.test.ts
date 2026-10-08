// Declaring which sources can hold personal data, and the strict mode that
// serves only the ones declared free of it. Off by default (ADR 0012).
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { runCommand } from "../src/commands.ts";
import { createDataPolicy } from "../src/data.ts";
import { PrivacyConfig } from "../src/privacy.ts";
import { openToolbox } from "../src/toolbox.ts";
import { createToolDefinitions } from "../src/tools/index.ts";

function demo(privacy: object) {
  const dir = mkdtempSync(join(tmpdir(), "ops-data-"));
  cpSync(resolve("examples/my-workspace"), dir, {
    recursive: true,
    filter: (src) => !/node_modules|\.demo-repo/.test(src),
  });
  const config = JSON.parse(readFileSync(join(dir, "ops.config.json"), "utf8"));
  writeFileSync(join(dir, "ops.config.json"), JSON.stringify({ ...config, privacy }));
  return dir;
}
const run = async (dir: string, name: string, input: object) =>
  createToolDefinitions(await openToolbox(dir))
    .find((t) => t.name === name)!
    .run(input);

test("policy: the workspace wins over the addon, undeclared is unknown, and strict serves only none", () => {
  const config = PrivacyConfig.parse({ strict: true, data: { logs: "none" } });
  const policy = createDataPolicy(config, { logs: "possible", order: "possible", health: "none" }, [
    "logs",
    "order",
    "health",
    "other",
  ]);
  assert.equal(policy.declared("logs"), "none");
  assert.equal(policy.declared("order"), "possible");
  assert.equal(policy.declared("other"), "unknown");
  assert.deepEqual(["logs", "health", "order", "other"].map(policy.allowed), [true, true, false, false]);
  assert.throws(() => policy.require("order"), /Strict mode: "order" is not declared free .*declared: possible/);
  assert.throws(() => policy.require("other"), /undeclared.*"privacy": \{ "data": \{ "other": "none" \} \}/);
  const loose = createDataPolicy(PrivacyConfig.parse({}), {}, ["logs"]);
  assert.equal(loose.strict, false);
  assert.equal(loose.allowed("logs"), true, "off by default: everything is served");
  assert.throws(
    () => createDataPolicy(PrivacyConfig.parse({ data: { nope: "none" } }), {}, ["logs"]),
    /privacy\.data: "nope" is not a source, an addon or "knowledge" of this workspace \(known: logs, knowledge\)/,
  );
});

test("config: privacy needs no mask, and a declaration is none or possible", () => {
  assert.equal(PrivacyConfig.parse({ strict: true }).mask, undefined);
  assert.equal(PrivacyConfig.safeParse({ data: { a: "maybe" } }).success, false);
});

test("not strict (the default): everything is served, and listSources shows what is declared", async () => {
  const dir = demo({ data: { "app-logs": "possible" } });
  const out = JSON.parse(await run(dir, "listSources", { env: "prod" })) as {
    sources: { id: string; personalData?: string }[];
    withheld?: string[];
  };
  assert.equal(out.sources.find((s) => s.id === "app-logs")?.personalData, "possible");
  assert.equal(out.withheld, undefined);
  assert.match(await run(dir, "order.getOrder", { env: "prod", id: "4512" }), /awaiting_payment/);
  assert.match(await run(dir, "searchSource", { env: "prod", source: "app-logs", query: "OOMKilled" }), /consumers=0/);
});

test("strict: only what is declared none is served, the rest is refused with the way to declare it", async () => {
  const dir = demo({ strict: true, data: { "app-logs": "none" } });
  // declared by the workspace
  assert.match(await run(dir, "searchSource", { env: "prod", source: "app-logs", query: "OOMKilled" }), /consumers=0/);
  // declared by the addon itself
  assert.match(await run(dir, "metrics.listMetrics", { env: "prod" }), /./);
  // declared possible by the addon
  await assert.rejects(run(dir, "order.getOrder", { env: "prod", id: "4512" }), /Strict mode: "order" is not declared/);
  // not declared at all
  await assert.rejects(
    run(dir, "searchKnowledge", { query: "payment" }),
    /Strict mode: "knowledge" is not declared free of personal data \(undeclared\)/,
  );
  const listed = JSON.parse(await run(dir, "listSources", { env: "prod" })) as { sources: { id: string }[] };
  assert.deepEqual(
    listed.sources.map((s) => s.id),
    ["app-logs"],
  );
});

test("strict: the sources that are not declared are named as withheld, and a refusal is not recorded as evidence", async () => {
  const dir = demo({ strict: true });
  const listed = JSON.parse(await run(dir, "listSources", { env: "prod" })) as {
    sources: unknown[];
    withheld: string[];
  };
  assert.deepEqual(listed.sources, []);
  assert.deepEqual(listed.withheld, ["app-logs"]);
  await assert.rejects(run(dir, "searchSource", { env: "prod", source: "app-logs", query: "x" }), /Strict mode/);
});

test("doctor: shows the declarations and whether strict mode is on", async () => {
  const loose = await runCommand(await openToolbox(demo({ data: { "app-logs": "possible" } })), "doctor", []);
  assert.match(
    loose,
    /Data: not strict; free of personal data: .*health.*; may hold some: .*app-logs.*; undeclared: .*knowledge/,
  );
  const strict = await runCommand(await openToolbox(demo({ strict: true })), "doctor", []);
  assert.match(
    strict,
    /Data: strict, serves only what is declared free of personal data: .*health.*; withheld: possible .*order/,
  );
});

test("config: declaring something the workspace does not have is refused when it opens", async () => {
  await assert.rejects(openToolbox(demo({ data: { orders: "none" } })), /privacy\.data: "orders" is not a source/);
});
