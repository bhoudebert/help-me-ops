// MCP entry point for Claude Code, Codex and GitHub Copilot. Stdout carries the
// protocol only; anything else goes to stderr.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolveAddonDirs } from "./addons/loader.ts";
import { startupNotices } from "./commands.ts";
import { resolveWorkspace } from "./config.ts";
import { instructionsFor } from "./guide.ts";
import { openToolbox } from "./toolbox.ts";
import { createToolDefinitions } from "./tools/index.ts";

const toolbox = await openToolbox(resolveWorkspace(), resolveAddonDirs());
const INSTRUCTIONS = instructionsFor(toolbox);
const server = new McpServer({ name: "help-me-ops", version: "0.1.0" }, { instructions: INSTRUCTIONS });

for (const notice of startupNotices(toolbox)) process.stderr.write(`${notice}\n`);
for (const tool of createToolDefinitions(toolbox)) {
  server.registerTool(
    tool.name,
    { description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
    async (args: unknown) => ({ content: [{ type: "text" as const, text: await tool.run(args) }] }),
  );
}

server.registerPrompt(
  "investigate",
  {
    title: "Investigate a problem",
    description: "Follow the method on a reported problem, e.g. order 4512 is stuck",
    argsSchema: { question: z.string().describe("The problem as reported") },
  },
  ({ question }) => ({
    messages: [
      { role: "user" as const, content: { type: "text" as const, text: `${INSTRUCTIONS}\n\nProblem: ${question}` } },
    ],
  }),
);

await server.connect(new StdioServerTransport());
process.stderr.write(
  `help-me-ops MCP server ready: workspace ${toolbox.workspace}, ${toolbox.apps.length} app(s), ${toolbox.addons?.filter((a) => a.status === "loaded").length ?? 0} addon(s), ${toolbox.playbooks.length} playbook(s)\n`,
);
