// `ops addon check`: what it passes and what it catches, on scaffolded addons,
// on broken ones, and through the real command (the exit code).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { checkAddon, personalHints } from "../src/addons/check.ts";
import { initAddon, initWorkspace } from "../src/init.ts";

const temp = () => mkdtempSync(join(tmpdir(), "ops-check-"));

function addon(files: Record<string, string | object>, name = "billing") {
  const dir = join(temp(), name);
  mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    writeFileSync(join(dir, file), typeof content === "string" ? content : JSON.stringify(content));
  }
  return dir;
}

const MANIFEST = {
  apiVersion: 1,
  settings: { url: { type: "string", env: "BILLING_URL" }, token: { type: "string", secret: true } },
  tools: {
    getInvoice: {
      description: "One invoice: its status and amount, by number",
      params: { id: { type: "string", description: "The invoice number" } },
    },
  },
};
const TOOLS = `export async function getInvoice({ id }, { settings, fetch }) {
  const r = await fetch(settings.url + "/invoices/" + id, { method: "GET" });
  const body = await r.json();
  return [{ at: body.paid_at, summary: "invoice " + id + ": " + body.status }];
}
`;
const SAMPLE = {
  name: "an invoice",
  tool: "getInvoice",
  input: { id: "7" },
  settings: { url: "https://billing.test", token: "s3cret-token" },
  responses: { "GET https://billing.test/invoices/7": { body: { status: "paid", paid_at: "2026-10-07T10:00:00Z" } } },
  expect: { summaryIncludes: "paid", withTime: true },
};

const lines = (text: string, kind: string) => text.split("\n").filter((l) => l.startsWith(`  ${kind}`));

test("check: scaffolded file and api addons pass, with their samples", async () => {
  const root = temp();
  await initWorkspace(join(root, "ws"), ["workspace", join(root, "ws")]);
  for (const template of ["file", "api"]) {
    await initAddon(join(root, "ws"), ["addon", `my-${template}`, "--template", template]);
    const result = await checkAddon(join(root, "ws/addons", `my-${template}`), { workspace: join(root, "ws") });
    assert.equal(result.ok, true, result.text);
    assert.match(result.text, /sample "[^"]+": 1 record\(s\), 1 with a time/);
    assert.match(result.text, /All \d+ checks passed: this addon is ready/);
    assert.equal(lines(result.text, "FAIL").length, 0);
    assert.match(result.text, /note\s+no block for "my-\w+" in ops.config.json for .*idle there/);
  }
});

test("check: the sql template says which package is missing and how to install it", async () => {
  const root = temp();
  await initAddon(root, ["addon", "orders-db", "--template", "sql"]);
  const result = await checkAddon(join(root, "addons/orders-db"));
  assert.equal(result.ok, false);
  assert.match(result.text, /FAIL\s+tools.ts: .*Cannot find package 'pg'/);
  assert.match(result.text, /fix: install it next to the addon, in the workspace: cd <workspace> && npm install pg/);
});

test("check: the shipped addons and the demo's addons pass", async () => {
  for (const dir of [
    "addons/rest",
    "addons/datadog",
    "addons/github",
    "addons/git",
    "examples/my-workspace/addons/order",
    "examples/my-workspace/addons/metrics",
    "examples/my-workspace/addons/health",
  ]) {
    const result = await checkAddon(resolve(dir), { workspace: resolve("examples/my-workspace") });
    assert.equal(result.ok, true, `${dir}\n${result.text}`);
  }
});

test("check: a good hand-written addon with samples, and what it warns about", async () => {
  const dir = addon({ "addon.json": MANIFEST, "tools.ts": TOOLS, "check.json": [SAMPLE] });
  const result = await checkAddon(dir);
  assert.equal(result.ok, true, result.text);
  assert.match(result.text, /ok\s+tool billing.getInvoice\(id\): read-only/);
  assert.match(result.text, /ok\s+setting token, secret/);
  assert.match(result.text, /ok\s+setting url \(variable BILLING_URL\)/);
  assert.match(result.text, /sample "an invoice": 1 record\(s\), 1 with a time/);

  const thin = addon({
    "addon.json": { ...MANIFEST, tools: { getInvoice: { description: "Invoice", params: { id: "string" } } } },
    "tools.ts": TOOLS,
  });
  const warned = await checkAddon(thin);
  assert.equal(warned.ok, true);
  assert.match(warned.text, /warn\s+getInvoice: a one-word description/);
  assert.match(warned.text, /warn\s+getInvoice: parameter id has no description/);
  assert.match(warned.text, /note\s+no check.json/);
});

