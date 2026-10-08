// The shipped datadog addon. Two ways, both without a Datadog account:
//  1. against recorded responses in Datadog's documented shapes
//     (test/fixtures/datadog): the requests it builds, what it makes of the answers;
//  2. over real HTTP against the demo's fake Datadog (the live backend).
// Neither proves a real Datadog accepts the requests: see docs/guide/shipped-addons.md.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { openToolbox } from "../src/toolbox.ts";
import { createToolDefinitions } from "../src/tools/index.ts";

const recorded = (name: string) => readFileSync(join("test/fixtures/datadog", name), "utf8");
const KEYS = { apiKey: "api-s3cret", appKey: "app-s3cret" };

function workspace(settings: Record<string, unknown> | null) {
  const root = mkdtempSync(join(tmpdir(), "ops-dd-"));
  const env = { sources: [], ...(settings ? { addons: { datadog: settings } } : {}) };
  writeFileSync(join(root, "ops.config.json"), JSON.stringify({ apps: { shop: { envs: { prod: env } } } }));
  return root;
}

interface Call {
  url: URL;
  method?: string;
  headers: Record<string, string>;
  body?: any;
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
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
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
  createToolDefinitions(await openToolbox(root)).find((t) => t.name === `datadog.${name}`)!;
const ok = (name: string) => new Response(recorded(name), { headers: { "content-type": "application/json" } });
type Answer = { evidence: { at: string | null; summary: string; data: Record<string, any> }[] };

test("datadog logs: a POST of the documented search body, with both keys, to the site's API", async () => {
  const root = workspace({ ...KEYS, site: "datadoghq.eu" });
  const calls = await withFetch(
    () => ok("logs-search.json"),
    async () => {
      const search = await tool(root, "searchLogs");
      const answer = JSON.parse(
        await search.run({
          query: "service:payments status:error",
          from: "2026-10-07T09:00:00Z",
          to: "2026-10-07T11:00:00Z",
          limit: 20,
        }),
      ) as Answer;
      assert.deepEqual(
        answer.evidence.map((e) => [e.at, e.summary]),
        [
          [
            "2026-10-07T10:00:02Z",
            "error payments: webhook endpoint /hooks/acme-pay returned 503 to provider (queue full)",
          ],
          ["2026-10-07T10:01:04Z", "error worker: container shop-worker-1 OOMKilled (exit 137), restart 1"],
        ],
      );
      assert.equal(answer.evidence[0]!.data.host, "shop-prod-1");
    },
  );
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call!.url.href, "https://api.datadoghq.eu/api/v2/logs/events/search");
  assert.equal(call!.method, "POST");
  assert.equal(call!.redirect, "manual");
  assert.deepEqual(call!.headers, {
    accept: "application/json",
    "DD-API-KEY": "api-s3cret",
    "DD-APPLICATION-KEY": "app-s3cret",
    "content-type": "application/json",
  });
  assert.deepEqual(call!.body, {
    filter: {
      query: "service:payments status:error",
      from: "2026-10-07T09:00:00.000Z",
      to: "2026-10-07T11:00:00.000Z",
    },
    sort: "timestamp",
    page: { limit: 20 },
  });
});

test("datadog logs: relative times, newest first, and the limit is capped at 100", async () => {
  const root = workspace({ ...KEYS });
  const before = Date.now();
  const calls = await withFetch(
    () => ok("logs-search.json"),
    async () => {
      await (await tool(root, "searchLogs")).run({ query: "*", from: "now-15m", limit: 5000, newest: true });
    },
  );
  const { filter, sort, page } = calls[0]!.body;
  assert.equal(calls[0]!.url.hostname, "api.datadoghq.com");
  assert.equal(sort, "-timestamp");
  assert.equal(page.limit, 100);
  assert.ok(Date.parse(filter.to) >= before);
  assert.ok(Math.abs(Date.parse(filter.to) - Date.parse(filter.from) - 15 * 60_000) < 2000);
});

