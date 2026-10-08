// The demo's live backend, over real HTTP on free ports, and the rest addon
// reading it: the same investigation as the files, from a running server.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { runCommand } from "../src/commands.ts";
import { openToolbox } from "../src/toolbox.ts";
import { createToolDefinitions } from "../src/tools/index.ts";

// The machine's own variables must not decide these tests.
for (const name of ["SHOP_API_PROD_URL", "SHOP_API_STAGING_URL", "SHOP_API_TOKEN"]) delete process.env[name];

const workspace = resolve("examples/my-workspace");
const module = (await import(resolve(workspace, "docker/backend/server.mjs"))) as {
  start(workspace: string, ports: Record<string, number>): Promise<Record<string, import("node:http").Server>>;
  DEMO_TOKEN: string;
};

async function backend() {
  const servers = await module.start(workspace, { prod: 0, staging: 0 });
  const url = (env: string) => `http://127.0.0.1:${(servers[env]!.address() as { port: number }).port}`;
  return { url, close: () => Object.values(servers).forEach((s) => s.close()) };
}

const get = (url: string, token: string | null = module.DEMO_TOKEN, method = "GET") =>
  fetch(url, { method, headers: token ? { authorization: `Bearer ${token}` } : {} });

test("backend: orders and health of each environment, behind a token, read-only", async () => {
  const live = await backend();
  try {
    const prod = (await (await get(`${live.url("prod")}/orders?status=awaiting_payment`)).json()) as { id: string }[];
    assert.deepEqual(
      prod.map((o) => o.id),
      ["4512", "4513", "4514"],
    );
    const since = (await (await get(`${live.url("prod")}/orders?since=2026-10-07T10:00:00Z`)).json()) as {
      id: string;
    }[];
    assert.deepEqual(
      since.map((o) => o.id),
      ["4513", "4514"],
    );
    assert.equal(((await (await get(`${live.url("prod")}/orders/4512`)).json()) as { user: string }).user, "u-881");
    assert.deepEqual(
      ((await (await get(`${live.url("staging")}/orders`)).json()) as { id: string }[]).map((o) => o.id),
      ["88"],
    );
    const health = (await (await get(`${live.url("prod")}/health`)).json()) as { status: number }[];
    assert.ok(health.some((check) => check.status === 503));

    assert.equal((await get(`${live.url("prod")}/orders`, null)).status, 401);
    assert.equal((await get(`${live.url("prod")}/orders`, "wrong")).status, 401);
    assert.equal((await get(`${live.url("prod")}/orders/9999`)).status, 404);
    assert.equal((await get(`${live.url("prod")}/nope`)).status, 404);
    for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
      assert.equal((await get(`${live.url("prod")}/orders/4512`, module.DEMO_TOKEN, method)).status, 405, method);
    }
  } finally {
    live.close();
  }
});

test("backend: the rest addon reads it live, per environment, and refuses what is not allowed", async () => {
  const live = await backend();
  const keep = { ...process.env };
  Object.assign(process.env, {
    SHOP_API_PROD_URL: live.url("prod"),
    SHOP_API_STAGING_URL: live.url("staging"),
    SHOP_API_TOKEN: module.DEMO_TOKEN,
  });
  try {
    const toolbox = await openToolbox(workspace);
    const rest = createToolDefinitions(toolbox).find((t) => t.name === "rest.get")!;
    const stuck = JSON.parse(await rest.run({ env: "prod", path: "/orders", query: "status=awaiting_payment" })) as {
      evidence: { at: string; data: { id: string } }[];
    };
    assert.deepEqual(
      stuck.evidence.map((e) => [e.data.id, e.at]),
      [
        ["4512", "2026-10-07T09:58:13Z"],
        ["4513", "2026-10-07T10:00:31Z"],
        ["4514", "2026-10-07T10:03:06Z"],
      ],
    );
    const staging = JSON.parse(await rest.run({ env: "staging", path: "/orders" })) as { evidence: unknown[] };
    assert.equal(staging.evidence.length, 1);
    await assert.rejects(rest.run({ env: "prod", path: "/admin" }), /not under an allowed prefix/);
    assert.match(await runCommand(toolbox, "doctor", []), /rest\s+loaded/);
  } finally {
    live.close();
    for (const name of ["SHOP_API_PROD_URL", "SHOP_API_STAGING_URL", "SHOP_API_TOKEN"]) delete process.env[name];
    Object.assign(process.env, keep);
  }
});

test("backend: the demo's rest addon waits for its variables, silent and without tools", async () => {
  const toolbox = await openToolbox(workspace);
  assert.ok(!createToolDefinitions(toolbox).some((t) => t.name === "rest.get"));
  const doctor = await runCommand(toolbox, "doctor", []);
  assert.match(doctor, /rest\s+idle.*waiting for SHOP_API_PROD_URL, SHOP_API_STAGING_URL/);
});
