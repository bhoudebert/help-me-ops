import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { addonFolders, formatReport, loadAddons, resolveAddonDirs } from "../src/addons/loader.ts";
import { resolveSettings } from "../src/addons/runtime.ts";
import { runCommand, startupNotices } from "../src/commands.ts";
import { openToolbox } from "../src/toolbox.ts";
import { createToolDefinitions } from "../src/tools/index.ts";

const HINTS = "{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }";

const ORDER = `export default ({ z }) => ({
  apiVersion: 1,
  settings: z.object({ dbUrl: z.string(), tenant: z.string().default("eu") }),
  env: { dbUrl: "TEST_ORDER_DB_URL" },
  tools: [{
    name: "getOrder",
    description: "One order",
    inputSchema: z.object({ id: z.string() }),
    annotations: ${HINTS},
    run: async ({ id }, { app, env, settings }) => [
      { source: "order", at: null, summary: "order " + id + " in " + app + "/" + env + " via " + settings.dbUrl + " tenant " + settings.tenant, data: settings },
    ],
  }],
});
`;

function write(root: string, path: string, content: string) {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
}

/** A folder of addons: one good, and one of each way to fail. */
function addonsFolder() {
  const root = mkdtempSync(join(tmpdir(), "ops-addons-"));
  write(root, "order/addon.ts", ORDER);
  write(root, "_off/addon.ts", ORDER);
  write(root, "old/addon.ts", "export default { apiVersion: 2 };\n");
  write(
    root,
    "loud/addon.ts",
    `export default ({ z }) => ({ apiVersion: 1, tools: [{ name: "wipe", description: "d", inputSchema: z.object({}), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }, run: async () => [] }] });\n`,
  );
  write(root, "broken/addon.ts", "export default {{{\n");
  write(root, "nodefault/addon.ts", "export const x = 1;\n");
  write(root, "BadName/addon.ts", ORDER);
  write(
    root,
    "notes/playbooks/slow.md",
    "---\nname: Slow checkout\nwhen: checkout is slow\n---\n1. Look at the logs.\n",
  );
  mkdirSync(join(root, "empty"));
  return root;
}

test("addons: dropped-in folders load; each failure is skipped with its reason", async () => {
  const root = addonsFolder();
  const { addons, report } = await loadAddons([{ dir: root, origin: "workspace" }]);
  const status = Object.fromEntries(report.map((r) => [r.name, r.status]));
  assert.deepEqual(status, {
    BadName: "skipped",
    broken: "skipped",
    loud: "skipped",
    nodefault: "skipped",
    notes: "loaded",
    old: "skipped",
    order: "loaded",
  });
  const why = (name: string) => report.find((r) => r.name === name)?.reason ?? "";
  assert.match(why("old"), /written for addon API 2, this version supports 1/);
  assert.match(why("loud"), /readOnlyHint/);
  assert.match(why("nodefault"), /no default export/);
  assert.match(why("BadName"), /lowercase letters/);
  assert.ok(why("broken"));
  assert.deepEqual(addons.map((a) => a.name).sort(), ["notes", "order"]);
  assert.equal(addons.find((a) => a.name === "notes")!.definition, null);
  assert.match(formatReport(report).join("\n"), /old\s+skipped\s+\(workspace\).*written for addon API 2/);
});

test("addons: the later folder wins a name clash, and both are named", async () => {
  const first = mkdtempSync(join(tmpdir(), "ops-first-"));
  const second = mkdtempSync(join(tmpdir(), "ops-second-"));
  write(first, "order/addon.ts", ORDER);
  write(second, "order/addon.ts", ORDER);
  const { addons, report } = await loadAddons([
    { dir: first, origin: "built-in" },
    { dir: second, origin: "workspace" },
    { dir: "/nowhere/addons", origin: "extra" },
  ]);
  assert.equal(addons.length, 1);
  assert.equal(addons[0]!.origin, "workspace");
  assert.deepEqual(
    report.map((r) => [r.status, r.reason]),
    [
      ["replaced", `replaced by ${join(second, "order")}`],
      ["loaded", `replaces ${join(first, "order")}`],
    ],
  );
});

test("addons: folders come from --addons and OPS_ADDONS, built-ins first, workspace last", () => {
  assert.deepEqual(resolveAddonDirs(["x", "--addons", "/a:/b"], { OPS_ADDONS: "/c" }), ["/a", "/b", "/c"]);
  assert.deepEqual(resolveAddonDirs([], {}), []);
  assert.throws(() => resolveAddonDirs(["--addons"], {}), /--addons needs a folder/);
  assert.deepEqual(
    addonFolders("/w", ["/a"]).map((f) => [f.origin, f.dir.endsWith("/addons")]),
    [
      ["built-in", true],
      ["extra", false],
      ["workspace", true],
    ],
  );
});