test("datadog metrics: a GET with epoch seconds, a series becomes points, nulls are dropped", async () => {
  const root = workspace({ ...KEYS });
  const calls = await withFetch(
    () => ok("metric-query.json"),
    async () => {
      const answer = JSON.parse(
        await (
          await tool(root, "queryMetric")
        ).run({
          query: "avg:payment_confirm_queue_depth{env:prod}",
          from: "2026-10-07T09:40:00Z",
          to: "2026-10-07T10:40:00Z",
        }),
      ) as Answer;
      assert.deepEqual(
        answer.evidence.map((e) => [e.at, e.data.value]),
        [
          ["2026-10-07T09:40:00.000Z", 12],
          ["2026-10-07T09:50:00.000Z", 620],
          ["2026-10-07T10:01:00.000Z", 1240],
        ],
      );
      assert.equal(answer.evidence[2]!.summary, "payment_confirm_queue_depth{env:prod} = 1240");
    },
  );
  const [call] = calls;
  assert.equal(call!.method, "GET");
  assert.equal(call!.url.pathname, "/api/v1/query");
  assert.equal(call!.url.searchParams.get("query"), "avg:payment_confirm_queue_depth{env:prod}");
  assert.equal(call!.url.searchParams.get("from"), String(Date.parse("2026-10-07T09:40:00Z") / 1000));
  assert.equal(call!.url.searchParams.get("to"), String(Date.parse("2026-10-07T10:40:00Z") / 1000));
  assert.equal(call!.body, undefined);
});

test("datadog metrics: a long series is thinned to 50 points, the last one kept", async () => {
  const pointlist = Array.from({ length: 500 }, (_, i) => [1791364800000 + i * 60_000, i]);
  await withFetch(
    () => Response.json({ status: "ok", series: [{ metric: "m", display_name: "m", scope: "*", pointlist }] }),
    async () => {
      const answer = JSON.parse(
        await (await tool(workspace({ ...KEYS }), "queryMetric")).run({ query: "avg:m{*}" }),
      ) as Answer;
      assert.ok(answer.evidence.length <= 51 && answer.evidence.length >= 40);
      assert.equal(answer.evidence.at(-1)!.data.value, 499);
    },
  );
  await withFetch(
    () => Response.json({ status: "error", error: "Error parsing query: unable to parse avg:" }),
    async () => {
      await assert.rejects(
        (await tool(workspace({ ...KEYS }), "queryMetric")).run({ query: "avg:" }),
        /could not run the query: Error parsing/,
      );
    },
  );
});

test("datadog monitors: a GET of the list with filters, state and time as evidence", async () => {
  const calls = await withFetch(
    () => ok("monitors.json"),
    async () => {
      const answer = JSON.parse(
        await (await tool(workspace({ ...KEYS }), "monitors")).run({ name: "queue", tag: "env:prod" }),
      ) as Answer;
      assert.deepEqual(
        answer.evidence.map((e) => [e.at, e.summary]),
        [
          ["2026-10-07T10:00:00Z", 'monitor "Payment confirm queue is backing up": Alert'],
          ["2026-10-06T08:00:00Z", 'monitor "Checkout error rate": OK'],
        ],
      );
    },
  );
  assert.equal(calls[0]!.method, "GET");
  assert.equal(calls[0]!.url.pathname, "/api/v1/monitor");
  assert.equal(calls[0]!.url.searchParams.get("name"), "queue");
  assert.equal(calls[0]!.url.searchParams.get("monitor_tags"), "env:prod");
});

test("datadog: only its three endpoints, a bad time or site is refused before any request", async () => {
  const calls = await withFetch(
    () => ok("monitors.json"),
    async () => {
      await assert.rejects(
        (await tool(workspace({ ...KEYS }), "searchLogs")).run({ query: "*", from: "yesterday", limit: 5 }),
        /must be ISO 8601 or relative/,
      );
      await assert.rejects(
        (await tool(workspace({ ...KEYS, site: "evil.com/x?" }), "monitors")).run({}),
        /is not a Datadog site/,
      );
    },
  );
  assert.deepEqual(calls, []);
});

