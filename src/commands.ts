// What the terminal commands do, as functions returning text (testable).
import { formatReport } from "./addons/loader.ts";
import { createMasker } from "./privacy.ts";
import { matchPlaybooks } from "./playbooks.ts";
import { createToolDefinitions, type Toolbox } from "./tools/index.ts";

export const USAGE = `Usage: npm run ops -- <command>

  demo [--scenario <id>] [--pace <ms>]  Watch an investigation of the demo shop in the terminal, no model needed
  scope [question]                      The apps and environments, and which ones a question points at
  sources                               The sources of an app and environment
  knowledge <words>                     Search your runbooks and notes (knowledge/ and playbooks/)
  playbooks [question]                  Playbooks, the matching ones first when a question is given
  search <source> <query> [--from ISO] [--to ISO] [--limit N]
                                        Search one source, read-only
  investigate "<question>"              The playbook to follow and where to look
  doctor                                The addons loaded or skipped, and why
  addon check <folder>                  Is this addon ready to drop in? Manifest, functions, settings, samples
  init workspace <folder> [--app <name>] [--envs prod,staging]
                                        Create a workspace for your own system
  init addon <name> --template file|api|sql
                                        Write a working addon into the workspace to edit

Options for any command: --workspace <dir> (or OPS_WORKSPACE; default: the current folder),
--addons <dir[:dir]> (or OPS_ADDONS) for more addon folders,
--app <name> and --env <name> (left out when there is only one).

In Claude Code, Codex or Copilot, ask in plain words: "order 4512 is stuck, why?"`;

function flag(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

/** The options every command shares, taken out of the arguments. */
function takeGlobals(args: string[]): { rest: string[]; app?: string; env?: string } {
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--workspace" || args[i] === "--app" || args[i] === "--env") i++;
    else rest.push(args[i]!);
  }
  return { rest, app: flag(args, "--app"), env: flag(args, "--env") };
}

export async function runCommand(toolbox: Toolbox, command: string | undefined, allArgs: string[]): Promise<string> {
  const { rest: args, app, env } = takeGlobals(allArgs);
  const tools = Object.fromEntries(createToolDefinitions(toolbox).map((t) => [t.name, t]));
  switch (command) {
    case "scope":
      return tools.scope!.run({ question: args.join(" ") || undefined });
    case "sources":
      return tools.listSources!.run({ app, env });
    case "knowledge":
      if (!args.length) throw new Error("Usage: knowledge <words> [--app <name>]");
      return tools.searchKnowledge!.run({ query: args.join(" "), app });
    case "playbooks":
      return tools.listPlaybooks!.run({ question: args.join(" ") || undefined });
    case "search": {
      const [source, ...rest] = args;
      const words = rest.filter((a, i) => !a.startsWith("--") && !rest[i - 1]?.startsWith("--"));
      if (!source || !words.length)
        throw new Error("Usage: search <source> <query> [--from ISO] [--to ISO] [--limit N]");
      const limit = flag(rest, "--limit");
      return tools.searchSource!.run({
        app,
        env,
        source,
        query: words.join(" "),
        from: flag(rest, "--from"),
        to: flag(rest, "--to"),
        limit: limit ? Number(limit) : undefined,
      });
    }
    case "doctor": {
      const lines = [...formatReport(toolbox.addons ?? []), ...(toolbox.warnings ?? []).map((w) => `  ! ${w}`)];
      const privacy =
        (toolbox.masker === undefined ? createMasker(toolbox.privacy) : toolbox.masker)?.describe() ??
        "no masking: what the tools return goes to your AI provider";
      return [
        `Workspace: ${toolbox.workspace ?? "unknown"}`,
        `Privacy: ${privacy}`,
        "Addons:",
        ...(lines.length ? lines : ["  none"]),
      ].join("\n");
    }
    case "investigate": {
      const question = args.join(" ").trim();
      if (!question) throw new Error('Usage: investigate "<question>"');
      const [playbook] = matchPlaybooks(toolbox.playbooks, question);
      const where = toolbox.apps
        .flatMap((a) =>
          a.envs.flatMap((e) => e.sources.map((s) => `  - ${a.name}/${e.name}: ${s.id} (${s.kind}): ${s.description}`)),
        )
        .join("\n");
      return [
        `Question: ${question}`,
        playbook
          ? `Playbook: ${playbook.name} (${playbook.id})\n\n${playbook.body}`
          : "No playbook matches: write one in playbooks/ (copy order-stuck.md).",
        `\nSources:\n${where || "  none configured"}`,
        "\nThe model follows the playbook in your AI client, over MCP (Claude Code, Codex, Copilot).",
        "Run `scope` first when there are several apps or environments.",
      ].join("\n");
    }
    default:
      // A command that does not exist is an error, not a silent help: `addon check` once printed this page.
      if (command) throw new Error(`Unknown command "${command}".\n\n${USAGE}`);
      return USAGE;
  }
}

/** What the person should see when a command or server starts: addons that did not load, sources left out. */
export function startupNotices(toolbox: Toolbox): string[] {
  const addons = (toolbox.addons ?? []).filter(
    (r) => r.status !== "idle" && (r.status !== "loaded" || r.reason || r.notes.length),
  );
  return [
    `help-me-ops workspace: ${toolbox.workspace ?? "unknown"}`,
    ...formatReport(addons).map((l) => `help-me-ops addon:${l}`),
    ...(toolbox.warnings ?? []).map((w) => `help-me-ops: ${w}`),
  ];
}
