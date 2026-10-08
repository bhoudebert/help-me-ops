// The shipped rest addon, against recorded responses (test/fixtures/rest): only
// GET, only the allowed prefixes, no redirects, no token in an error, and idle
// until an environment sets it up.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runCommand, startupNotices } from "../src/commands.ts";
import { openToolbox } from "../src/toolbox.ts";
import { createToolDefinitions } from "../src/tools/index.ts";

// The machine's own variables must not decide these tests.
for (const name of ["REST_BASE_URL", "REST_ALLOW", "REST_TOKEN", "REST_TOKEN_HEADER"]) delete process.env[name];

const recorded = (name: string) => readFileSync(join("test/fixtures/rest", name), "utf8");

function workspace(rest: Record<string, unknown> | null) {
  const root = mkdtempSync(join(tmpdir(), "ops-rest-"));
  const env = { sources: [], ...(rest ? { addons: { rest } } : {}) };
  writeFileSync(join(root, "ops.config.json"), JSON.stringify({ apps: { shop: { envs: { prod: env } } } }));
  return root;
}

const SETTINGS = { baseUrl: "https://api.test/v1", allow: "/orders,/health", token: "s3cret" };

interface Call {
  url: string;
  method?: string;
  headers: Record<string, string>;
  redirect?: string;
}

/** Runs `body` with a fake fetch answering from `answer`; returns the calls it saw. */
async function withFetch(answer: (url: string) => Response | Promise<Response>, body: () => Promise<void>) {
  const calls: Call[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method,
      headers: init?.headers as Record<string, string>,
      redirect: init?.redirect,
    });
    return answer(String(url));
  }) as typeof fetch;
  try {
    await body();
  } finally {
    globalThis.fetch = real;
  }
  return calls;
}

const json = (name: string) => new Response(recorded(name), { headers: { "content-type": "application/json" } });
const tool = async (root: string) => createToolDefinitions(await openToolbox(root)).find((t) => t.name === "rest.get")!;
type Answer = { evidence: { at: string | null; summary: string; data: Record<string, unknown> }[] };

test("rest: a list becomes one evidence per item, with its time, through a GET with the bearer token", async () => {
  const root = workspace(SETTINGS);
  const calls = await withFetch(
    () => json("orders-list.json"),
    async () => {
      const answer = JSON.parse(
        await (await tool(root)).run({ path: "/orders", query: "status=awaiting_payment" }),
      ) as Answer;
      assert.deepEqual(
        answer.evidence.map((e) => [e.at, e.data.id]),
        [
          ["2026-10-07T09:58:13Z", "4512"],
          ["2026-10-07T10:00:31Z", "4513"],
        ],
      );
      assert.match(answer.evidence[0]!.summary, /id=4512 .*status=awaiting_payment/);
    },
  );
  assert.deepEqual(calls, [
    {
      url: "https://api.test/v1/orders?status=awaiting_payment",
      method: "GET",
      headers: { accept: "application/json", authorization: "Bearer s3cret" },
      redirect: "manual",
    },
  ]);
});

test("rest: one object is one record; another header carries the token as is; no token, no header", async () => {
  const calls = await withFetch(
    () => json("health.json"),
    async () => {
      const keyed = await tool(workspace({ ...SETTINGS, tokenHeader: "X-Api-Key" }));
      const answer = JSON.parse(await keyed.run({ path: "/health" })) as Answer;
      assert.equal(answer.evidence.length, 1);
      assert.equal(answer.evidence[0]!.at, "2026-10-07T10:01:00Z");
      assert.equal(answer.evidence[0]!.data.queue_depth, 1240);
      await (await tool(workspace({ baseUrl: SETTINGS.baseUrl, allow: SETTINGS.allow }))).run({ path: "/health/live" });
    },
  );
  assert.deepEqual(calls[0]!.headers, { accept: "application/json", "x-api-key": "s3cret" });
  assert.deepEqual(calls[1]!.headers, { accept: "application/json" });
});

