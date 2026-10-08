import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadAddons } from "../src/addons/loader.ts";
import { Manifest } from "../src/addons/manifest.ts";
import { initAddon, TEMPLATES } from "../src/init.ts";
import { openToolbox } from "../src/toolbox.ts";
import { createToolDefinitions } from "../src/tools/index.ts";

function workspace(config: unknown = null) {
  const root = mkdtempSync(join(tmpdir(), "ops-init-"));
  if (config) writeFileSync(join(root, "ops.config.json"), JSON.stringify(config));
  return root;
}

const config = (addons: Record<string, unknown>) => ({
  apps: { shop: { envs: { prod: { sources: [], addons } } } },
});

test("init: every template writes a valid manifest and no placeholder is left", async () => {
  for (const template of TEMPLATES) {
    const root = workspace();
    const message = await initAddon(root, ["addon", "my-db", "--template", template]);
    const dir = join(root, "addons", "my-db");
    assert.match(message, /doctor/);
    for (const file of ["addon.json", "tools.ts"]) {
      assert.doesNotMatch(readFileSync(join(dir, file), "utf8"), /__NAME__|__ENV__/, `${template}/${file}`);
    }
    assert.equal(existsSync(join(dir, "tools.ts.tpl")), false);
    const manifest = Manifest.parse(JSON.parse(readFileSync(join(dir, "addon.json"), "utf8")));
    assert.match(readFileSync(join(dir, "addon.json"), "utf8"), /MY_DB_/);
    assert.ok(Object.keys(manifest.tools ?? {}).length > 0);
  }
});

test("init: the file template loads and searches a file", async () => {
  const root = workspace(config({ notes: { path: "notes.log" } }));
  writeFileSync(join(root, "notes.log"), "2026-10-07T10:00:00Z order 4512 stuck\n2026-10-07T10:05:00Z all fine\n");
  await initAddon(root, ["addon", "notes", "--template", "file"]);
  const toolbox = await openToolbox(root);
  const tool = createToolDefinitions(toolbox).find((t) => t.name === "notes.search")!;
  const answer = JSON.parse(await tool.run({ term: "4512" })) as { evidence: { at: string; summary: string }[] };
  assert.equal(answer.evidence.length, 1);
  assert.equal(answer.evidence[0]!.at, "2026-10-07T10:00:00Z");
  assert.match(answer.evidence[0]!.summary, /order 4512 stuck/);
});

test("init: the api template only GETs, with the token, and fails with the status", async () => {
  const root = workspace(config({ billing: { url: "https://api.test", token: "s3cret" } }));
  await initAddon(root, ["addon", "billing", "--template", "api"]);
  const calls: { url: string; method?: string; authorization?: string }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method, authorization: (init?.headers as Record<string, string>).authorization });
    return url.endsWith("/items/404")
      ? new Response("no", { status: 404 })
      : Response.json({ id: "7", updated_at: "2026-10-07T10:00:00Z", state: "open" });
  }) as typeof fetch;
  try {
    const toolbox = await openToolbox(root);
    const tool = createToolDefinitions(toolbox).find((t) => t.name === "billing.getItem")!;
    const answer = JSON.parse(await tool.run({ id: "7" })) as { evidence: { summary: string }[] };
    assert.match(answer.evidence[0]!.summary, /item 7/);
    assert.deepEqual(calls, [{ url: "https://api.test/items/7", method: "GET", authorization: "Bearer s3cret" }]);
    await assert.rejects(tool.run({ id: "404" }), (error: Error) => /answered 404/.test(error.message));
  } finally {
    globalThis.fetch = real;
  }
});

test("init: the sql template is read-only and says it needs its driver", async () => {
  const root = workspace();
  await initAddon(root, ["addon", "orders-db", "--template", "sql"]);
  const code = readFileSync(join(root, "addons/orders-db/tools.ts"), "utf8");
  assert.match(code, /BEGIN READ ONLY/);
  assert.match(code, /\$1/);
  assert.doesNotMatch(code, /\b(INSERT|UPDATE|DELETE|DROP)\b/);
  const { report } = await loadAddons([{ dir: join(root, "addons"), origin: "workspace" }]);
  // Without `pg` next to it the addon is skipped, with the reason (or loaded if the machine has pg).
  assert.ok(report[0]!.status === "loaded" || /pg/.test(report[0]!.reason ?? ""));
});

test("init: refuses to overwrite, bad names, unknown templates and missing arguments", async () => {
  const root = workspace();
  await initAddon(root, ["addon", "notes", "--template", "file"]);
  const before = readFileSync(join(root, "addons/notes/tools.ts"), "utf8");
  writeFileSync(join(root, "addons/notes/tools.ts"), "// mine");
  await assert.rejects(initAddon(root, ["addon", "notes", "--template", "api"]), /already exists: nothing was written/);
  assert.equal(readFileSync(join(root, "addons/notes/tools.ts"), "utf8"), "// mine");
  assert.notEqual(before, "// mine");
  await assert.rejects(initAddon(root, ["addon", "Bad_Name", "--template", "file"]), /is not a name/);
  await assert.rejects(initAddon(root, ["addon", "x", "--template", "graphql"]), /must be one of file, api, sql/);
  await assert.rejects(initAddon(root, ["addon", "x"]), /must be one of/);
  await assert.rejects(initAddon(root, ["addon"]), /Usage: npm run ops -- init addon/);
  await assert.rejects(initAddon(root, ["workspace", "x"]), /Usage/);
});
