// The MCP server of a toolbox, built once for both entry points: stdio on a
// person's machine (src/mcp.ts) and HTTP for a team (src/mcp-http.ts, ADR 0015).
// Every call to this function makes its own tools, and so its own ledger for the
// checked conclusion: one stdio process, or one HTTP session, is one investigation.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { instructionsFor } from "./guide.ts";
import { createToolDefinitions, type Toolbox } from "./tools/index.ts";

/** What happened in one tool call, without its input or its answer: those can hold personal data. */
export interface CallEvent {
  tool: string;
  app?: string;
  env?: string;
  source?: string;
  ms: number;
  ok: boolean;
}

export function createMcpServer(toolbox: Toolbox, options: { onCall?: (event: CallEvent) => void } = {}): McpServer {
  const instructions = instructionsFor(toolbox);
  const server = new McpServer({ name: "help-me-ops", version: "0.1.0" }, { instructions });
  const text = (value: unknown) => (typeof value === "string" ? value : undefined);

  for (const tool of createToolDefinitions(toolbox)) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
      async (args: unknown) => {
        const began = Date.now();
        const input = (args ?? {}) as Record<string, unknown>;
        const event = {
          tool: tool.name,
          app: text(input.app),
          env: text(input.env),
          source: text(input.source),
        };
        try {
          const answer = await tool.run(args);
          options.onCall?.({ ...event, ms: Date.now() - began, ok: true });
          return { content: [{ type: "text" as const, text: answer }] };
        } catch (error) {
          options.onCall?.({ ...event, ms: Date.now() - began, ok: false });
          throw error;
        }
      },
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
        { role: "user" as const, content: { type: "text" as const, text: `${instructions}\n\nProblem: ${question}` } },
      ],
    }),
  );
  return server;
}

/** The line both entry points print once they serve. */
export function readyLine(toolbox: Toolbox): string {
  const addons = toolbox.addons?.filter((a) => a.status === "loaded").length ?? 0;
  return `workspace ${toolbox.workspace}, ${toolbox.apps.length} app(s), ${addons} addon(s), ${toolbox.playbooks.length} playbook(s)`;
}