test("rest: only allowed paths on the same host can be read, and nothing is requested otherwise", async () => {
  const root = workspace(SETTINGS);
  const calls = await withFetch(
    () => json("health.json"),
    async () => {
      const rest = await tool(root);
      for (const [path, why] of [
        ["/admin/users", /not under an allowed prefix/],
        ["/ordersx", /not under an allowed prefix/],
        ["/orders/../admin", /may not go up/],
        ["/orders/%2e%2e/admin", /may not go up/],
        ["//evil.example/orders", /single \//],
        ["orders", /single \//],
        ["/orders?x=1", /put the query in "query"/],
        ["/orders#frag", /put the query in "query"/],
        ["/orders\\..\\admin", /put the query in "query"/],
      ] as const) {
        await assert.rejects(rest.run({ path }), why, path);
      }
    },
  );
  assert.deepEqual(calls, []);
});

test("rest: a redirect, an error status and a failure are refused, and the token stays out of the message", async () => {
  const root = workspace(SETTINGS);
  await withFetch(
    () => new Response(null, { status: 302, headers: { location: "https://evil.example/" } }),
    async () => await assert.rejects((await tool(root)).run({ path: "/orders" }), /redirected \(302\)/),
  );
  await withFetch(
    () => new Response("no", { status: 500 }),
    async () => await assert.rejects((await tool(root)).run({ path: "/orders" }), /answered 500/),
  );
  await withFetch(
    () => {
      throw new Error("connection refused with Bearer s3cret");
    },
    async () =>
      await assert.rejects(
        (await tool(root)).run({ path: "/orders" }),
        (error: Error) => /connection refused/.test(error.message) && !error.message.includes("s3cret"),
      ),
  );
  await withFetch(
    () => new Response("x".repeat(1_000_001)),
    async () => await assert.rejects((await tool(root)).run({ path: "/orders" }), /larger than/),
  );
});

test("rest: an answer that is not JSON comes back as text", async () => {
  await withFetch(
    () => new Response("all systems nominal", { headers: { "content-type": "text/plain" } }),
    async () => {
      const answer = JSON.parse(await (await tool(workspace(SETTINGS))).run({ path: "/health" })) as Answer;
      assert.equal(answer.evidence[0]!.summary, "all systems nominal");
    },
  );
});

test("rest: set up with environment variables only", async () => {
  const keep = { ...process.env };
  Object.assign(process.env, { REST_BASE_URL: "https://api.test", REST_ALLOW: "/health" });
  try {
    await withFetch(
      () => json("health.json"),
      async () => {
        const answer = JSON.parse(await (await tool(workspace({}))).run({ path: "/health" })) as Answer;
        assert.equal(answer.evidence.length, 1);
      },
    );
  } finally {
    for (const name of ["REST_BASE_URL", "REST_ALLOW"]) {
      if (keep[name] === undefined) delete process.env[name];
    }
  }
});

test("rest: shipped with the kit but idle, silent and without tools, until an environment sets it up", async () => {
  const toolbox = await openToolbox(workspace(null));
  const names = createToolDefinitions(toolbox).map((t) => t.name);
  assert.ok(!names.includes("rest.get"));
  const doctor = await runCommand(toolbox, "doctor", []);
  assert.match(doctor, /rest\s+idle\s+\(built-in\).*add "addons": \{ "rest"/);
  assert.doesNotMatch(startupNotices(toolbox).join("\n"), /addon:.*rest/);
  assert.ok(await tool(workspace(SETTINGS)), "set up, the tool is served");
});

test("rest: in an environment without settings the tool says what to add", async () => {
  const root = mkdtempSync(join(tmpdir(), "ops-rest-"));
  const envs = { prod: { sources: [], addons: { rest: SETTINGS } }, staging: { sources: [] } };
  writeFileSync(join(root, "ops.config.json"), JSON.stringify({ apps: { shop: { envs } } }));
  const rest = await tool(root);
  await assert.rejects(rest.run({ env: "staging", path: "/health" }), /not set up: add "addons"/);
});