test("addons: settings come from the environment, the configuration overrides, ${VAR} names a variable", async () => {
  const { addons } = await loadAddons([{ dir: addonsFolder(), origin: "workspace" }]);
  const order = addons.find((a) => a.name === "order")!;
  assert.deepEqual(resolveSettings(order, undefined, { TEST_ORDER_DB_URL: "pg://env" }), {
    dbUrl: "pg://env",
    tenant: "eu",
  });
  assert.deepEqual(resolveSettings(order, { dbUrl: "pg://file", tenant: "us" }, { TEST_ORDER_DB_URL: "pg://env" }), {
    dbUrl: "pg://file",
    tenant: "us",
  });
  assert.equal(resolveSettings(order, { dbUrl: "${SECRET_URL}/shop" }, { SECRET_URL: "pg://h" }).dbUrl, "pg://h/shop");
  assert.throws(
    () => resolveSettings(order, { dbUrl: "${SECRET_URL}" }, {}),
    /environment variable SECRET_URL is not set/,
  );
  assert.throws(() => resolveSettings(order, undefined, {}), /invalid settings: .*dbUrl/);
  assert.deepEqual(resolveSettings({ ...order, definition: null }, { a: 1 }, {}), {});
});

/** A workspace with shop in prod and staging; the order addon is set up in prod, and wrongly in staging. */
function workspaceWithAddons() {
  const ws = mkdtempSync(join(tmpdir(), "ops-ws-"));
  const logs = { id: "logs", type: "file-logs", path: "app.log", description: "Logs" };
  writeFileSync(join(ws, "app.log"), "2026-10-07T10:00:00Z order=1 ok\n");
  write(
    ws,
    "ops.config.json",
    JSON.stringify({
      apps: {
        shop: {
          description: "Shop",
          envs: {
            prod: {
              sources: [logs, { id: "db", type: "postgres", description: "Orders DB" }],
              addons: { order: { dbUrl: "pg://prod" } },
            },
            staging: { sources: [logs], addons: { order: {} } },
          },
        },
      },
    }),
  );
  write(ws, "addons/order/addon.ts", ORDER);
  write(ws, "addons/old/addon.ts", "export default { apiVersion: 9 };\n");
  write(ws, "addons/notes/playbooks/slow.md", "---\nname: Slow checkout\nwhen: checkout is slow\n---\n1. Look.\n");
  return ws;
}

test("addons: tools are namespaced, read one environment, and an unconfigured environment is refused", async () => {
  const toolbox = await openToolbox(workspaceWithAddons());
  const tools = createToolDefinitions(toolbox);
  assert.deepEqual(
    tools.map((t) => t.name),
    [
      "scope",
      "listSources",
      "searchSource",
      "listPlaybooks",
      "searchKnowledge",
      "getPlaybook",
      "order.getOrder",
      "checkConclusion",
    ],
  );
  const order = tools.find((t) => t.name === "order.getOrder")!;
  assert.equal(order.annotations.readOnlyHint, true);
  assert.ok("id" in order.inputSchema.shape && "app" in order.inputSchema.shape && "env" in order.inputSchema.shape);

  const prod = JSON.parse(await order.run({ id: "7", env: "prod" }));
  assert.deepEqual([prod.app, prod.env, prod.tool], ["shop", "prod", "order.getOrder"]);
  assert.equal(prod.evidence[0].summary, "order 7 in shop/prod via pg://prod tenant eu");
  await assert.rejects(
    order.run({ id: "7", env: "staging" }),
    /order.getOrder is unavailable in shop\/staging: invalid settings/,
  );
  await assert.rejects(order.run({ env: "prod" }), /id/);

  assert.deepEqual(
    (await createToolDefinitions(toolbox)[3]!.run({})).includes("notes/slow"),
    true,
    "a playbook of a written-only addon is served, namespaced by the addon",
  );
});

const notices0 = (toolbox: Parameters<typeof startupNotices>[0]) => startupNotices(toolbox).join("\n");

test("addons: doctor and the start-up notices say what was skipped, left out or unavailable", async () => {
  const toolbox = await openToolbox(workspaceWithAddons());
  const doctor = await runCommand(toolbox, "doctor", []);
  assert.match(doctor, /^Workspace: .+/);
  assert.match(notices0(toolbox), /help-me-ops workspace: .+/);
  assert.match(doctor, /logs\s+loaded\s+\(built-in\)/);
  assert.match(doctor, /old\s+skipped\s+\(workspace\).*addon API 9/);
  assert.match(doctor, /! unavailable in shop\/staging/);
  assert.match(doctor, /! shop\/prod: source db: no connector type "postgres"/);
  const notices = startupNotices(toolbox).join("\n");
  assert.match(notices, /old\s+skipped/);
  assert.doesNotMatch(notices, /logs\s+loaded/);
  assert.equal(
    await runCommand({ apps: [], playbooks: [] }, "doctor", []),
    "Workspace: unknown\nPrivacy: no masking: what the tools return goes to your AI provider\nModel: none configured (only ops chat, ask and eval need one; the MCP clients bring their own)\nAddons:\n  none",
  );
  // The sources that do load are untouched by the one that did not.
  const sources = JSON.parse(await runCommand(toolbox, "sources", ["--env", "prod"]));
  assert.deepEqual(
    sources.sources.map((s: { id: string }) => s.id),
    ["logs"],
  );
});
