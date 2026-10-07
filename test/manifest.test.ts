import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadAddons } from "../src/addons/loader.ts";
import { toEvidence } from "../src/addons/manifest.ts";
import { openToolbox } from "../src/toolbox.ts";
import { createToolDefinitions } from "../src/tools/index.ts";

function write(root: string, path: string, content: string) {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
}

const MANIFEST = {
  apiVersion: 1,
  settings: {
    url: { type: "string", env: "TEST_SHOP_URL", description: "Base URL" },
    token: { type: "string", secret: true },
    retries: { type: "integer", default: 2 },
    verbose: { type: "boolean", default: false },
  },
  tools: {
    getOrder: {
      description: "One order",
      params: {
        id: { type: "string", description: "Order number" },
        kind: { type: "string", enum: ["paid", "unpaid"], optional: true },
        limit: "integer",
      },
    },
    ping: { description: "No params" },
  },
};

const TOOLS = `
export async function getOrder({ id, kind, limit }, { app, env, settings }) {
  if (id === "boom") throw new Error("call failed with token " + settings.token);
  return [{ at: "2026-10-07T10:00:00Z", id, kind, limit, summary: "order " + id + " in " + app + "/" + env + " via " + settings.url, retries: settings.retries, verbose: settings.verbose }];
}
export const ping = async () => "pong";
`;

function addon(overrides: { manifest?: unknown; tools?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ops-manifest-"));
  write(root, "shop/addon.json", JSON.stringify(overrides.manifest ?? MANIFEST));
  write(root, "shop/tools.ts", overrides.tools ?? TOOLS);
  return root;
}

async function skippedWhy(root: string) {
  const { report } = await loadAddons([{ dir: root, origin: "workspace" }]);
  return report.find((r) => r.name === "shop")!;
}

test("evidence: records, one record, text, nothing; time and summary found or derived", () => {
  const [a] = toEvidence("order", [{ at: "2026-10-07T10:00:00Z", id: 1, summary: "order 1 ok" }]);
  assert.deepEqual(a, {
    source: "order",
    at: "2026-10-07T10:00:00Z",
    summary: "order 1 ok",
    data: { at: "2026-10-07T10:00:00Z", id: 1, summary: "order 1 ok" },
  });
  const [derived] = toEvidence("x", { timestamp: "2026-10-07T10:00:00Z", status: "stuck", n: 3, nested: { a: 1 } });
  assert.equal(derived!.at, "2026-10-07T10:00:00Z");
  assert.equal(derived!.summary, "timestamp=2026-10-07T10:00:00Z status=stuck n=3");
  assert.equal(toEvidence("x", { at: "not a date", a: 1 })[0]!.at, null);
  assert.deepEqual(toEvidence("x", "all good"), [{ source: "x", at: null, summary: "all good", data: "all good" }]);
  assert.deepEqual(toEvidence("x", undefined), []);
  assert.deepEqual(toEvidence("x", null), []);
  assert.deepEqual(toEvidence("x", []), []);
  assert.equal(toEvidence("x", 42)[0]!.summary, "42");
  const safe = toEvidence("x", { big: 10n, when: new Date("2026-10-07T10:00:00Z") })[0]!;
  assert.deepEqual(safe.data, { big: "10", when: "2026-10-07T10:00:00.000Z" });
  assert.equal(toEvidence("x", { text: "y".repeat(500) })[0]!.summary.length, 240);
});

test("evidence: a long result is capped, and the cap is said", () => {
  const many = Array.from({ length: 130 }, (_, i) => ({ i }));
  const shown = toEvidence("x", many);
  assert.equal(shown.length, 101);
  assert.equal(shown[100]!.summary, "30 more results not shown: narrow the query");
});

test("manifest: a manifest and plain functions become read-only tools, params checked", async () => {
  const root = addon();
  const ws = mkdtempSync(join(tmpdir(), "ops-ws-"));
  write(
    ws,
    "ops.config.json",
    JSON.stringify({
      apps: { shop: { envs: { prod: { addons: { shop: { url: "http://shop", token: "s3cret" } } } } } },
    }),
  );
  write(ws, "addons/shop/addon.json", JSON.stringify(MANIFEST));
  write(ws, "addons/shop/tools.ts", TOOLS);
  void root;
  const tools = createToolDefinitions(await openToolbox(ws));
  const get = tools.find((t) => t.name === "shop.getOrder")!;
  const ping = tools.find((t) => t.name === "shop.ping")!;
  assert.deepEqual(Object.keys(get.inputSchema.shape).sort(), ["app", "env", "id", "kind", "limit"]);
  assert.deepEqual(get.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  });
  assert.deepEqual(ping.annotations, get.annotations);

  const result = JSON.parse(await get.run({ id: "7", limit: 3 }));
  assert.deepEqual([result.app, result.env, result.tool], ["shop", "prod", "shop.getOrder"]);
  assert.equal(result.evidence[0].summary, "order 7 in shop/prod via http://shop");
  assert.equal(result.evidence[0].source, "shop");
  assert.equal(result.evidence[0].data.retries, 2, "a default");
  assert.equal(result.evidence[0].data.verbose, false);
  assert.equal(JSON.parse(await ping.run({})).evidence[0].summary, "pong");

  await assert.rejects(get.run({ limit: 3 }), /id/);
  await assert.rejects(get.run({ id: "7", limit: 1.5 }), /limit/);
  await assert.rejects(get.run({ id: "7", limit: 1, kind: "refunded" }), /kind/);
  // A secret never reaches the person or the model, even inside an error.
  await assert.rejects(get.run({ id: "boom", limit: 1 }), (error: Error) => {
    assert.match(error.message, /call failed with token \*\*\*/);
    assert.doesNotMatch(error.message, /s3cret/);
    return true;
  });
});

