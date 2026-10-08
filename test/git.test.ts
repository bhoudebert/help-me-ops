// The shipped git addon, against real git repositories made in a temp folder
// (the demo repository, and small hostile ones): what it reads, and what it
// refuses to do.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { runCommand } from "../src/commands.ts";
import { openToolbox } from "../src/toolbox.ts";
import { createToolDefinitions } from "../src/tools/index.ts";

// The machine's own variables must not decide these tests.
for (const name of ["GIT_REPO", "GIT_REF", "SHOP_REPO"]) delete process.env[name];

const demo = (await import(resolve("examples/my-workspace/git-demo/build.mjs"))) as {
  buildDemoRepo(dir: string): string[];
};

const temp = (name: string) => mkdtempSync(join(tmpdir(), `ops-git-${name}-`));

function workspace(settings: Record<string, unknown> | null) {
  const root = temp("ws");
  const env = { sources: [], ...(settings ? { addons: { git: settings } } : {}) };
  writeFileSync(join(root, "ops.config.json"), JSON.stringify({ apps: { shop: { envs: { prod: env } } } }));
  return root;
}

const repo = (() => {
  const dir = join(temp("demo"), "repo");
  demo.buildDemoRepo(dir);
  return dir;
})();

type Answer = { evidence: { at: string | null; summary: string; data: Record<string, any> }[] };

async function call(name: string, input: Record<string, unknown>, settings: Record<string, unknown> = { repo }) {
  const tool = createToolDefinitions(await openToolbox(workspace(settings))).find((t) => t.name === `git.${name}`)!;
  return JSON.parse(await tool.run(tool.inputSchema.parse(input))) as Answer;
}

const git = (dir: string, ...args: string[]) =>
  execFileSync("git", ["-C", dir, ...args], { env: { PATH: process.env.PATH!, HOME: process.env.HOME! } })
    .toString()
    .trim();

test("git log: the commits before the incident, newest first, with their files and times", async () => {
  const { evidence } = await call("log", { since: "2026-10-05T00:00:00Z" });
  assert.deepEqual(
    evidence.map((e) => [e.at, e.data.author, e.data.subject]),
    [
      ["2026-10-07T09:20:00Z", "Bob Keller", "Release 2.14.0"],
      ["2026-10-06T11:00:00Z", "Carol Diaz", "Lower the worker memory limit to 512Mi"],
      ["2026-10-05T16:20:00Z", "Bob Keller", "Speed up confirmations: batches of 500 and a cache of confirmed orders"],
    ],
  );
  assert.deepEqual(evidence[1]!.data.files, ["deploy/worker.yaml"]);
  assert.match(evidence[2]!.summary, /^[0-9a-f]{8} Speed up confirmations/);
});

test("git log: filters by path, message, author, window and limit", async () => {
  assert.equal((await call("log", { path: "src/worker" })).evidence.length, 2);
  assert.deepEqual(
    (await call("log", { message: "MEMORY" })).evidence.map((e) => e.data.subject),
    ["Lower the worker memory limit to 512Mi"],
  );
  assert.equal((await call("log", { author: "alice" })).evidence.length, 2);
  assert.equal((await call("log", { until: "2026-09-21T00:00:00Z" })).evidence.length, 1);
  assert.equal((await call("log", { limit: 2 })).evidence.length, 2);
  assert.equal((await call("log", { since: "2030-01-01T00:00:00Z" })).evidence.length, 0);
  // the environment's ref bounds the history
  assert.equal((await call("log", {}, { repo, ref: "v2.13.2" })).evidence.length, 3);
});