test("datadog errors: refused keys, rate limit, redirect, other status; the keys never show", async () => {
  for (const [response, expected] of [
    [
      new Response('{"errors":["Forbidden"]}', { status: 403 }),
      /refused the keys \(403\).*API key, the application key/,
    ],
    [new Response("", { status: 429 }), /rate limit reached/],
    [new Response("", { status: 302, headers: { location: "https://evil.example" } }), /redirected/],
    [new Response("boom api-s3cret app-s3cret", { status: 500 }), /answered 500/],
  ] as const) {
    await withFetch(
      () => response,
      async () =>
        await assert.rejects(
          (await tool(workspace({ ...KEYS }), "monitors")).run({}),
          (error: Error) => expected.test(error.message) && !error.message.includes("s3cret"),
        ),
    );
  }
});

test("datadog: shipped idle, set up by DD_API_KEY alone is enough to serve its tools", async () => {
  const idle = await openToolbox(workspace(null));
  assert.ok(!createToolDefinitions(idle).some((t) => t.name.startsWith("datadog.")));
  assert.match(idle.addons!.find((a) => a.name === "datadog")!.reason ?? "", /no environment sets it up/);
  const keep = { ...process.env };
  Object.assign(process.env, { DD_API_KEY: "k", DD_APP_KEY: "a" });
  try {
    const names = createToolDefinitions(await openToolbox(workspace({}))).map((t) => t.name);
    assert.deepEqual(
      names.filter((n) => n.startsWith("datadog.")),
      ["datadog.searchLogs", "datadog.queryMetric", "datadog.monitors"],
    );
  } finally {
    for (const name of ["DD_API_KEY", "DD_APP_KEY"]) if (keep[name] === undefined) delete process.env[name];
  }
});

// ---- the demo's fake Datadog, over real HTTP ----

const demo = resolve("examples/my-workspace");
const backend = (await import(resolve(demo, "docker/backend/server.mjs"))) as {
  start(workspace: string, ports: Record<string, number>): Promise<Record<string, import("node:http").Server>>;
};
const datadog = (await import(resolve(demo, "docker/backend/datadog.mjs"))) as {
  DD_API_KEY: string;
  DD_APP_KEY: string;
};

async function live(
  body: (run: (name: string, env: string, input: Record<string, unknown>) => Promise<Answer>) => Promise<void>,
) {
  const servers = await backend.start(demo, { prod: 0, staging: 0 });
  const url = (env: string) => `http://127.0.0.1:${(servers[env]!.address() as { port: number }).port}`;
  const keep = { ...process.env };
  Object.assign(process.env, {
    SHOP_API_PROD_URL: url("prod"),
    SHOP_API_STAGING_URL: url("staging"),
    SHOP_API_TOKEN: "demo-token",
    DD_API_KEY: datadog.DD_API_KEY,
    DD_APP_KEY: datadog.DD_APP_KEY,
  });
  try {
    const tools = createToolDefinitions(await openToolbox(demo));
    await body(async (name, env, input) => {
      const found = tools.find((t) => t.name === `datadog.${name}`)!;
      return JSON.parse(await found.run(found.inputSchema.parse({ env, ...input }))) as Answer;
    });
  } finally {
    Object.values(servers).forEach((s) => s.close());
    for (const name of ["SHOP_API_PROD_URL", "SHOP_API_STAGING_URL", "SHOP_API_TOKEN", "DD_API_KEY", "DD_APP_KEY"])
      delete process.env[name];
    Object.assign(process.env, keep);
  }
}