test("manifest: a setting read from the environment arrives typed", async () => {
  process.env.TEST_SHOP_URL = "http://from-env";
  try {
    const ws = mkdtempSync(join(tmpdir(), "ops-ws-"));
    write(
      ws,
      "ops.config.json",
      JSON.stringify({
        apps: { shop: { envs: { prod: { addons: { shop: { token: "t", retries: "5", verbose: "true" } } } } } },
      }),
    );
    write(ws, "addons/shop/addon.json", JSON.stringify(MANIFEST));
    write(ws, "addons/shop/tools.ts", TOOLS);
    const get = createToolDefinitions(await openToolbox(ws)).find((t) => t.name === "shop.getOrder")!;
    const [evidence] = JSON.parse(await get.run({ id: "1", limit: 1 })).evidence;
    assert.match(evidence.summary, /via http:\/\/from-env/);
    assert.deepEqual([evidence.data.retries, evidence.data.verbose], [5, true]);
  } finally {
    delete process.env.TEST_SHOP_URL;
  }
});

test("manifest: each way to get it wrong is skipped with the reason", async () => {
  const both = addon();
  write(both, "shop/addon.ts", "export default { apiVersion: 1 };\n");
  assert.match((await skippedWhy(both)).reason!, /both addon.json and addon.ts/);

  const old = await skippedWhy(addon({ manifest: { ...MANIFEST, apiVersion: 7 } }));
  assert.match(old.reason!, /written for addon API 7, this version supports 1/);

  const noFunction = await skippedWhy(addon({ tools: "export async function getOrder() { return []; }\n" }));
  assert.match(noFunction.reason!, /tools.ts does not export ping, declared in addon.json/);

  const undeclared = await skippedWhy(
    addon({ tools: `${TOOLS}\nexport async function secretTool() { return []; }\n` }),
  );
  assert.match(undeclared.reason!, /tools.ts exports secretTool, which addon.json does not declare/);

  const badParam = await skippedWhy(
    addon({ manifest: { apiVersion: 1, tools: { t: { description: "d", params: { id: "uuid" } } } } }),
  );
  assert.match(badParam.reason!, /invalid addon.json/);

  const badName = await skippedWhy(addon({ manifest: { apiVersion: 1, tools: { "bad-name": { description: "d" } } } }));
  assert.match(badName.reason!, /letters, digits and underscores/);

  const noJson = addon();
  write(noJson, "shop/addon.json", "{ nope");
  assert.match((await skippedWhy(noJson)).reason!, /^addon.json:/);

  const missingPackage = await skippedWhy(
    addon({ tools: `import pg from "no-such-driver-installed";\nexport const getOrder = pg, ping = pg;\n` }),
  );
  assert.equal(missingPackage.status, "skipped");
  assert.match(missingPackage.reason!, /^tools.ts: .*no-such-driver-installed/);
});

test("manifest: an addon with no tools still loads, e.g. settings and playbooks only", async () => {
  const root = mkdtempSync(join(tmpdir(), "ops-manifest-"));
  write(root, "docs-only/addon.json", JSON.stringify({ apiVersion: 1, description: "Just notes" }));
  const { addons, report } = await loadAddons([{ dir: root, origin: "workspace" }]);
  assert.equal(report[0]!.status, "loaded");
  assert.equal(addons[0]!.definition?.tools?.length, 0);
});
