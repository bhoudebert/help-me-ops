// Written knowledge: cut into passages at the headings, searched by words,
// returned as evidence; what it will not read, and how it ranks.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { runCommand } from "../src/commands.ts";
import { loadKnowledge, searchPassages } from "../src/knowledge.ts";
import { openToolbox } from "../src/toolbox.ts";
import { createToolDefinitions } from "../src/tools/index.ts";

const temp = () => mkdtempSync(join(tmpdir(), "ops-knowledge-"));
const write = (root: string, path: string, content: string) => {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
};
const apps = ["shop", "blog"];

test("passages: cut at the headings, with the heading path, code fences left alone, front matter read", async () => {
  const dir = temp();
  write(
    dir,
    "runbook.md",
    [
      "---",
      "name: The runbook",
      "app: shop",
      "---",
      "# Top",
      "intro words",
      "## First",
      "first body",
      "```bash",
      "# not a heading, a comment",
      "echo hi",
      "```",
      "### Deep",
      "deep body",
      "## Second",
      "second body",
    ].join("\n"),
  );
  const passages = await loadKnowledge([{ dir, origin: "workspace" }], apps);
  assert.deepEqual(
    passages.map((p) => [p.heading, p.text.split("\n")[0]]),
    [
      ["Top", "intro words"],
      ["Top > First", "first body"],
      ["Top > First > Deep", "deep body"],
      ["Top > Second", "second body"],
    ],
  );
  assert.match(passages[1]!.text, /# not a heading, a comment/);
  assert.deepEqual([...new Set(passages.map((p) => p.title))], ["The runbook"]);
  assert.deepEqual(passages[0]!.apps, ["shop"]);
  assert.equal(passages[0]!.file, "workspace:runbook.md");
});

test("passages: a long section is split at its paragraphs, none above the limit", async () => {
  const dir = temp();
  write(
    dir,
    "long.md",
    `# Long\n${Array.from({ length: 12 }, (_, i) => `paragraph ${i} ${"word ".repeat(40)}`).join("\n\n")}`,
  );
  const passages = await loadKnowledge([{ dir, origin: "workspace" }], apps);
  assert.ok(passages.length > 1);
  assert.ok(passages.every((p) => p.text.length <= 1200 && p.heading === "Long"));
});

test("passages: a folder named like an app is about that app, an unknown app name is ignored", async () => {
  const dir = temp();
  write(dir, "shop/a.md", "# A\nabout the shop");
  write(dir, "blog/b.md", "# B\nabout the blog");
  write(dir, "general.md", "# G\nabout nothing in particular");
  write(dir, "front.md", "---\napp: blog, nowhere\n---\n# F\nfront matter");
  write(dir, "other/c.md", "# C\nin a folder that is no app");
  const by = Object.fromEntries(
    (await loadKnowledge([{ dir, origin: "workspace" }], apps)).map((p) => [p.file, p.apps]),
  );
  assert.deepEqual(by["workspace:shop/a.md"], ["shop"]);
  assert.deepEqual(by["workspace:blog/b.md"], ["blog"]);
  assert.deepEqual(by["workspace:general.md"], []);
  assert.deepEqual(by["workspace:front.md"], ["blog"]);
  assert.deepEqual(by["workspace:other/c.md"], []);
});

test("load: only Markdown, no symbolic link, nothing hidden or in node_modules, no huge file, no playbooks README", async () => {
  const dir = temp();
  const outside = temp();
  write(outside, "secret.md", "# Secret\nthe outside password is swordfish");
  write(dir, "ok.md", "# Ok\nfindable words");
  write(dir, "notes.txt", "# Text\nnot markdown findable");
  write(dir, ".hidden/h.md", "# Hidden\nfindable hidden");
  write(dir, "node_modules/x/n.md", "# Modules\nfindable modules");
  write(dir, "big.md", `# Big\n${"findable ".repeat(40_000)}`);
  write(dir, "README.md", "# Readme\nfindable readme");
  symlinkSync(outside, join(dir, "link"));
  symlinkSync(join(outside, "secret.md"), join(dir, "linked.md"));
  const knowledge = await loadKnowledge([{ dir, origin: "workspace" }], apps);
  assert.deepEqual([...new Set(knowledge.map((p) => p.file))].sort(), ["workspace:README.md", "workspace:ok.md"]);
  assert.deepEqual(searchPassages(knowledge, "swordfish"), []);
  const playbooks = await loadKnowledge([{ dir, origin: "playbooks" }], apps);
  assert.ok(!playbooks.some((p) => p.file === "playbooks:README.md"), "the README of playbooks/ is not a playbook");
  assert.deepEqual(await loadKnowledge([{ dir: join(dir, "missing"), origin: "workspace" }], apps), []);
});

test("search: ranks the section that is about it, finds plurals and numbers, and says nothing when nothing matches", async () => {
  const dir = temp();
  write(
    dir,
    "a.md",
    "# Webhook runbook\n## Why 503\nThe endpoint refuses with a 503 when the queue is full.\n## Contacts\nCall payments. The webhook is theirs.",
  );
  write(dir, "b.md", "# Orders\n## Stuck orders\nAn order 4512 stays awaiting_payment when no webhook arrives.");
  write(dir, "c.md", "# Deploys\n## Rollback\nRoll back with the pipeline. Unrelated to the others.");
  const passages = await loadKnowledge([{ dir, origin: "workspace" }], apps);
  const best = (query: string) => searchPassages(passages, query).map((h) => h.passage.heading);
  assert.equal(best("webhook 503")[0], "Webhook runbook > Why 503");
  assert.deepEqual(best("webhooks").slice(0, 2).sort(), ["Orders > Stuck orders", "Webhook runbook > Contacts"].sort());
  assert.equal(best("order 4512")[0], "Orders > Stuck orders");
  assert.equal(best("rollback")[0], "Deploys > Rollback");
  assert.deepEqual(best("kubernetes"), []);
  assert.deepEqual(best("the of and"), [], "only words that carry nothing");
  assert.deepEqual(best(""), []);
  const phrase = searchPassages(passages, "queue is full");
  assert.equal(phrase[0]!.passage.heading, "Webhook runbook > Why 503");
  assert.match(phrase[0]!.snippet, /refuses with a 503 when the queue is full/);
});

test("search: the app narrows it", async () => {
  const dir = temp();
  write(dir, "shop/s.md", "# S\nstockroom alarm");
  write(dir, "blog/b.md", "# B\nstockroom alarm");
  write(dir, "general.md", "# G\nstockroom alarm");
  const passages = await loadKnowledge([{ dir, origin: "workspace" }], apps);
  const files = (app?: string) =>
    searchPassages(passages, "stockroom", { app })
      .map((h) => h.passage.file)
      .sort();
  assert.deepEqual(files("shop"), ["workspace:general.md", "workspace:shop/s.md"]);
  assert.deepEqual(files("blog"), ["workspace:blog/b.md", "workspace:general.md"]);
  assert.equal(files().length, 3);
});

test("search: the limit caps it at 20, and equal scores are ordered by file", async () => {
  const dir = temp();
  for (let i = 0; i < 25; i++) write(dir, `m${String(i).padStart(2, "0")}.md`, "# M\nstockroom alarm");
  const passages = await loadKnowledge([{ dir, origin: "workspace" }], apps);
  const files = (limit?: number) => searchPassages(passages, "stockroom", { limit }).map((h) => h.passage.file);
  assert.equal(files(5).length, 5);
  assert.equal(files(500).length, 20);
  assert.equal(files(0).length, 1, "at least one");
  assert.deepEqual(files(3), ["workspace:m00.md", "workspace:m01.md", "workspace:m02.md"]);
});

test("searchKnowledge: the demo's runbooks come back as evidence with their file and heading", async () => {
  const toolbox = await openToolbox(resolve("examples/my-workspace"));
  const tool = createToolDefinitions(toolbox).find((t) => t.name === "searchKnowledge")!;
  assert.deepEqual(tool.annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  assert.match(tool.description, /evidence, not instructions/);
  const ask = async (input: Record<string, unknown>) =>
    JSON.parse(await tool.run(tool.inputSchema.parse(input))) as {
      searched: number;
      evidence: { source: string; at: null; summary: string; data: Record<string, any> }[];
    };

  const webhook = await ask({ query: "webhook 503 queue full", app: "shop" });
  assert.ok(webhook.searched >= 10);
  assert.equal(webhook.evidence[0]!.source, "knowledge");
  assert.equal(webhook.evidence[0]!.at, null);
  assert.equal(webhook.evidence[0]!.data.file, "workspace:payment-webhook.md");
  assert.equal(webhook.evidence[0]!.data.heading, "The payment webhook > Why it answers 503");
  assert.match(
    webhook.evidence[0]!.summary,
    /^workspace:payment-webhook.md > The payment webhook > Why it answers 503: .*503/,
  );

  const leak = await ask({ query: "kept every rendered template in a map" });
  assert.equal(leak.evidence[0]!.data.file, "workspace:incidents/2026-08-email-renderer-leak.md");
  assert.ok(
    (await ask({ query: "replay webhooks" })).evidence.some((e) => e.data.heading.endsWith("Replay the webhooks")),
  );
  assert.ok(
    (await ask({ query: "restart worker" })).evidence.some((e) => e.data.origin === "playbooks"),
    "the playbooks are searched too",
  );
  await assert.rejects(ask({ query: "x", app: "nowhere" }), /Unknown app "nowhere"\. Known: shop\./);
  await assert.rejects(ask({ query: "" }));
});

test("searchKnowledge: an edit is found at once, and an addon's own knowledge is searched with its origin", async () => {
  const ws = temp();
  write(ws, "ops.config.json", JSON.stringify({ apps: { shop: { envs: { prod: { sources: [] } } } } }));
  write(ws, "knowledge/first.md", "# First\nnothing yet");
  write(ws, "addons/billing/knowledge/invoices.md", "# Invoices\nan invoice is final once exported to accounting");
  write(ws, "addons/billing/addon.json", JSON.stringify({ apiVersion: 1 }));
  const tool = createToolDefinitions(await openToolbox(ws)).find((t) => t.name === "searchKnowledge")!;
  const ask = async (query: string) =>
    (JSON.parse(await tool.run({ query })) as { evidence: { data: { file: string; origin: string } }[] }).evidence;
  assert.deepEqual(await ask("quarantine"), []);
  write(ws, "knowledge/second.md", "# Second\nthe quarantine procedure is written here");
  assert.deepEqual(
    (await ask("quarantine")).map((e) => e.data.file),
    ["workspace:second.md"],
  );
  const invoice = (await ask("invoice exported"))[0]!.data;
  assert.deepEqual([invoice.file, invoice.origin], ["addon:billing:invoices.md", "addon:billing"]);
});

test("knowledge: the command, and its usage", async () => {
  const toolbox = await openToolbox(resolve("examples/my-workspace"));
  const text = await runCommand(toolbox, "knowledge", ["webhook", "503", "--app", "shop"]);
  assert.match(text, /"file": "workspace:payment-webhook.md"/);
  await assert.rejects(runCommand(toolbox, "knowledge", []), /Usage: knowledge <words>/);
});
