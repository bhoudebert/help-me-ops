// The toolbox, defined once and shared by every entry point (the MCP server
// today, an API-mode investigator later). Each tool states its four MCP hints.
import { z } from "zod";
import type { AddonReport } from "../addons/loader.ts";
import type { SearchInput } from "../connectors/types.ts";
import { matchPlaybooks, type Playbook } from "../playbooks.ts";
import { describeScope, resolveScope, type AppSetup } from "../scope.ts";

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
  apps: AppSetup[];
  playbooks: Playbook[];
  /** Tools the addons bring, already namespaced. */
  addonTools?: ToolDefinition[];
  /** What happened to each addon, for doctor and the start-up lines. */
  addons?: AddonReport[];
  /** Sources left out, and other things the person should know. */
  warnings?: string[];
}

interface SearchArgs extends SearchInput {
  app?: string;
  env?: string;
  source: string;
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

export const appParam = z.string().optional().describe("App, from scope; may be left out when there is only one");
export const envParam = z
  .string()
  .optional()
  .describe("Environment (prod, staging…), from scope; may be left out when there is only one");

export function createToolDefinitions({ apps, playbooks, addonTools = [] }: Toolbox): ToolDefinition[] {
  const core: ToolDefinition[] = [
    {
      name: "scope",
      description:
        "The apps and environments this workspace knows, and which ones a problem points at, with why. Call it first: sources belong to an environment, and a problem in prod is not read from staging. If it cannot tell, ask the person which. Reads no evidence.",
      inputSchema: z.object({ question: z.string().optional().describe("The problem as reported") }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      run: async (input) => json(describeScope(apps, (input as { question?: string }).question)),
    },
    {
      name: "listSources",
      description:
        "The sources of evidence of one app and environment (logs, metrics, databases, HTTP checks, custom), each with what it covers. Call it to know where to look.",
      inputSchema: z.object({ app: appParam, env: envParam }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      run: async (input) => {
        const { app, env } = input as { app?: string; env?: string };
        const scope = resolveScope(apps, app, env);
        return json({
          app: scope.app.name,
          env: scope.env.name,
          sources: scope.env.sources.map(({ id, kind, description }) => ({ id, kind, description })),
        });
      },
    },
    {
      name: "searchSource",
      description:
        "Search one source for a term (an order number, an error code, a user id), optionally within a time window. Read-only. Returns pieces of evidence with their time and a one-line summary; quote them, do not paraphrase them into facts they do not state.",
      inputSchema: z.object({
        app: appParam,
        env: envParam,
        source: z.string().describe("Source id, from listSources"),
        query: z.string().min(1).describe("What to look for"),
        from: z.string().optional().describe("Start of the window, ISO 8601"),
        to: z.string().optional().describe("End of the window, ISO 8601"),
        limit: z.number().int().min(1).max(500).optional().describe("At most this many results (default 50)"),
      }),
      // Reads the system it investigates: outside this process, so open-world.
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      run: async (input) => {
        const args = input as SearchArgs;
        const { app, env } = resolveScope(apps, args.app, args.env);
        const found = env.sources.find((s) => s.id === args.source);
        if (!found) {
          const known = env.sources.map((s) => s.id).join(", ") || "none";
          throw new Error(`No source "${args.source}" in ${app.name}/${env.name}. Known: ${known}.`);
        }
        const { query, from, to, limit } = args;
        const evidence = await found.search({ query, from, to, limit });
        return json({ app: app.name, env: env.name, source: found.id, evidence });
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
  return [...core, ...addonTools];
}