test("check: a folder that starts with _ is off for the server, which is normal: checked under its real name", async () => {
  const result = await checkAddon(
    addon({ "addon.json": MANIFEST, "tools.ts": TOOLS, "check.json": [SAMPLE] }, "_billing"),
  );
  assert.equal(result.ok, true, result.text);
  assert.match(result.text, /ok\s+name "billing"/);
  assert.match(
    result.text,
    /note\s+the folder is called "_billing": the server skips a folder starting with "_" \(it is off\), which is normal/,
  );
  assert.doesNotMatch(result.text, /FAIL/);
  const dotted = await checkAddon(addon({ "addon.json": MANIFEST, "tools.ts": TOOLS }, ".billing"));
  assert.match(dotted.text, /ok\s+name "billing"/);
  assert.match(
    (await checkAddon(addon({ "addon.json": MANIFEST, "tools.ts": TOOLS }, "_Bad_Name"))).text,
    /FAIL\s+the folder name "Bad_Name"/,
  );
});

test("check: a description given before optional or default counts, and the same note is not repeated per environment", async () => {
  const manifest = {
    ...MANIFEST,
    tools: {
      getInvoice: {
        description: "One invoice: its status and amount, by number",
        params: {
          id: { type: "string", description: "The invoice number" },
          since: { type: "string", optional: true, description: "From when" },
          limit: { type: "integer", default: 5, description: "How many" },
        },
      },
    },
  };
  const dir = addon({ "addon.json": manifest, "tools.ts": TOOLS });
  const ws = temp();
  const envs = Object.fromEntries(
    ["prod", "staging", "dev"].map((e) => [
      e,
      { sources: [], addons: e === "dev" ? {} : { billing: { url: "${BILLING_UNSET}", token: "t" } } },
    ]),
  );
  writeFileSync(join(ws, "ops.config.json"), JSON.stringify({ apps: { shop: { envs } } }));
  const result = await checkAddon(dir, { workspace: ws });
  assert.doesNotMatch(result.text, /has no description/);
  assert.equal([...result.text.matchAll(/BILLING_UNSET/g)].length, 1, "one line for both environments");
  assert.match(
    result.text,
    /note\s+shop\/prod, shop\/staging: environment variable BILLING_UNSET is not set, so it is idle there until it is/,
  );
  assert.match(result.text, /note\s+no block for "billing" in ops.config.json for shop\/dev: idle there/);
  assert.match(result.text, /All \d+ checks passed: this addon is ready/);
});

test("check: warnings are counted in the verdict", async () => {
  const thin = addon({
    "addon.json": { ...MANIFEST, tools: { getInvoice: { description: "Invoice", params: { id: "string" } } } },
    "tools.ts": TOOLS,
  });
  assert.match((await checkAddon(thin)).text, /checks passed \(2 warnings, worth a look\)/);
});

test("check: what is wrong with the files, each with the fix", async () => {
  const cases: [string, Record<string, string | object>, RegExp, RegExp?][] = [
    [
      "missing function",
      { "addon.json": MANIFEST, "tools.ts": "export const other = () => 1;" },
      /tools.ts does not export getInvoice/,
      /export a function of that name/,
    ],
    [
      "extra function",
      { "addon.json": MANIFEST, "tools.ts": `${TOOLS}\nexport const stray = () => 1;` },
      /exports stray, which addon.json does not declare/,
      /declare the tool/,
    ],
    [
      "both forms",
      { "addon.json": MANIFEST, "addon.ts": "export default {}" },
      /both addon.json and addon.ts/,
      /keep one/,
    ],
    ["neither", { "notes.txt": "hello" }, /no addon.json/, /init addon/],
    [
      "wrong version",
      { "addon.json": { ...MANIFEST, apiVersion: 9 }, "tools.ts": TOOLS },
      /addon API 9/,
      /"apiVersion": 1/,
    ],
    [
      "bad manifest",
      { "addon.json": { apiVersion: 1, tools: { "bad name": { description: "x" } } }, "tools.ts": "" },
      /a name is letters, digits and underscores/,
    ],
    ["not json", { "addon.json": "{ nope", "tools.ts": TOOLS }, /addon.json: /],
    ["syntax error", { "addon.json": MANIFEST, "tools.ts": "export function (" }, /tools.ts: /],
  ];
  for (const [label, files, expected, fix] of cases) {
    const result = await checkAddon(addon(files));
    assert.equal(result.ok, false, label);
    assert.match(result.text, expected, label);
    if (fix) assert.match(result.text, fix, label);
  }
  assert.match(
    (await checkAddon(addon({ "addon.json": MANIFEST, "tools.ts": TOOLS }, "Bad_Name"))).text,
    /folder name "Bad_Name" must be lowercase/,
  );
  const missing = await checkAddon(join(temp(), "nowhere"));
  assert.equal(missing.ok, false);
  assert.match(missing.text, /the folder does not exist/);
});

