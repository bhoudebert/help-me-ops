// The toolbox, defined once and shared by every entry point (the MCP server
// today, an API-mode investigator later). Each tool states its four MCP hints.
import { z } from "zod";
import type { Connector } from "../connectors/types.ts";
import { matchPlaybooks, type Playbook } from "../playbooks.ts";

export interface ToolHints {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodObject;
  annotations: ToolHints;
  run(input: unknown): Promise<string>;
}

export interface Toolbox {
  sources: Connector[];
  playbooks: Playbook[];
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

export function createToolDefinitions({ sources, playbooks }: Toolbox): ToolDefinition[] {
  const source = (id: string) => {
    const found = sources.find((s) => s.id === id);
    if (!found) throw new Error(`No source "${id}". Known: ${sources.map((s) => s.id).join(", ") || "none"}.`);
    return found;
  };
  return [
    {
      name: "listSources",
      description:
        "The sources of evidence this installation has (logs, metrics, databases, HTTP checks, custom), each with what it covers. Call it first to know where to look.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      run: async () => json(sources.map(({ id, kind, description }) => ({ id, kind, description }))),
    },
    {
      name: "searchSource",
      description:
        "Search one source for a term (an order number, an error code, a user id), optionally within a time window. Read-only. Returns pieces of evidence with their time and a one-line summary; quote them, do not paraphrase them into facts they do not state.",
      inputSchema: z.object({
        source: z.string().describe("Source id, from listSources"),
        query: z.string().min(1).describe("What to look for"),
        from: z.string().optional().describe("Start of the window, ISO 8601"),
        to: z.string().optional().describe("End of the window, ISO 8601"),
        limit: z.number().int().min(1).max(500).optional().describe("At most this many results (default 50)"),
      }),
      // Reads the system it investigates: outside this process, so open-world.
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      run: async (input) => {
        const args = input as { source: string; query: string; from?: string; to?: string; limit?: number };
        return json(await source(args.source).search(args));
      },
    },
    {
      name: "listPlaybooks",
      description:
        "Your team's investigation playbooks, each with when it applies. With a question, the matching ones come first. Follow a playbook when one fits rather than improvising.",
      inputSchema: z.object({ question: z.string().optional().describe("The problem as reported") }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      run: async (input) => {
        const { question } = input as { question?: string };
        const list = question ? matchPlaybooks(playbooks, question) : playbooks;
        return json(list.map(({ id, name, when }) => ({ id, name, when })));
      },
    },
    {
      name: "getPlaybook",
      description: "The steps of one playbook, as the team wrote them.",
      inputSchema: z.object({ id: z.string().describe("Playbook id, from listPlaybooks") }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      run: async (input) => {
        const { id } = input as { id: string };
        const playbook = playbooks.find((p) => p.id === id);
        if (!playbook) throw new Error(`No playbook "${id}". Call listPlaybooks.`);
        return `# ${playbook.name}\n\nWhen: ${playbook.when}\n\n${playbook.body}`;
      },
    },
  ];
}
