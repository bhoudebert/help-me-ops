// The shipped github addon. Without a GitHub account, two ways:
//  1. against recorded responses in GitHub's documented shapes (test/fixtures/github):
//     the requests it builds and what it makes of the answers;
//  2. over real HTTP against the demo's mock of GitHub (the live backend).
// Neither proves a real GitHub accepts the requests: the addon is labelled experimental.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { runCommand } from "../src/commands.ts";
import { openToolbox } from "../src/toolbox.ts";
import { createToolDefinitions } from "../src/tools/index.ts";

// The machine's own variables must not decide these tests.
for (const name of ["GITHUB_TOKEN", "GITHUB_REPOS", "GITHUB_API_URL"]) delete process.env[name];

const recorded = (name: string) => readFileSync(join("test/fixtures/github", `${name}.json`), "utf8");
const SETTINGS = { token: "ghp_s3cret", repos: "shop-co/shop" };

function workspace(settings: Record<string, unknown> | null) {
  const root = mkdtempSync(join(tmpdir(), "ops-gh-"));
  const env = { sources: [], ...(settings ? { addons: { github: settings } } : {}) };
  writeFileSync(join(root, "ops.config.json"), JSON.stringify({ apps: { shop: { envs: { prod: env } } } }));
  return root;
}

interface Call {
  url: URL;
  method?: string;
  headers: Record<string, string>;
  redirect?: string;
}

async function withFetch(answer: (call: Call) => Response, body: () => Promise<void>) {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: URL, init?: RequestInit) => {
    const call = {
      url: new URL(String(url)),
      method: init?.method,
      headers: init?.headers as Record<string, string>,
      redirect: init?.redirect,
    };
    calls.push(call);
    return answer(call);
  }) as typeof fetch;
  try {
    await body();
  } finally {
    globalThis.fetch = real;
  }
  return calls;
}

const tool = async (root: string, name: string) =>
  createToolDefinitions(await openToolbox(root)).find((t) => t.name === `github.${name}`)!;
const ok = (name: string) => new Response(recorded(name), { headers: { "content-type": "application/json" } });
type Answer = { evidence: { at: string | null; summary: string; data: Record<string, any> }[] };
const run = async (name: string, input: Record<string, unknown>, settings: Record<string, unknown> = SETTINGS) => {
  const found = await tool(workspace(settings), name);
  return JSON.parse(await found.run(found.inputSchema.parse(input))) as Answer;
};

test("github pull requests: what was merged, a GET with the token and the API version", async () => {
  const calls = await withFetch(
    () => ok("pulls-list"),
    async () => {
      const { evidence } = await run("pullRequests", { mergedSince: "2026-10-05T00:00:00Z" });
      assert.deepEqual(
        evidence.map((e) => [e.at, e.data.number, e.data.state, e.data.author]),
        [
          ["2026-10-07T09:22:00Z", 421, "merged", "bob"],
          ["2026-10-06T11:05:00Z", 418, "merged", "carol"],
          ["2026-10-05T16:30:00Z", 412, "merged", "bob"],
        ],
      );
      assert.match(
        evidence[2]!.summary,
        /^shop-co\/shop#412 Speed up confirmations.*\(bob, merged 2026-10-05T16:30:00Z\)$/,
      );
    },
  );
  const [call] = calls;
  assert.equal(
    call!.url.href,
    "https://api.github.com/repos/shop-co/shop/pulls?state=closed&sort=updated&direction=desc&per_page=50",
  );
  assert.equal(call!.method, "GET");
  assert.equal(call!.redirect, "manual");
  assert.deepEqual(call!.headers, {
    accept: "application/vnd.github+json",
    authorization: "Bearer ghp_s3cret",
    "x-github-api-version": "2022-11-28",
    "user-agent": "help-me-ops",
  });
});