test("check: samples catch a wrong answer, a missing fixture, a leaked secret, a missing time, a bad file", async () => {
  const run = async (sample: Record<string, unknown> | null, tools = TOOLS, raw?: unknown) =>
    checkAddon(addon({ "addon.json": MANIFEST, "tools.ts": tools, "check.json": raw ?? [sample] }));
  assert.match(
    (await run({ ...SAMPLE, expect: { summaryIncludes: "refunded" } })).text,
    /no summary includes "refunded"/,
  );
  assert.match((await run({ ...SAMPLE, expect: { minRecords: 2 } })).text, /1 record\(s\), expected at least 2/);
  assert.match((await run({ ...SAMPLE, expect: { maxRecords: 0, minRecords: 0 } })).text, /expected at most 0/);
  assert.match(
    (await run({ ...SAMPLE, input: { id: "8" } })).text,
    /no recorded response for "GET https:\/\/billing.test\/invoices\/8" in check.json; it has: GET https:\/\/billing.test\/invoices\/7/,
  );
  assert.match((await run({ ...SAMPLE, input: {} })).text, /sample "an invoice": /);
  assert.match((await run({ ...SAMPLE, tool: "nope" })).text, /the addon has no tool nope.*one of: getInvoice/s);
  const leaky = TOOLS.replace('summary: "invoice "', 'summary: settings.token + " invoice "');
  assert.match((await run(SAMPLE, leaky)).text, /a secret setting appears in the evidence/);
  const noTime = TOOLS.replace("at: body.paid_at, ", "");
  assert.match((await run(SAMPLE, noTime)).text, /a record has no time/);
  const empty = "export async function getInvoice() { return [{ summary: '  ' }]; }";
  assert.match((await run({ ...SAMPLE, expect: {} }, empty)).text, /empty summary/);
  assert.match((await run(null, TOOLS, "not an array")).text, /FAIL\s+check.json: /);
  assert.match((await run(null, TOOLS, [{ input: {} }])).text, /FAIL\s+check.json: /);
});

test("check: the settings of each environment are checked against the workspace", async () => {
  const dir = addon({ "addon.json": MANIFEST, "tools.ts": TOOLS });
  const ws = temp();
  const base = (addons: Record<string, unknown>) => ({ sources: [], addons });
  writeFileSync(
    join(ws, "ops.config.json"),
    JSON.stringify({
      apps: {
        shop: {
          envs: {
            prod: base({ billing: { url: "https://b", token: "t" } }),
            staging: base({ billing: { url: "${BILLING_NOT_SET_ANYWHERE}", token: "t" } }),
            dev: base({ billing: { url: "https://b" } }),
            qa: base({}),
          },
        },
      },
    }),
  );
  const result = await checkAddon(dir, { workspace: ws });
  assert.match(result.text, /ok\s+settings in shop\/prod: valid/);
  assert.match(
    result.text,
    /note\s+shop\/staging: environment variable BILLING_NOT_SET_ANYWHERE is not set, so it is idle there until it is/,
  );
  assert.match(result.text, /FAIL\s+settings in shop\/dev: invalid settings: .*token/);
  assert.match(result.text, /note\s+no block for "billing" in ops.config.json for shop\/qa/);
  assert.equal(result.ok, false);
  const nothing = await checkAddon(dir, { workspace: join(temp(), "none") });
  assert.match(nothing.text, /no workspace found at .*settings were not checked/);
});

test("check --call: one real call with the workspace's settings, and what can go wrong with it", async () => {
  const root = temp();
  await initWorkspace(join(root, "ws"), ["workspace", join(root, "ws")]);
  const ws = join(root, "ws");
  await initAddon(ws, ["addon", "notes", "--template", "file"]);
  writeFileSync(join(ws, "app.log"), "2026-10-07T10:00:00Z order 4512 stuck\n");
  const config = JSON.parse((await import("node:fs")).readFileSync(join(ws, "ops.config.json"), "utf8"));
  config.apps["my-app"].envs.prod.addons.notes = { path: "app.log" };
  writeFileSync(join(ws, "ops.config.json"), JSON.stringify(config));
  const dir = join(ws, "addons/notes");
  const ok = await checkAddon(dir, { workspace: ws, call: { tool: "search", input: { term: "4512" }, env: "prod" } });
  assert.equal(ok.ok, true, ok.text);
  assert.match(ok.text, /--call search in my-app\/prod, for real: 1 record\(s\)/);
  assert.match(ok.text, /2026-10-07T10:00:00Z\s+.*order 4512 stuck/);
  assert.match(
    (await checkAddon(dir, { workspace: ws, call: { tool: "nope", input: {} } })).text,
    /--call: the addon has no tool nope/,
  );
  assert.match(
    (await checkAddon(dir, { workspace: ws, call: { tool: "search", input: { term: 1 } } })).text,
    /FAIL\s+--call search: /,
  );
  assert.match(
    (await checkAddon(dir, { call: { tool: "search", input: { term: "x" } } })).text,
    /--call needs a workspace/,
  );
});