test("fake datadog: the demo incident, found through the datadog addon over HTTP", async () => {
  await live(async (run) => {
    const errors = await run("searchLogs", "prod", {
      query: "service:payments status:error",
      from: "2026-10-07T09:00:00Z",
    });
    assert.ok(
      errors.evidence.some((e) => e.at === "2026-10-07T10:00:02Z" && /returned 503 to provider/.test(e.summary)),
    );
    const order = await run("searchLogs", "prod", { query: "@order:4512", from: "2026-10-07T08:00:00Z" });
    assert.ok(order.evidence.length >= 4 && order.evidence.every((e) => /4512/.test(e.summary)));
    assert.equal(
      (
        await run("searchLogs", "prod", { query: "-service:payments status:error", from: "2026-10-07T08:00:00Z" })
      ).evidence.every((e) => !e.summary.includes("payments:")),
      true,
    );
    assert.equal(
      (await run("searchLogs", "staging", { query: "status:error", from: "2026-10-07T08:00:00Z" })).evidence.length,
      0,
    );

    const queue = await run("queryMetric", "prod", {
      query: "avg:payment_confirm_queue_depth{*}",
      from: "2026-10-07T09:00:00Z",
      to: "2026-10-07T11:00:00Z",
    });
    assert.equal(queue.evidence.at(-1)!.data.value, 1240);
    assert.equal(queue.evidence.at(-1)!.at, "2026-10-07T10:01:00.000Z");
    assert.equal(
      (await run("queryMetric", "prod", { query: "avg:no_such_metric{*}", from: "2026-10-07T08:00:00Z" })).evidence
        .length,
      0,
    );

    const alerting = await run("monitors", "prod", { name: "queue" });
    assert.deepEqual(
      alerting.evidence.map((e) => e.data.state),
      ["Alert"],
    );
    assert.ok((await run("monitors", "staging", {})).evidence.every((e) => e.data.state === "OK"));
    assert.equal((await run("monitors", "prod", { tag: "team:shop" })).evidence.length, 3);
  });
});

test("fake datadog: a wrong key is a 403, an unsupported query is said, other routes are refused", async () => {
  const servers = await backend.start(demo, { prod: 0 });
  const base = `http://127.0.0.1:${(servers.prod!.address() as { port: number }).port}`;
  const keys = { "DD-API-KEY": datadog.DD_API_KEY, "DD-APPLICATION-KEY": datadog.DD_APP_KEY };
  try {
    assert.equal((await fetch(`${base}/api/v1/monitor`)).status, 403);
    assert.equal(
      (await fetch(`${base}/api/v1/monitor`, { headers: { ...keys, "DD-APPLICATION-KEY": "nope" } })).status,
      403,
    );
    const or = await fetch(`${base}/api/v2/logs/events/search`, {
      method: "POST",
      headers: keys,
      body: JSON.stringify({ filter: { query: "a OR b" } }),
    });
    assert.equal(or.status, 400);
    assert.match(((await or.json()) as { errors: string[] }).errors[0]!, /does not understand "OR"/);
    assert.equal((await fetch(`${base}/api/v1/dashboard`, { headers: keys })).status, 404);
    assert.equal((await fetch(`${base}/api/v1/monitor`, { method: "DELETE", headers: keys })).status, 405);
    assert.equal((await fetch(`${base}/api/v2/logs/events/search`, { headers: keys })).status, 405);
    assert.equal((await fetch(`${base}/api/v1/query?query=junk&from=1&to=2`, { headers: keys })).status, 400);
    const page = await fetch(`${base}/api/v2/logs/events/search`, {
      method: "POST",
      headers: keys,
      body: JSON.stringify({ filter: { query: "*", from: "2026-10-07T09:00:00Z" }, page: { limit: 2 } }),
    });
    const first = (await page.json()) as { data: unknown[]; meta: { page: { after?: string } } };
    assert.equal(first.data.length, 2);
    assert.equal(first.meta.page.after, "2");
  } finally {
    Object.values(servers).forEach((s) => s.close());
  }
});
