import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("mcp: the server lists its tools with all four hints and answers a search", async () => {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["src/mcp.ts"],
      env: { PATH: process.env.PATH ?? "", OPS_WORKSPACE: resolve("examples/my-workspace") },
      stderr: "pipe",
    }),
  );
  try {
    assert.match(client.getInstructions() ?? "", /Every tool is read-only/);
    assert.match(client.getInstructions() ?? "", /scope with the problem/);
    assert.match(client.getInstructions() ?? "", /Workspace loaded: .*examples\/my-workspace/);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 12);
    for (const tool of tools) {
      for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
        assert.equal(typeof (tool.annotations as any)?.[hint], "boolean", `${tool.name} ${hint}`);
      }
    }
    const result = (await client.callTool({
      name: "searchSource",
      arguments: { env: "prod", source: "app-logs", query: "OOMKilled" },
    })) as any;
    assert.match(result.content[0].text, /"env": "prod"[\s\S]*consumers=0 \(crashloop: OOMKilled\)/);
    const prompt = await client.getPrompt({ name: "investigate", arguments: { question: "order 4512 stuck" } });
    assert.match((prompt.messages[0]!.content as any).text, /Problem: order 4512 stuck$/);
  } finally {
    await client.close();
  }
});

test("mcp: an addon dropped into the workspace is served with its hints", async () => {
  const ws = mkdtempSync(join(tmpdir(), "ops-mcp-"));
  mkdirSync(join(ws, "addons/order"), { recursive: true });
  writeFileSync(
    join(ws, "ops.config.json"),
    JSON.stringify({ apps: { shop: { envs: { prod: { sources: [], addons: { order: { dbUrl: "pg://x" } } } } } } }),
  );
  writeFileSync(
    join(ws, "addons/order/addon.ts"),
    `export default ({ z }) => ({ apiVersion: 1, settings: z.object({ dbUrl: z.string() }), tools: [{
      name: "getOrder", description: "One order", inputSchema: z.object({ id: z.string() }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      run: async ({ id }, { settings }) => [{ source: "order", at: null, summary: "order " + id + " at " + settings.dbUrl, data: {} }],
    }] });\n`,
  );
  const client = new Client({ name: "test", version: "0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["src/mcp.ts"],
      env: { PATH: process.env.PATH ?? "", OPS_WORKSPACE: ws },
      stderr: "pipe",
    }),
  );
  try {
    const { tools } = await client.listTools();
    const order = tools.find((t) => t.name === "order.getOrder")!;
    assert.equal((order.annotations as any).readOnlyHint, true);
    assert.equal((order.annotations as any).destructiveHint, false);
    const result = (await client.callTool({ name: "order.getOrder", arguments: { id: "4512" } })) as any;
    assert.match(result.content[0].text, /order 4512 at pg:\/\/x/);
  } finally {
    await client.close();
  }
});
