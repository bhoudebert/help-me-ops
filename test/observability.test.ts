// The shipped prometheus, loki and elasticsearch addons. Without a cluster, two ways:
//  1. against recorded responses in each API's documented shapes (test/fixtures/...):
//     the requests built and what is made of the answers;
//  2. over real HTTP against the demo's mocks (the live backend).
// Neither proves a real service accepts the requests: the addons are experimental.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { runCommand } from "../src/commands.ts";
import { openToolbox } from "../src/toolbox.ts";
import { createToolDefinitions } from "../src/tools/index.ts";

// The machine's own variables must not decide these tests.
for (const name of Object.keys(process.env))
  if (/^(PROMETHEUS|LOKI|ELASTICSEARCH)_/.test(name)) delete process.env[name];

const fixture = (path: string) => readFileSync(join("test/fixtures", path), "utf8");
const ok = (path: string) => new Response(fixture(path), { headers: { "content-type": "application/json" } });

function workspace(addon: string, settings: Record<string, unknown> | null) {
  const root = mkdtempSync(join(tmpdir(), "ops-obs-"));
  const env = { sources: [], ...(settings ? { addons: { [addon]: settings } } : {}) };
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

type Answer = { evidence: { at: string | null; summary: string; data: Record<string, any> }[] };
async function run(addon: string, name: string, input: Record<string, unknown>, settings: Record<string, unknown>) {
  const tool = createToolDefinitions(await openToolbox(workspace(addon, settings))).find(
    (t) => t.name === `${addon}.${name}`,
  )!;
  return JSON.parse(await tool.run(tool.inputSchema.parse(input))) as Answer;
}
const P = { baseUrl: "http://prom.test:9090/base/", authorization: "Bearer s3cret-token", orgId: "shop" };
const L = { baseUrl: "http://loki.test:3100", authorization: "Bearer s3cret-token", orgId: "shop" };
const E = { baseUrl: "https://es.test:9200", indices: "logs-shop-*,app-logs", authorization: "ApiKey s3cret-token" };
const times = { from: "2026-10-07T09:40:00Z", to: "2026-10-07T10:40:00Z" };

// ---------------------------------------------------------------- prometheus

test("prometheus: a GET of query_range with start, end and step in seconds, the credentials and the tenant", async () => {
  const calls = await withFetch(
    () => ok("prometheus/query-range.json"),
    async () => {
      const { evidence } = await run(
        "prometheus",
        "queryRange",
        { query: 'payment_confirm_queue_depth{env="prod"}', ...times, step: "1m" },
        P,
      );
      assert.deepEqual(
        evidence.map((e) => [e.at, e.data.value]),
        [
          ["2026-10-07T09:40:00.000Z", 12],
          ["2026-10-07T09:50:00.000Z", 620],
          ["2026-10-07T10:01:00.000Z", 1240],
          ["2026-10-07T09:40:00.000Z", 3],
        ],
      );
      assert.equal(evidence[2]!.summary, 'payment_confirm_queue_depth{env="prod",job="shop-worker"} = 1240');
    },
  );
  const [call] = calls;
  assert.equal(call!.method, "GET");
  assert.equal(call!.redirect, "manual");
  assert.equal(call!.url.pathname, "/base/api/v1/query_range", "a path prefix is kept");
  assert.deepEqual(Object.fromEntries(call!.url.searchParams), {
    query: 'payment_confirm_queue_depth{env="prod"}',
    start: String(Date.parse(times.from) / 1000),
    end: String(Date.parse(times.to) / 1000),
    step: "60",
  });
  assert.deepEqual(call!.headers, {
    accept: "application/json",
    authorization: "Bearer s3cret-token",
    "x-scope-orgid": "shop",
  });
});

test("prometheus: instant queries (vector and scalar), the alerts and their state filter, no credentials when none are set", async () => {
  await withFetch(
    (call) => ok(call.url.pathname.endsWith("/alerts") ? "prometheus/alerts.json" : "prometheus/query-vector.json"),
    async () => {
      const [point] = (await run("prometheus", "query", { query: "worker_memory_mb", at: "2026-10-07T10:00:30Z" }, P))
        .evidence;
      assert.equal(point!.summary, 'worker_memory_mb{env="prod"} = 498');
      assert.equal(point!.at, "2026-10-07T10:00:30.500Z");
      const all = (await run("prometheus", "alerts", {}, P)).evidence;
      assert.deepEqual(
        all.map((a) => [a.at, a.data.state, a.data.name]),
        [
          ["2026-10-07T10:00:00Z", "firing", "PaymentQueueBackingUp"],
          ["2026-10-07T10:05:00Z", "pending", "DiskFillingUp"],
        ],
      );
      assert.equal(all[0]!.summary, "alert PaymentQueueBackingUp (page) firing: payment-confirm queue above 1000 jobs");
      assert.deepEqual(
        (await run("prometheus", "alerts", { state: "pending" }, P)).evidence.map((a) => a.data.name),
        ["DiskFillingUp"],
      );
    },
  );
  await withFetch(
    () => ok("prometheus/query-scalar.json"),
    async () =>
      assert.equal(
        (await run("prometheus", "query", { query: "40 + 2" }, { baseUrl: "http://p.test" })).evidence[0]!.summary,
        "(scalar) = 42",
      ),
  );
  const calls = await withFetch(
    () => ok("prometheus/alerts.json"),
    async () => void (await run("prometheus", "alerts", {}, { baseUrl: "http://p.test" })),
  );
  assert.deepEqual(calls[0]!.headers, { accept: "application/json" });
});

test("prometheus: a long series is thinned to about 50 points, the last one kept; refusals happen before any request", async () => {
  const values = Array.from({ length: 500 }, (_, i) => [1791366000 + i * 15, String(i)]);
  await withFetch(
    () =>
      Response.json({
        status: "success",
        data: { resultType: "matrix", result: [{ metric: { __name__: "m" }, values }] },
      }),
    async () => {
      const { evidence } = await run("prometheus", "queryRange", { query: "m", ...times }, P);
      assert.ok(evidence.length > 40 && evidence.length <= 51);
      assert.equal(evidence.at(-1)!.data.value, 499);
    },
  );
  const calls = await withFetch(
    () => ok("prometheus/query-range.json"),
    async () => {
      const refuse = (input: Record<string, unknown>, why: RegExp) =>
        assert.rejects(run("prometheus", "queryRange", input, P), why);
      await refuse({ query: "  " }, /query must not be empty/);
      await refuse({ query: "x".repeat(2001) }, /longer than 2000/);
      await refuse({ query: "m", from: "yesterday" }, /ISO 8601 or relative/);
      await refuse({ query: "m", from: "2026-10-07T11:00:00Z", to: "2026-10-07T10:00:00Z" }, /from must be before to/);
      await refuse({ query: "m", step: "fast" }, /step "fast" must be a number and a unit/);
      await refuse(
        { query: "m", from: "2026-01-01T00:00:00Z", to: "2026-10-01T00:00:00Z", step: "15s" },
        /more than 11000 points/,
      );
    },
  );
  assert.deepEqual(calls, []);
});

test("prometheus errors: the reason of a bad query, refused credentials, limits, a redirect, not Prometheus; the header never shows", async () => {
  for (const [response, expected] of [
    [
      Response.json({ status: "error", errorType: "bad_data", error: 'parse error: unexpected "}"' }, { status: 400 }),
      /could not run the query: bad_data: parse error: unexpected "}"/,
    ],
    [
      new Response("denied s3cret-token", { status: 401 }),
      /refused the credentials \(401\).*authorization header, and the tenant/,
    ],
    [new Response("{}", { status: 429 }), /rate limit reached/],
    [Response.json({ status: "success", data: {} }, { status: 503 }), /overloaded or the query timed out/],
    [new Response("", { status: 301, headers: { location: "http://evil" } }), /redirected/],
    [new Response("<html>login</html>", { status: 200 }), /not JSON: is the URL the one of Prometheus/],
  ] as const) {
    await withFetch(
      () => response,
      async () =>
        await assert.rejects(
          run("prometheus", "query", { query: "up" }, P),
          (error: Error) => expected.test(error.message) && !error.message.includes("s3cret"),
        ),
    );
  }
});

// ---------------------------------------------------------------- loki

test("loki: a GET of query_range with ISO times, the limit capped, the direction; streams merged oldest first, nanoseconds kept to the millisecond", async () => {
  const calls = await withFetch(
    () => ok("loki/query-range.json"),
    async () => {
      const { evidence } = await run(
        "loki",
        "searchLogs",
        { query: '{app="shop"} |= "order"', ...times, limit: 500 },
        L,
      );
      assert.deepEqual(
        evidence.map((e) => [e.at, e.data.service, e.data.level]),
        [
          ["2026-10-07T10:00:02.000Z", "payments", "error"],
          ["2026-10-07T10:01:04.000Z", "worker", "error"],
          ["2026-10-07T10:02:02.123Z", "payments", "error"],
        ],
      );
      assert.equal(
        evidence[0]!.summary,
        "error payments: webhook endpoint /hooks/acme-pay returned 503 to provider (queue full)",
      );
      assert.deepEqual(evidence[1]!.data.labels, { service: "worker", level: "error", app: "shop" });
      const newest = (await run("loki", "searchLogs", { query: '{app="shop"}', ...times, newest: true, limit: 2 }, L))
        .evidence;
      assert.deepEqual(
        newest.map((e) => e.at),
        ["2026-10-07T10:02:02.123Z", "2026-10-07T10:01:04.000Z"],
      );
    },
  );
  const [call] = calls;
  assert.equal(call!.method, "GET");
  assert.equal(call!.url.pathname, "/loki/api/v1/query_range");
  assert.deepEqual(Object.fromEntries(call!.url.searchParams), {
    query: '{app="shop"} |= "order"',
    start: "2026-10-07T09:40:00.000Z",
    end: "2026-10-07T10:40:00.000Z",
    limit: "100",
    direction: "forward",
  });
  assert.equal(calls[1]!.url.searchParams.get("direction"), "backward");
  assert.deepEqual(call!.headers, {
    accept: "application/json",
    authorization: "Bearer s3cret-token",
    "x-scope-orgid": "shop",
  });
});

test("loki: the label names, the values of one label, and what is refused before any request", async () => {
  const calls = await withFetch(
    (call) => ok(call.url.pathname.endsWith("/values") ? "loki/label-values.json" : "loki/labels.json"),
    async () => {
      assert.equal((await run("loki", "labels", {}, L)).evidence[0]!.summary, "labels: app, level, service");
      const values = (await run("loki", "labels", { name: "service" }, L)).evidence[0]!;
      assert.equal(values.summary, "values of label service: api, payments, worker");
      assert.deepEqual(values.data.values, ["api", "payments", "worker"]);
      await assert.rejects(run("loki", "labels", { name: "service/../../x" }, L), /is not a label name/);
      await assert.rejects(run("loki", "searchLogs", { query: "" }, L), /query must not be empty/);
      await assert.rejects(run("loki", "searchLogs", { query: "x".repeat(2001) }, L), /longer than 2000/);
      await assert.rejects(
        run("loki", "searchLogs", { query: '{a="b"}', from: "2026-10-07T11:00:00Z", to: "2026-10-07T10:00:00Z" }, L),
        /from must be before to/,
      );
    },
  );
  assert.deepEqual(
    calls.map((c) => c.url.pathname),
    ["/loki/api/v1/labels", "/loki/api/v1/label/service/values"],
  );
});

test("loki errors: the reason of a bad query (plain text), credentials, limits, not found; the header never shows", async () => {
  for (const [response, expected] of [
    [
      new Response("parse error at line 1, col 1: syntax error: unexpected IDENTIFIER s3cret-token", { status: 400 }),
      /could not run the query: parse error at line 1/,
    ],
    [new Response("no org id", { status: 401 }), /refused the credentials \(401\).*tenant \(orgId\)/],
    [new Response("", { status: 429 }), /rate limit reached/],
    [new Response("404 page not found", { status: 404 }), /answered 404.*the tenant right/],
    [new Response("boom", { status: 502 }), /answered 502/],
    [new Response("<html>", { status: 200 }), /not JSON/],
  ] as const) {
    await withFetch(
      () => response,
      async () =>
        await assert.rejects(
          run("loki", "searchLogs", { query: '{a="b"}' }, L),
          (error: Error) => expected.test(error.message) && !error.message.includes("s3cret"),
        ),
    );
  }
});

// ---------------------------------------------------------------- elasticsearch

test("elasticsearch: a POST of a search body to the allowed indices, with a time range, the query string and a sort", async () => {
  const calls = await withFetch(
    () => ok("elasticsearch/search.json"),
    async () => {
      const { evidence } = await run(
        "elasticsearch",
        "search",
        { query: "service:payments AND level:error", ...times },
        E,
      );
      assert.deepEqual(
        evidence.map((e) => [e.at, e.data.id, e.summary]),
        [
          [
            "2026-10-07T10:00:02Z",
            "a1",
            "error payments: webhook endpoint /hooks/acme-pay returned 503 to provider (queue full)",
          ],
          ["2026-10-07T10:01:04Z", "a2", "error worker: container shop-worker-1 OOMKilled (exit 137)"],
        ],
      );
      assert.equal(evidence[0]!.data.index, "logs-shop-prod");
      assert.equal(evidence[1]!.data.level, "error", "log.level is found too");
    },
  );
  const [call] = calls;
  assert.equal(call!.method, "POST");
  assert.equal(call!.url.href, "https://es.test:9200/logs-shop-*,app-logs/_search");
  assert.equal(call!.redirect, "manual");
  assert.deepEqual(call!.headers, {
    accept: "application/json",
    "content-type": "application/json",
    authorization: "ApiKey s3cret-token",
  });
  assert.deepEqual(call!.body, {
    size: 50,
    track_total_hits: false,
    sort: [{ "@timestamp": { order: "asc" } }],
    query: {
      bool: {
        filter: [{ range: { "@timestamp": { gte: "2026-10-07T09:40:00.000Z", lte: "2026-10-07T10:40:00.000Z" } } }],
        must: [
          {
            query_string: {
              query: "service:payments AND level:error",
              default_operator: "AND",
              allow_leading_wildcard: false,
              analyze_wildcard: false,
            },
          },
        ],
      },
    },
  });
});

test("elasticsearch: only the indices of the setting can be searched; a field name, the size and the sort are settings or capped", async () => {
  const calls = await withFetch(
    () => ok("elasticsearch/search.json"),
    async () => {
      for (const index of [
        "other-logs",
        "_all",
        "*",
        "logs-shop-prod,secrets",
        "../_cluster",
        "-logs-shop-prod",
        "logs-shop-prod/../x",
      ]) {
        await assert.rejects(
          run("elasticsearch", "search", { query: "x", index }, E),
          /is not in the list this addon may search \(logs-shop-\*, app-logs\)/,
          index,
        );
      }
      for (const indices of ["*", "_all", "logs-*,_all", "", "-x"]) {
        await assert.rejects(
          run("elasticsearch", "search", { query: "x" }, { ...E, indices }),
          /no index|not an index or pattern to allow/,
          indices,
        );
      }
      await run("elasticsearch", "search", { query: "x", index: "logs-shop-prod" }, E);
      await run(
        "elasticsearch",
        "search",
        { query: "x", index: "logs-shop-*, app-logs", limit: 5000, newest: true },
        E,
      );
      await run("elasticsearch", "search", { query: "x" }, { ...E, timeField: "ts", messageField: "msg" });
      await assert.rejects(run("elasticsearch", "search", { query: "" }, E), /query must not be empty/);
      await assert.rejects(run("elasticsearch", "search", { query: "x".repeat(1001) }, E), /longer than 1000/);
      await assert.rejects(run("elasticsearch", "search", { query: "x", from: "soon" }, E), /ISO 8601 or relative/);
    },
  );
  assert.deepEqual(
    calls.map((c) => c.url.pathname),
    ["/logs-shop-prod/_search", "/logs-shop-*,app-logs/_search", "/logs-shop-*,app-logs/_search"],
  );
  assert.equal(calls[1]!.body.size, 100);
  assert.deepEqual(calls[1]!.body.sort, [{ "@timestamp": { order: "desc" } }]);
  assert.deepEqual(calls[2]!.body.sort, [{ ts: { order: "asc" } }]);
});

test("elasticsearch: a big document is cut to its scalar fields, and the errors say what the cluster said", async () => {
  const big = {
    "@timestamp": "2026-10-07T10:00:00Z",
    message: "big one",
    note: "x".repeat(5000),
    nested: { deep: "y".repeat(5000) },
    status: 7,
  };
  await withFetch(
    () => Response.json({ hits: { hits: [{ _index: "i", _id: "1", _source: big }] } }),
    async () => {
      const [hit] = (await run("elasticsearch", "search", { query: "big" }, E)).evidence;
      assert.deepEqual(Object.keys(hit!.data.source), ["@timestamp", "message", "note", "status"]);
      assert.equal(hit!.data.source.note.length, 300);
    },
  );
  for (const [response, expected] of [
    [
      new Response(fixture("elasticsearch/error-index.json"), { status: 404 }),
      /no such index: no such index \[logs-shop-nope\]/,
    ],
    [
      new Response(fixture("elasticsearch/error-query.json"), { status: 400 }),
      /could not run the search: Failed to parse query \[service:\(\]/,
    ],
    [new Response("{}", { status: 401 }), /refused the credentials \(401\).*can read logs-shop-\*,app-logs/],
    [new Response("{}", { status: 403 }), /refused the credentials \(403\)/],
    [new Response("{}", { status: 429 }), /rejecting searches \(429\)/],
    [new Response("", { status: 302, headers: { location: "http://evil" } }), /redirected the search/],
    [
      new Response("<html>proxy s3cret-token</html>", { status: 200 }),
      /not JSON: is the URL the one of Elasticsearch or OpenSearch/,
    ],
    [new Response("{}", { status: 500 }), /answered 500/],
  ] as const) {
    await withFetch(
      () => response,
      async () =>
        await assert.rejects(
          run("elasticsearch", "search", { query: "x" }, E),
          (error: Error) => expected.test(error.message) && !error.message.includes("s3cret"),
        ),
    );
  }
});

// ---------------------------------------------------------------- all three

test("the three addons: idle until set up, quiet with a shared variable, and nothing but their reads exist in the code", async () => {
  for (const addon of ["prometheus", "loki", "elasticsearch"]) {
    const idle = await openToolbox(workspace(addon, null));
    assert.ok(!createToolDefinitions(idle).some((t) => t.name.startsWith(`${addon}.`)), addon);
    assert.match(idle.addons!.find((a) => a.name === addon)!.reason ?? "", /no environment sets it up/);
    const source = readFileSync(`addons/${addon}/tools.ts`, "utf8");
    assert.equal(
      [...source.matchAll(/\bfetch\(/g)].length,
      addon === "elasticsearch" ? 1 : 1,
      `${addon}: one place makes requests`,
    );
    assert.deepEqual(
      [...source.matchAll(/method:\s*"(\w+)"/g)].map((m) => m[1]),
      [addon === "elasticsearch" ? "POST" : "GET"],
      addon,
    );
    assert.match(readFileSync(`addons/${addon}/addon.json`, "utf8"), /"description": "EXPERIMENTAL/);
  }
  const keep = { ...process.env };
  Object.assign(process.env, {
    PROMETHEUS_URL: "http://p",
    LOKI_URL: "http://l",
    ELASTICSEARCH_URL: "http://e",
    ELASTICSEARCH_INDICES: "logs-*",
  });
  try {
    const names = createToolDefinitions(await openToolbox(workspace("x", {}))).map((t) => t.name);
    assert.ok(
      names.includes("prometheus.alerts") && names.includes("loki.labels") && names.includes("elasticsearch.search"),
      "set up by variables alone",
    );
  } finally {
    for (const name of ["PROMETHEUS_URL", "LOKI_URL", "ELASTICSEARCH_URL", "ELASTICSEARCH_INDICES"])
      delete process.env[name];
    Object.assign(
      process.env,
      Object.fromEntries(Object.entries(keep).filter(([k]) => /^(PROMETHEUS|LOKI|ELASTICSEARCH)_/.test(k))),
    );
  }
  // elasticsearch needs both its URL and its indices: one of them is not a decision
  Object.assign(process.env, { ELASTICSEARCH_URL: "http://e" });
  try {
    const toolbox = await openToolbox(workspace("x", {}));
    assert.ok(!createToolDefinitions(toolbox).some((t) => t.name.startsWith("elasticsearch.")));
    assert.match(await runCommand(toolbox, "doctor", []), /elasticsearch\s+idle.*waiting for ELASTICSEARCH_INDICES/);
  } finally {
    delete process.env.ELASTICSEARCH_URL;
  }
});

// ---------------------------------------------------------------- the demo's mocks, over real HTTP

const demo = resolve("examples/my-workspace");
const backend = (await import(resolve(demo, "docker/backend/server.mjs"))) as {
  start(workspace: string, ports: Record<string, number>): Promise<Record<string, import("node:http").Server>>;
};

async function live(
  body: (
    ask: (tool: string, env: string, input: Record<string, unknown>) => Promise<Answer>,
    base: (env: string) => string,
  ) => Promise<void>,
) {
  const servers = await backend.start(demo, { prod: 0, staging: 0 });
  const base = (env: string) => `http://127.0.0.1:${(servers[env]!.address() as { port: number }).port}`;
  const keep = { ...process.env };
  Object.assign(process.env, {
    SHOP_API_PROD_URL: base("prod"),
    SHOP_API_STAGING_URL: base("staging"),
    PROMETHEUS_AUTHORIZATION: "Bearer demo-prom-token",
    LOKI_AUTHORIZATION: "Bearer demo-loki-token",
    ELASTICSEARCH_AUTHORIZATION: "ApiKey demo-es-key",
  });
  try {
    const tools = createToolDefinitions(await openToolbox(demo));
    await body(async (tool, env, input) => {
      const found = tools.find((t) => t.name === tool)!;
      return JSON.parse(await found.run(found.inputSchema.parse({ env, ...input }))) as Answer;
    }, base);
  } finally {
    Object.values(servers).forEach((s) => s.close());
    for (const name of [
      "SHOP_API_PROD_URL",
      "SHOP_API_STAGING_URL",
      "PROMETHEUS_AUTHORIZATION",
      "LOKI_AUTHORIZATION",
      "ELASTICSEARCH_AUTHORIZATION",
    ])
      delete process.env[name];
    Object.assign(
      process.env,
      Object.fromEntries(Object.entries(keep).filter(([k]) => /^(SHOP_API|PROMETHEUS|LOKI|ELASTICSEARCH)/.test(k))),
    );
  }
}

test("mock prometheus: the queue and memory curves of the demo, the alerts of prod and none in staging", async () => {
  await live(async (ask) => {
    const queue = await ask("prometheus.queryRange", "prod", {
      query: 'payment_confirm_queue_depth{env="prod"}',
      from: "2026-10-07T09:00:00Z",
      to: "2026-10-07T11:00:00Z",
    });
    assert.equal(queue.evidence.at(-1)!.data.value, 1240);
    assert.equal(queue.evidence.at(-1)!.at, "2026-10-07T10:01:00.000Z");
    assert.equal(
      (await ask("prometheus.query", "prod", { query: "worker_memory_mb", at: "2026-10-07T10:00:30Z" })).evidence[0]!
        .data.value,
      498,
    );
    assert.deepEqual(
      (await ask("prometheus.alerts", "prod", { state: "firing" })).evidence.map((a) => a.data.name),
      ["PaymentQueueBackingUp", "WorkerMemoryNearLimit"],
    );
    assert.deepEqual((await ask("prometheus.alerts", "staging", {})).evidence, []);
    const staging = await ask("prometheus.queryRange", "staging", {
      query: "worker_memory_mb",
      from: "2026-10-07T09:00:00Z",
      to: "2026-10-07T11:00:00Z",
    });
    assert.ok(staging.evidence.every((e) => (e.data.value as number) < 256));
    assert.deepEqual(
      (
        await ask("prometheus.queryRange", "prod", {
          query: 'worker_memory_mb{env="staging"}',
          from: "2026-10-07T09:00:00Z",
          to: "2026-10-07T11:00:00Z",
        })
      ).evidence,
      [],
    );
    await assert.rejects(
      ask("prometheus.query", "prod", { query: "rate(x[5m])" }),
      /could not run the query: bad_data: the demo's mock of Prometheus only understands a metric name/,
    );
  });
});

test("mock loki: the 503 of the demo found with a selector and a filter, the labels, and a LogQL it does not understand", async () => {
  await live(async (ask) => {
    const hit = await ask("loki.searchLogs", "prod", {
      query: '{service="payments", level="error"} |= "503"',
      from: "2026-10-07T09:00:00Z",
      to: "2026-10-07T11:00:00Z",
    });
    assert.deepEqual(
      hit.evidence.map((e) => e.at),
      ["2026-10-07T10:00:02.000Z"],
    );
    assert.match(hit.evidence[0]!.summary, /^error payments: webhook endpoint \/hooks\/acme-pay returned 503/);
    const not = await ask("loki.searchLogs", "prod", {
      query: '{app="shop", service="worker"} != "backlog"',
      from: "2026-10-07T09:00:00Z",
      to: "2026-10-07T11:00:00Z",
      limit: 3,
      newest: true,
    });
    assert.equal(not.evidence.length, 3);
    assert.ok(not.evidence.every((e) => !/backlog/.test(e.data.line)));
    assert.ok(not.evidence[0]!.at! > not.evidence[2]!.at!);
    assert.match(
      (await ask("loki.labels", "prod", {})).evidence[0]!.summary,
      /labels: app, detected_level, env, level, service/,
    );
    assert.match(
      (await ask("loki.labels", "staging", { name: "service" })).evidence[0]!.summary,
      /values of label service: /,
    );
    await assert.rejects(
      ask("loki.searchLogs", "prod", { query: '{app="shop"} | json' }),
      /could not run the query: parse error: the demo's mock of Loki only understands a stream selector/,
    );
    await assert.rejects(ask("loki.searchLogs", "prod", { query: "{}" }), /parse error|require at least one/);
  });
});

test("mock elasticsearch: the order and the errors of the demo with a query string, and what the mock refuses", async () => {
  await live(async (ask, base) => {
    const errors = await ask("elasticsearch.search", "prod", {
      query: "service:payments AND level:error",
      from: "2026-10-07T09:00:00Z",
      to: "2026-10-07T11:00:00Z",
    });
    assert.equal(errors.evidence.length, 1);
    assert.equal(errors.evidence[0]!.data.index, "shop-logs-prod");
    const order = await ask("elasticsearch.search", "prod", {
      query: 'order:4512 AND "webhook payment.succeeded"',
      from: "2026-10-07T09:00:00Z",
      to: "2026-10-07T11:00:00Z",
    });
    assert.ok(order.evidence.length >= 1 && order.evidence.every((e) => /4512/.test(e.summary)));
    const not = await ask("elasticsearch.search", "prod", {
      query: "order:4512 NOT webhook",
      from: "2026-10-07T09:00:00Z",
      to: "2026-10-07T11:00:00Z",
    });
    assert.ok(not.evidence.every((e) => !/webhook/.test(e.summary)));
    assert.deepEqual(
      (
        await ask("elasticsearch.search", "staging", {
          query: "level:error",
          from: "2026-10-07T09:00:00Z",
          to: "2026-10-07T11:00:00Z",
        })
      ).evidence,
      [],
    );
    await assert.rejects(ask("elasticsearch.search", "prod", { query: "a OR b" }), /does not understand "OR"/);
    await assert.rejects(ask("elasticsearch.search", "prod", { query: "pay*" }), /does not understand "pay\*"/);
    // the mock itself: credentials, other methods, an index that is not there
    assert.equal((await fetch(`${base("prod")}/shop-logs-prod/_search`, { method: "POST", body: "{}" })).status, 401);
    const auth = { authorization: "ApiKey demo-es-key" };
    assert.equal(
      (await fetch(`${base("prod")}/shop-logs-prod/_search`, { method: "DELETE", headers: auth })).status,
      405,
    );
    assert.equal(
      (await fetch(`${base("prod")}/other-index/_search`, { method: "POST", headers: auth, body: "{}" })).status,
      404,
    );
    assert.equal(
      (await fetch(`${base("prod")}/shop-logs-prod/_search`, { method: "POST", headers: auth, body: "{nope" })).status,
      400,
    );
    assert.equal((await fetch(`${base("prod")}/prometheus/api/v1/alerts`)).status, 401);
    assert.equal(
      (
        await fetch(`${base("prod")}/prometheus/api/v1/alerts`, {
          method: "POST",
          headers: { authorization: "Bearer demo-prom-token" },
        })
      ).status,
      405,
    );
    assert.equal(
      (await fetch(`${base("prod")}/loki/api/v1/labels`, { headers: { authorization: "Bearer demo-loki-token" } }))
        .status,
      401,
      "no tenant",
    );
    assert.equal(
      (
        await fetch(`${base("prod")}/loki/api/v1/labels`, {
          method: "POST",
          headers: { authorization: "Bearer demo-loki-token", "x-scope-orgid": "shop" },
        })
      ).status,
      405,
    );
    assert.match(await runCommand(await openToolbox(demo), "doctor", []), /prometheus\s+loaded/);
  });
});

test("mock loki: the query is read in one pass, so a long run of spaces answers at once", async () => {
  const { parseLogQL } = (await import(resolve(demo, "docker/backend/loki.mjs"))) as {
    parseLogQL(query: string): { matchers: unknown[]; filters: { negate: boolean; text: string }[] };
  };
  const started = Date.now();
  for (const query of [
    `{a="b"}${" ".repeat(100_000)}x`,
    `{a="b"} |=${" ".repeat(100_000)}x`,
    `{${" ".repeat(100_000)}`,
    `{a="b"}${' |= "x"'.repeat(5000)}`,
  ]) {
    try {
      parseLogQL(query);
    } catch {
      // refused: fine, what matters is how long it takes
    }
  }
  assert.ok(Date.now() - started < 1000, "no run-away backtracking");
  assert.deepEqual(parseLogQL('  {service="payments"}   |=  "503"  !=   "retry"  ').filters, [
    { negate: false, text: "503" },
    { negate: true, text: "retry" },
  ]);
  assert.throws(() => parseLogQL('{a="b"} |= x'), /a filter text in quotes/);
  assert.throws(() => parseLogQL('{a="b"} | json'), /a filter/);
  assert.throws(() => parseLogQL("service"), /no stream selector/);
});