test("check: the command exits non-zero on a failure, zero on success", () => {
  const cli = (dir: string) =>
    spawnSync("node", ["src/cli.ts", "addon", "check", dir, "--workspace", temp()], {
      encoding: "utf8",
      env: { PATH: process.env.PATH!, HOME: process.env.HOME! },
    });
  const good = cli(addon({ "addon.json": MANIFEST, "tools.ts": TOOLS, "check.json": [SAMPLE] }));
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.match(good.stdout, /All \d+ checks passed/);
  const bad = cli(addon({ "addon.json": MANIFEST, "tools.ts": "export const x = 1;" }));
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /FAIL/);
  const usage = spawnSync("node", ["src/cli.ts", "addon"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH!, HOME: process.env.HOME! },
  });
  assert.equal(usage.status, 1);
  assert.match(usage.stderr, /Usage: npm run ops -- addon check <folder>/);
});

test("check: a sample that holds what looks like personal data or a credential is flagged, test data is not", async () => {
  assert.deepEqual(
    personalHints("order 4512 of u-881 awaiting_payment since 2026-10-07T10:00:00Z, release 2.14.0"),
    [],
  );
  assert.deepEqual(personalHints("contact jane.doe+shop@example.com"), ["an email address"]);
  assert.deepEqual(personalHints("client ip 203.0.113.42"), ["an IP address"]);
  assert.deepEqual(personalHints("paid by FR76 3000 6000 0112 3456 7890 189"), ["an IBAN"]);
  assert.deepEqual(personalHints("card 4111 1111 1111 1111 declined"), ["a card number"]);
  assert.deepEqual(
    personalHints("order 4111 1111 1111 1112 is not a card"),
    [],
    "a number that fails the Luhn check is not flagged",
  );
  assert.deepEqual(personalHints("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123456789"), [
    "what looks like a credential",
  ]);
  assert.deepEqual(personalHints("token ghp_abcdefghijklmnopqrstuvwxyz0123"), ["what looks like a credential"]);
  assert.deepEqual(personalHints("version 10.2.3.4.5 build 1234"), [], "a version is not an address");

  const leaky = TOOLS.replace('summary: "invoice "', 'summary: "jane.doe@example.com from 203.0.113.9 invoice "');
  const flagged = await checkAddon(
    addon({
      "addon.json": MANIFEST,
      "tools.ts": leaky,
      "check.json": [{ ...SAMPLE, expect: { summaryIncludes: "invoice" } }],
    }),
  );
  assert.equal(flagged.ok, true, "a warning, not a failure");
  assert.match(
    flagged.text,
    /warn\s+sample "an invoice": a record holds an email address, an IP address\. If that is real data, it goes to the AI provider/,
  );
  const clean = await checkAddon(addon({ "addon.json": MANIFEST, "tools.ts": TOOLS, "check.json": [SAMPLE] }));
  assert.doesNotMatch(clean.text, /goes to the AI provider/);

  const root = temp();
  await initWorkspace(join(root, "ws"), ["workspace", join(root, "ws")]);
  await initAddon(join(root, "ws"), ["addon", "notes", "--template", "file"]);
  writeFileSync(join(root, "ws/app.log"), "2026-10-07T10:00:00Z user jane.doe@example.com paid order 4512\n");
  const config = JSON.parse(readFileSync(join(root, "ws/ops.config.json"), "utf8"));
  config.apps["my-app"].envs.prod.addons.notes = { path: "app.log" };
  writeFileSync(join(root, "ws/ops.config.json"), JSON.stringify(config));
  const real = await checkAddon(join(root, "ws/addons/notes"), {
    workspace: join(root, "ws"),
    call: { tool: "search", input: { term: "4512" }, env: "prod" },
  });
  assert.match(
    real.text,
    /warn\s+--call: the real records hold an email address\. This is what the assistant would send to its AI provider/,
  );
  assert.equal(real.ok, true);
});

test("init addon: the scaffolded code and the next steps say what is sent to the AI provider", async () => {
  const root = temp();
  for (const template of ["file", "api", "sql"]) {
    const message = await initAddon(root, ["addon", `p-${template}`, "--template", template]);
    assert.match(message, /reaches the AI provider/);
    assert.match(
      readFileSync(join(root, "addons", `p-${template}`, "tools.ts"), "utf8"),
      /PERSONAL DATA: what this function returns is sent to the AI provider/,
    );
  }
});