test("github pull request: the description and the files it changed", async () => {
  const calls = await withFetch(
    (call) => ok(call.url.pathname.endsWith("/files") ? "pull-files" : "pull"),
    async () => {
      const [pr] = (await run("pullRequest", { number: 412 })).evidence;
      assert.equal(pr!.at, "2026-10-05T16:30:00Z");
      assert.equal(pr!.data.description, "Throughput is 4x on the load test. The cache skips duplicate webhooks.");
      assert.deepEqual(pr!.data.files, ["src/worker/confirm.js (+16 -6)"]);
      assert.match(pr!.summary, /#412 .*: 1 files, \+16 -6/);
    },
  );
  assert.deepEqual(
    calls.map((c) => c.url.pathname),
    ["/repos/shop-co/shop/pulls/412", "/repos/shop-co/shop/pulls/412/files"],
  );
});

test("github releases, commits, issues and workflow runs", async () => {
  await withFetch(
    () => ok("releases"),
    async () => {
      const { evidence } = await run("releases", { limit: 2 });
      assert.deepEqual(
        evidence.map((e) => [e.at, e.data.tag]),
        [
          ["2026-10-07T09:30:00Z", "v2.14.0"],
          ["2026-10-02T09:30:00Z", "v2.13.2"],
          ["2026-09-25T15:40:00Z", "v2.13.0"],
        ],
      );
    },
  );
  const commitCalls = await withFetch(
    () => ok("commits"),
    async () => {
      const { evidence } = await run("commits", {
        branch: "main",
        path: "src/worker",
        since: "2026-10-01T00:00:00Z",
        limit: 5,
      });
      assert.equal(evidence[1]!.summary, "51b4436f Lower the worker memory limit to 512Mi (Carol Diaz)");
      assert.equal(evidence[0]!.at, "2026-10-07T09:20:00Z");
    },
  );
  const q = commitCalls[0]!.url.searchParams;
  assert.deepEqual(
    [q.get("sha"), q.get("path"), q.get("since"), q.get("per_page")],
    ["main", "src/worker", "2026-10-01T00:00:00.000Z", "5"],
  );
  await withFetch(
    () => ok("issues"),
    async () => {
      const { evidence } = await run("issues", { state: "open", labels: "perf" });
      assert.deepEqual(
        evidence.map((e) => e.data.number),
        [409, 377],
        "a pull request in the list is not an issue",
      );
      assert.deepEqual(evidence[0]!.data.labels, ["perf"]);
    },
  );
  const runCalls = await withFetch(
    () => ok("runs"),
    async () => {
      const { evidence } = await run("workflowRuns", { branch: "main", status: "success" });
      assert.equal(evidence[0]!.summary, 'Deploy "Deploy 2.14.0 to prod" on main: success');
      assert.equal(evidence[0]!.at, "2026-10-07T09:31:00Z");
    },
  );
  assert.equal(runCalls[0]!.url.pathname, "/repos/shop-co/shop/actions/runs");
  assert.equal(runCalls[0]!.url.searchParams.get("status"), "success");
});

test("github: only listed repositories, clean numbers and times, nothing requested otherwise", async () => {
  const two = { ...SETTINGS, repos: "shop-co/shop, Shop-Co/infra" };
  const calls = await withFetch(
    () => ok("releases"),
    async () => {
      await assert.rejects(run("releases", { repo: "evil/other" }), /not in the list this addon may read/);
      await assert.rejects(run("releases", { repo: "shop-co/shop/../../x" }), /not in the list/);
      await assert.rejects(run("releases", {}, two), /which repository\? one of shop-co\/shop, Shop-Co\/infra/);
      await assert.rejects(run("pullRequest", { number: 0 }), /positive integer/);
      await assert.rejects(run("pullRequest", { number: 1.5 }));
      await assert.rejects(run("commits", { since: "last week" }), /ISO 8601/);
      await assert.rejects(run("releases", {}, { ...SETTINGS, repos: "not a repo" }), /is not owner\/name/);
      await run("releases", { repo: "shop-co/INFRA" }, two);
    },
  );
  assert.deepEqual(
    calls.map((c) => c.url.pathname),
    ["/repos/Shop-Co/infra/releases"],
  );
});

test("github errors: token, permission, rate limit, moved, unknown, and the token never shows", async () => {
  for (const [response, expected] of [
    [new Response('{"message":"Bad credentials"}', { status: 401 }), /refused the token \(401\)/],
    [new Response("{}", { status: 403 }), /lacks a read permission/],
    [
      new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1791370000" } }),
      /rate limit reached \(resets at 2026-10-07T/,
    ],
    [new Response("{}", { status: 429 }), /rate limit reached/],
    [
      new Response("", { status: 301, headers: { location: "https://api.github.com/repositories/1" } }),
      /may have moved/,
    ],
    [new Response('{"message":"Not Found"}', { status: 404 }), /answered 404.*cannot see it/],
    [new Response("boom ghp_s3cret", { status: 500 }), /answered 500/],
  ] as const) {
    await withFetch(
      () => response,
      async () =>
        await assert.rejects(
          run("releases", {}),
          (error: Error) => expected.test(error.message) && !error.message.includes("s3cret"),
        ),
    );
  }
  await withFetch(
    () => {
      throw new Error("socket hang up for Bearer ghp_s3cret");
    },
    async () =>
      await assert.rejects(
        run("releases", {}),
        (error: Error) => /socket hang up/.test(error.message) && !error.message.includes("s3cret"),
      ),
  );
});

test("github: long text from other people is cut, a GitHub Enterprise URL is honoured, idle until set up", async () => {
  const long = JSON.parse(recorded("pull")) as Record<string, unknown>;
  long.body = "x".repeat(2000);
  const calls = await withFetch(
    (call) => (call.url.pathname.endsWith("/files") ? ok("pull-files") : Response.json(long)),
    async () => {
      const [pr] = (
        await run("pullRequest", { number: 412 }, { ...SETTINGS, baseUrl: "https://git.corp.example/api/v3/" })
      ).evidence;
      assert.ok(String(pr!.data.description).length < 520 && String(pr!.data.description).endsWith("(cut)"));
    },
  );
  assert.equal(calls[0]!.url.href, "https://git.corp.example/api/v3/repos/shop-co/shop/pulls/412");
  const idle = await openToolbox(workspace(null));
  assert.ok(!createToolDefinitions(idle).some((t) => t.name.startsWith("github.")));
  const keep = { ...process.env };
  Object.assign(process.env, { GITHUB_TOKEN: "t", GITHUB_REPOS: "shop-co/shop" });
  try {
    const names = createToolDefinitions(await openToolbox(workspace({}))).map((t) => t.name);
    assert.deepEqual(
      names.filter((n) => n.startsWith("github.")),
      [
        "github.pullRequests",
        "github.pullRequest",
        "github.releases",
        "github.commits",
        "github.issues",
        "github.workflowRuns",
      ],
    );
  } finally {
    for (const name of ["GITHUB_TOKEN", "GITHUB_REPOS"]) if (keep[name] === undefined) delete process.env[name];
  }
});

test("github: only GET requests exist in the addon", () => {
  const source = readFileSync("addons/github/tools.ts", "utf8");
  assert.equal([...source.matchAll(/method:\s*"(\w+)"/g)].map((m) => m[1]).join(), "GET");
  assert.equal([...source.matchAll(/\bfetch\(/g)].length, 1, "one place makes requests");
  const manifest = JSON.parse(readFileSync("addons/github/addon.json", "utf8")) as {
    description: string;
    tools: Record<string, { description: string }>;
  };
  assert.match(manifest.description, /^EXPERIMENTAL/);
  for (const [name, tool] of Object.entries(manifest.tools))
    assert.match(tool.description, /Read-only\.( Experimental| The text)?/, name);
});

// ---- the demo's mock of GitHub, over real HTTP ----

const demo = resolve("examples/my-workspace");
const backend = (await import(resolve(demo, "docker/backend/server.mjs"))) as {
  start(workspace: string, ports: Record<string, number>): Promise<Record<string, import("node:http").Server>>;
};
const mock = (await import(resolve(demo, "docker/backend/github.mjs"))) as { GITHUB_TOKEN: string };

test("mock github: the demo's changes before the incident, found through the addon over HTTP", async () => {
  const servers = await backend.start(demo, { prod: 0, staging: 0 });
  const url = (env: string) => `http://127.0.0.1:${(servers[env]!.address() as { port: number }).port}`;
  const keep = { ...process.env };
  Object.assign(process.env, {
    SHOP_API_PROD_URL: url("prod"),
    SHOP_API_STAGING_URL: url("staging"),
    GITHUB_TOKEN: mock.GITHUB_TOKEN,
  });
  try {
    const tools = createToolDefinitions(await openToolbox(demo));
    const ask = async (name: string, env: string, input: Record<string, unknown>) => {
      const found = tools.find((t) => t.name === `github.${name}`)!;
      return JSON.parse(await found.run(found.inputSchema.parse({ env, ...input }))) as Answer;
    };
    const merged = await ask("pullRequests", "prod", { mergedSince: "2026-10-05T00:00:00Z" });
    assert.deepEqual(
      merged.evidence.map((e) => e.data.number),
      [421, 418, 412],
    );
    const cache = (await ask("pullRequest", "prod", { number: 412 })).evidence[0]!;
    assert.match(String(cache.data.description), /cache skips duplicate webhooks/);
    assert.deepEqual(cache.data.files, ["src/worker/confirm.js (+16 -6)"]);
    assert.equal((await ask("releases", "staging", {})).evidence[0]!.data.tag, "v2.14.0");
    assert.deepEqual(
      (await ask("commits", "prod", { path: "deploy", limit: 5 })).evidence.map((e) => e.data.subject),
      ["Lower the worker memory limit to 512Mi"],
    );
    assert.deepEqual(
      (await ask("issues", "prod", { labels: "perf" })).evidence.map((e) => e.data.number),
      [409],
    );
    const failed = await ask("workflowRuns", "prod", { status: "failure" });
    assert.deepEqual(
      failed.evidence.map((e) => e.data.branch),
      ["carol/worker-memory"],
    );
    assert.equal((await ask("workflowRuns", "prod", { branch: "main" })).evidence.length, 2);
    assert.match(await runCommand(await openToolbox(demo), "doctor", []), /github\s+loaded/);
  } finally {
    Object.values(servers).forEach((s) => s.close());
    for (const name of ["SHOP_API_PROD_URL", "SHOP_API_STAGING_URL", "GITHUB_TOKEN"]) delete process.env[name];
    Object.assign(process.env, keep);
  }
});

test("mock github: bad token, other repository, writes, unknown routes", async () => {
  const servers = await backend.start(demo, { prod: 0 });
  const base = `http://127.0.0.1:${(servers.prod!.address() as { port: number }).port}`;
  const auth = { authorization: `Bearer ${mock.GITHUB_TOKEN}` };
  try {
    assert.equal((await fetch(`${base}/repos/shop-co/shop/releases`)).status, 401);
    assert.equal(
      (await fetch(`${base}/repos/shop-co/shop/releases`, { headers: { authorization: "Bearer nope" } })).status,
      401,
    );
    assert.equal((await fetch(`${base}/repos/other/repo/releases`, { headers: auth })).status, 404);
    assert.equal((await fetch(`${base}/repos/shop-co/shop/pulls/9999`, { headers: auth })).status, 404);
    assert.equal((await fetch(`${base}/repos/shop-co/shop/hooks`, { headers: auth })).status, 404);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      assert.equal((await fetch(`${base}/repos/shop-co/shop/issues`, { method, headers: auth })).status, 405, method);
    }
    assert.equal((await fetch(`${base}/repos/SHOP-CO/Shop/releases`, { headers: auth })).status, 200);
  } finally {
    Object.values(servers).forEach((s) => s.close());
  }
});

test("github: a variable other tools export (GITHUB_API_URL, DD_SITE) does not set an addon up, a partial set says what is missing", async () => {
  const keep = { ...process.env };
  try {
    Object.assign(process.env, { GITHUB_API_URL: "https://api.github.com", DD_SITE: "datadoghq.eu" });
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_REPOS;
    const shared = await openToolbox(workspace(null));
    const names = createToolDefinitions(shared).map((t) => t.name);
    assert.ok(!names.some((n) => n.startsWith("github.") || n.startsWith("datadog.")), "no tool");
    assert.deepEqual(
      shared.addons!.filter((a) => a.notes.length),
      [],
      "and no warning",
    );

    process.env.GITHUB_TOKEN = "t";
    const partial = await openToolbox(workspace(null));
    assert.ok(!createToolDefinitions(partial).some((t) => t.name.startsWith("github.")));
    assert.match(await runCommand(partial, "doctor", []), /github\s+idle.*waiting for GITHUB_REPOS/);
  } finally {
    for (const name of ["GITHUB_API_URL", "DD_SITE", "GITHUB_TOKEN", "GITHUB_REPOS"]) {
      if (keep[name] === undefined) delete process.env[name];
      else process.env[name] = keep[name];
    }
  }
});