test("git tags, show, diff, grep and fileAt: a release to its code", async () => {
  const tags = (await call("tags", {})).evidence;
  assert.deepEqual(
    tags.map((t) => [t.data.name, t.at]),
    [
      ["v2.14.0", "2026-10-07T09:30:00Z"],
      ["v2.13.2", "2026-10-02T09:10:00Z"],
      ["v2.13.0", "2026-09-25T15:30:00Z"],
    ],
  );
  assert.deepEqual(
    (await call("tags", { pattern: "v2.14*" })).evidence.map((t) => t.data.name),
    ["v2.14.0"],
  );

  const [shown] = (await call("show", { commit: "v2.14.0" })).evidence;
  assert.equal(shown!.data.subject, "Release 2.14.0");
  assert.ok(shown!.data.files.some((f: string) => f.includes("package.json")));

  const worker = (await call("diff", { from: "v2.13.2", to: "v2.14.0", path: "src/worker/confirm.js" })).evidence[0]!;
  assert.match(
    worker.data.patch,
    /\+const confirmed = new Map\(\); \/\/ order -> confirmation, kept for the life of the process/,
  );
  assert.ok(worker.data.added > 5 && worker.data.removed > 3);
  assert.match(worker.summary, /src\/worker\/confirm.js from v2.13.2 to v2.14.0: \+\d+ -\d+/);
  assert.match(
    (await call("diff", { from: "v2.13.0", to: "v2.13.0", path: "README.md" })).evidence[0]!.summary,
    /no change/,
  );

  const found = (await call("grep", { text: "queue full" })).evidence;
  assert.deepEqual(
    found.map((e) => [e.data.path, e.data.line]),
    [["src/api/webhook.js", 7]],
  );
  assert.deepEqual((await call("grep", { text: "nothing like this anywhere" })).evidence, []);
  assert.equal((await call("grep", { text: "BATCH", path: "src/worker" })).evidence.length, 2);

  const file = (await call("fileAt", { path: "src/worker/confirm.js", ref: "v2.14.0", startLine: 3, lines: 3 }))
    .evidence[0]!;
  assert.equal(file.data.startLine, 3);
  assert.match(file.data.content, /^3: const BATCH = 500;/);
  assert.match(
    (await call("fileAt", { path: "src/worker/confirm.js", ref: "v2.13.2" })).evidence[0]!.data.content,
    /One job at a time/,
  );
});

test("git: a value from the question can never be an option, a path never leaves the repository", async () => {
  const marker = join(temp("pwn"), "pwned");
  for (const [name, input, why] of [
    ["log", { path: "../outside" }, /inside the repository/],
    ["log", { path: "/etc/passwd" }, /inside the repository/],
    ["log", { path: "-p" }, /inside the repository/],
    ["log", { since: "--output=x" }, /ISO 8601/],
    ["show", { commit: "--output=" + marker }, /not a commit, tag or branch name/],
    ["show", { commit: "-p" }, /not a commit/],
    ["show", { commit: "HEAD..main" }, /not a commit/],
    ["diff", { from: "--no-index", to: "HEAD", path: "README.md" }, /not a commit/],
    ["diff", { from: "HEAD", to: "HEAD", path: "../x" }, /inside the repository/],
    ["fileAt", { path: "README.md", ref: "--help" }, /not a commit/],
    ["fileAt", { path: "../../etc/passwd" }, /inside the repository/],
    ["tags", { pattern: "v2; rm -rf /" }, /letters, digits/],
    ["grep", { text: "  " }, /must not be empty/],
  ] as const) {
    await assert.rejects(call(name, input as Record<string, unknown>), why, `${name} ${JSON.stringify(input)}`);
  }
  await assert.rejects(call("log", {}, { repo, ref: "--output=" + marker }), /not a commit, tag or branch name/);
  // values that look like options but are only text (one argument each) do nothing
  assert.deepEqual((await call("log", { message: "--output=" + marker })).evidence, []);
  assert.deepEqual((await call("grep", { text: "--output=" + marker })).evidence, []);
  assert.equal(existsSync(marker), false);
});

