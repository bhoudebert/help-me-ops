// The MCP server over HTTP (ADR 0015): a team's one server. Against the real SDK
// client, on a free local port, with the demo workspace.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { request } from "node:http";
import { resolve } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { HTTP_DEFAULTS, newToken, parseTokens, startHttpServer, type HttpOptions } from "../src/http-server.ts";
import { openToolbox } from "../src/toolbox.ts";

const workspace = resolve("examples/my-workspace");
const alice = newToken();
const bob = newToken();

async function serve(extra: Partial<HttpOptions> = {}) {
  const events: Record<string, unknown>[] = [];
  const running = await startHttpServer(await openToolbox(workspace), {
    ...HTTP_DEFAULTS,
    port: 0,
    tokens: [
      { name: "alice", token: alice },
      { name: "bob", token: bob },
    ],
    noAuth: false,
    publicHosts: [],
    log: (event) => events.push(event),
    ...extra,
  });
  return { running, events };
}

async function connect(url: string, token?: string) {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: token ? { headers: { authorization: `Bearer ${token}` } } : {},
    }),
  );
  return client;
}

test("http: a client with a token sees the same tools and instructions as over stdio, and searches", async () => {
  const { running, events } = await serve();
  const client = await connect(running.url, alice);
  try {
    assert.match(client.getInstructions() ?? "", /Every tool is read-only/);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 12, "the tools of the stdio server");
    for (const tool of tools)
      assert.equal((tool.annotations as { readOnlyHint?: boolean }).readOnlyHint, true, tool.name);
    const result = (await client.callTool({
      name: "searchSource",
      arguments: { env: "prod", source: "app-logs", query: "OOMKilled" },
    })) as { content: { text: string }[] };
    assert.match(result.content[0]!.text, /consumers=0 \(crashloop: OOMKilled\)/);
    assert.equal(running.sessions(), 1);

    // the audit line: who, what, where, how long; not the question and not the answer
    const call = events.find((e) => e.event === "tool" && e.tool === "searchSource")!;
    assert.deepEqual([call.identity, call.env, call.source, call.ok], ["alice", "prod", "app-logs", true]);
    assert.equal(typeof call.ms, "number");
    assert.ok(!JSON.stringify(events).includes("OOMKilled"), "no input and no evidence in the log");
    assert.ok(events.some((e) => e.event === "session" && e.action === "open" && e.identity === "alice"));
  } finally {
    await client.close();
    await running.close();
  }
});

test("http: no token, a wrong token and a token of another shape are refused; /healthz needs none", async () => {
  const { running } = await serve();
  try {
    const call = (headers: Record<string, string>) =>
      fetch(running.url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      });
    for (const headers of [
      {},
      { authorization: "Bearer nope" },
      { authorization: `Basic ${alice}` },
      { authorization: alice },
    ] as Record<string, string>[]) {
      const response = await call(headers);
      assert.equal(response.status, 401, JSON.stringify(headers));
      assert.match(response.headers.get("www-authenticate") ?? "", /^Bearer/);
    }
    await assert.rejects(connect(running.url), /401|Unauthorized|HTTP/i);
    const health = await fetch(running.url.replace("/mcp", "/healthz"));
    assert.deepEqual(await health.json(), { ok: true });
    assert.equal((await fetch(running.url.replace("/mcp", "/elsewhere"))).status, 404);
  } finally {
    await running.close();
  }
});

test("http: each session has its own ledger, and a session belongs to the person who opened it", async () => {
  const { running } = await serve();
  const one = await connect(running.url, alice);
  const two = await connect(running.url, bob);
  try {
    const search = { name: "searchSource", arguments: { env: "prod", source: "app-logs", query: "OOMKilled" } };
    const found = (await one.callTool(search)) as { content: { text: string }[] };
    const line = (JSON.parse(found.content[0]!.text) as { evidence: { summary: string; at: string }[] }).evidence[0]!;
    const claim = {
      app: "shop",
      env: "prod",
      cause: "the worker ran out of memory",
      certainty: "likely",
      evidence: [
        { source: "app-logs", at: line.at, quote: line.summary.slice(line.summary.indexOf("payment-confirm")) },
      ],
      unknowns: ["why"],
      next: "restart it",
    };
    const verdict = async (client: Client) =>
      JSON.parse(
        ((await client.callTool({ name: "checkConclusion", arguments: claim })) as { content: { text: string }[] })
          .content[0]!.text,
      ) as { ok: boolean };
    assert.equal((await verdict(one)).ok, true, "the session that read the line may quote it");
    assert.equal((await verdict(two)).ok, false, "another session did not read it");
    assert.equal(running.sessions(), 2);

    // alice's session id with bob's token
    const id = (one as unknown as { transport: { sessionId: string } }).transport.sessionId;
    const stolen = await fetch(running.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${bob}`,
        "mcp-session-id": id,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" }),
    });
    assert.equal(stolen.status, 403);
    const unknown = await fetch(running.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${alice}`,
        "mcp-session-id": "no-such-session",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/list" }),
    });
    assert.equal(unknown.status, 404);
  } finally {
    await one.close();
    await two.close();
    await running.close();
  }
});

