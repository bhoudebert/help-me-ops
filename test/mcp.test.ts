import assert from "node:assert/strict";
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
      env: { PATH: process.env.PATH ?? "", OPS_CONFIG: resolve("ops.config.example.json") },
      stderr: "pipe",
    }),
  );
  try {
    assert.match(client.getInstructions() ?? "", /Every tool is read-only/);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 4);
    for (const tool of tools) {
      for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
        assert.equal(typeof (tool.annotations as any)?.[hint], "boolean", `${tool.name} ${hint}`);
      }
    }
    const result = (await client.callTool({
      name: "searchSource",
      arguments: { source: "app-logs", query: "OOMKilled" },
    })) as any;
    assert.match(result.content[0].text, /consumers=0 \(crashloop: OOMKilled\)/);
    const prompt = await client.getPrompt({ name: "investigate", arguments: { question: "order 4512 stuck" } });
    assert.match((prompt.messages[0]!.content as any).text, /Problem: order 4512 stuck$/);
  } finally {
    await client.close();
  }
});