test("git: files that usually hold secrets are refused or left out", async () => {
  const dir = join(temp("secrets"), "repo");
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-b", "main");
  mkdirSync(join(dir, "keys"));
  writeFileSync(join(dir, "app.js"), "const token = process.env.TOKEN;\n");
  writeFileSync(join(dir, ".env"), "API_TOKEN=hunter2-super-secret\n");
  writeFileSync(join(dir, "keys/server.pem"), "-----BEGIN PRIVATE KEY----- hunter2-super-secret\n");
  git(dir, "add", "-A");
  git(dir, "-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "add app and, by mistake, secrets");
  const settings = { repo: dir };
  await assert.rejects(call("fileAt", { path: ".env" }, settings), /looks like a secrets file/);
  await assert.rejects(call("fileAt", { path: "keys/server.pem" }, settings), /looks like a secrets file/);
  await assert.rejects(call("diff", { from: "HEAD", to: "HEAD", path: ".env" }, settings), /looks like a secrets file/);
  assert.deepEqual((await call("grep", { text: "hunter2" }, settings)).evidence, []);
  assert.deepEqual((await call("log", {}, settings)).evidence[0]!.data.files, ["app.js"]);
  assert.ok((await call("grep", { text: "process.env.TOKEN" }, settings)).evidence.length === 1);
});

test("git: a repository's own configuration cannot make it run anything", async () => {
  const dir = join(temp("hostile"), "repo");
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-b", "main");
  const marker = join(temp("marker"), "ran");
  const script = join(temp("script"), "evil.sh");
  writeFileSync(script, `#!/bin/sh\ntouch ${marker}\n`);
  chmodSync(script, 0o755);
  writeFileSync(join(dir, "a.txt"), "one\n");
  git(dir, "add", "-A");
  git(dir, "-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "one");
  writeFileSync(join(dir, "a.txt"), "two\n");
  git(dir, "-c", "user.name=T", "-c", "user.email=t@t", "commit", "-am", "two");
  git(dir, "config", "core.fsmonitor", script);
  git(dir, "config", "diff.external", script);
  git(dir, "config", "core.pager", script);
  git(dir, "config", "diff.evil.textconv", script);
  writeFileSync(join(dir, ".gitattributes"), "*.txt diff=evil\n");
  const settings = { repo: dir };
  assert.equal((await call("log", {}, settings)).evidence.length, 2);
  assert.match(
    (await call("diff", { from: "HEAD~1", to: "HEAD", path: "a.txt" }, settings)).evidence[0]!.data.patch,
    /\+two/,
  );
  await call("show", { commit: "HEAD" }, settings);
  await call("grep", { text: "two" }, settings);
  assert.equal(existsSync(marker), false, "no program of the repository's configuration ran");
});

test("git: read-only. The repository is unchanged after every tool, and the source holds only reading subcommands", async () => {
  const before = [
    git(repo, "rev-parse", "HEAD"),
    git(repo, "status", "--porcelain"),
    git(repo, "reflog", "--format=%H"),
  ];
  await call("log", {});
  await call("show", { commit: "HEAD" });
  await call("diff", { from: "v2.13.0", to: "v2.14.0", path: "src" });
  await call("grep", { text: "BATCH" });
  await call("fileAt", { path: "package.json" });
  await call("tags", {});
  assert.deepEqual(
    [git(repo, "rev-parse", "HEAD"), git(repo, "status", "--porcelain"), git(repo, "reflog", "--format=%H")],
    before,
  );
  assert.equal(existsSync(join(repo, ".git", "index.lock")), false);

  const source = readFileSync("addons/git/tools.ts", "utf8");
  const used = [...source.matchAll(/git\(context, "([\w-]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(used)].sort(), ["cat-file", "diff", "grep", "log", "show", "tag"]);
  assert.equal([...source.matchAll(/execFile\(/g)].length, 1, "one place runs git");
  assert.doesNotMatch(source, /(?<![.\w])exec\(|execSync|shell:\s*true|spawn\(/);
  assert.match(source, /READ_ONLY = new Set\(\["log", "show", "diff", "grep", "tag", "cat-file", "rev-parse"\]\)/);
});

test("git: not a repository, idle until set up, and set up by GIT_REPO alone", async () => {
  await assert.rejects(call("log", {}, { repo: temp("empty") }), /is not a git repository/);
  const idle = await openToolbox(workspace(null));
  assert.ok(!createToolDefinitions(idle).some((t) => t.name.startsWith("git.")));
  assert.match(idle.addons!.find((a) => a.name === "git")!.reason ?? "", /no environment sets it up/);
  const keep = { ...process.env };
  process.env.GIT_REPO = repo;
  try {
    const names = createToolDefinitions(await openToolbox(workspace({}))).map((t) => t.name);
    assert.deepEqual(
      names.filter((n) => n.startsWith("git.")),
      ["git.log", "git.show", "git.diff", "git.grep", "git.fileAt", "git.tags"],
    );
  } finally {
    if (keep.GIT_REPO === undefined) delete process.env.GIT_REPO;
  }
});

test("git: the demo workspace waits for SHOP_REPO, then reads the demo repository per environment", async () => {
  const demoWorkspace = resolve("examples/my-workspace");
  const waiting = await openToolbox(demoWorkspace);
  assert.match(await runCommand(waiting, "doctor", []), /git\s+idle.*waiting for SHOP_REPO/);
  const keep = { ...process.env };
  process.env.SHOP_REPO = repo;
  try {
    const tools = createToolDefinitions(await openToolbox(demoWorkspace));
    const tags = tools.find((t) => t.name === "git.tags")!;
    for (const env of ["prod", "staging"]) {
      const answer = JSON.parse(await tags.run({ env })) as Answer;
      assert.equal(answer.evidence[0]!.data.name, "v2.14.0");
    }
  } finally {
    if (keep.SHOP_REPO === undefined) delete process.env.SHOP_REPO;
  }
});