test("http: the Host and the Origin are checked, a body is capped, sessions are capped", async () => {
  const { running } = await serve({ maxBodyBytes: 2000, maxSessions: 1, publicHosts: ["mcp.company.example"] });
  try {
    const raw = (headers: Record<string, string>, body = "{}") =>
      new Promise<number>((done, fail) => {
        const target = new URL(running.url);
        const req = request(
          {
            host: target.hostname,
            port: target.port,
            path: "/mcp",
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json, text/event-stream",
              authorization: `Bearer ${alice}`,
              ...headers,
            },
          },
          (res) => (res.resume(), done(res.statusCode ?? 0)),
        );
        req.on("error", fail);
        req.end(body);
      });
    assert.equal(await raw({ host: "evil.example" }), 403, "a name the server is not known by");
    assert.equal(await raw({ origin: "http://evil.example" }), 403, "a browser page");
    assert.equal(
      await raw({ host: "mcp.company.example" }, "{}"),
      400,
      "the public name is accepted (then: not an initialize)",
    );
    assert.equal(await raw({}, "x".repeat(5000)), 413, "too big");
    // one session fills the cap
    const first = await connect(running.url, alice);
    await assert.rejects(connect(running.url, bob), /503|Too many/i);
    await first.close();
  } finally {
    await running.close();
  }
});

test("http: it refuses to start without a token, off this machine without a name, or with --no-auth beyond loopback", async () => {
  const toolbox = await openToolbox(workspace);
  const start = (extra: Partial<HttpOptions>) =>
    startHttpServer(toolbox, {
      ...HTTP_DEFAULTS,
      port: 0,
      tokens: [],
      noAuth: false,
      publicHosts: [],
      log: () => undefined,
      ...extra,
    });
  await assert.rejects(start({}), /No token: a server on a URL reads your systems/);
  await assert.rejects(
    start({ tokens: [{ name: "a", token: alice }], host: "0.0.0.0" }),
    /say which name it is reached by \(--public-host/,
  );
  await assert.rejects(
    start({ noAuth: true, host: "0.0.0.0", publicHosts: ["x.example"] }),
    /--no-auth is only for a loopback address/,
  );
  // on this machine, on purpose, without a token
  const local = await start({ noAuth: true });
  try {
    const client = await connect(local.url);
    assert.equal((await client.listTools()).tools.length, 12);
    await client.close();
  } finally {
    await local.close();
  }
});

test("tokens: named, long enough, once each; and `ops token` makes one", () => {
  assert.deepEqual(parseTokens(` alice:${alice} , bob:${bob}`), [
    { name: "alice", token: alice },
    { name: "bob", token: bob },
  ]);
  assert.deepEqual(parseTokens(undefined), []);
  assert.throws(() => parseTokens("alice:short"), /too short to be safe; make one with: npm run ops -- token alice/);
  assert.throws(() => parseTokens(`Alice:${alice}`), /not a name/);
  assert.throws(() => parseTokens(`${alice}`), /not a name/);
  assert.throws(() => parseTokens(`a:${alice},a:${bob}`), /"a" appears twice/);
  assert.match(newToken(), /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(newToken(), newToken());
  const ops = spawn("node", ["src/cli.ts", "token", "carol"], { stdio: ["ignore", "pipe", "pipe"] });
  return new Promise<void>((done, fail) => {
    let out = "";
    ops.stdout.on("data", (d) => (out += d));
    ops.on("close", (code) => {
      try {
        assert.equal(code, 0);
        assert.match(out.trim(), /^carol:[A-Za-z0-9_-]{43}$/);
        assert.deepEqual(
          parseTokens(out.trim()).map((t) => t.name),
          ["carol"],
        );
        done();
      } catch (error) {
        fail(error);
      }
    });
  });
});
