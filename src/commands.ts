// What the terminal commands do, as functions returning text (testable).
import { matchPlaybooks } from "./playbooks.ts";
import { createToolDefinitions, type Toolbox } from "./tools/index.ts";

export const USAGE = `Usage: npm run ops -- <command>

  sources                               The sources of evidence configured (ops.config.json)
  playbooks [question]                  Playbooks, the matching ones first when a question is given
  search <source> <query> [--from ISO] [--to ISO] [--limit N]
                                        Search one source, read-only
  investigate "<question>"              The playbook to follow and where to look (the agent loop comes next)

In Claude Code, Codex or Copilot, ask in plain words: "order 4512 is stuck, why?"`;

function flag(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

export async function runCommand(toolbox: Toolbox, command: string | undefined, args: string[]): Promise<string> {
  const tools = Object.fromEntries(createToolDefinitions(toolbox).map((t) => [t.name, t]));
  switch (command) {
    case "sources":
      return tools.listSources!.run({});
    case "playbooks":
      return tools.listPlaybooks!.run({ question: args.join(" ") || undefined });
    case "search": {
      const [source, ...rest] = args;
      const words = rest.filter((a, i) => !a.startsWith("--") && !rest[i - 1]?.startsWith("--"));
      if (!source || !words.length)
        throw new Error("Usage: search <source> <query> [--from ISO] [--to ISO] [--limit N]");
      const limit = flag(rest, "--limit");
      return tools.searchSource!.run({
        source,
        query: words.join(" "),
        from: flag(rest, "--from"),
        to: flag(rest, "--to"),
        limit: limit ? Number(limit) : undefined,
      });
    }
    case "investigate": {
      const question = args.join(" ").trim();
      if (!question) throw new Error('Usage: investigate "<question>"');
      const [playbook] = matchPlaybooks(toolbox.playbooks, question);
      const where = toolbox.sources.map((s) => `  - ${s.id} (${s.kind}): ${s.description}`).join("\n");
      return [
        `Question: ${question}`,
        playbook
          ? `Playbook: ${playbook.name} (${playbook.id})\n\n${playbook.body}`
          : "No playbook matches: write one in playbooks/ (copy order-stuck.md).",
        `\nSources:\n${where || "  none configured"}`,
        "\nThe automated investigation (a model following the playbook through the sources) is the next step:",
        "openspec/changes/first-investigation-loop. Today, run it from Claude Code, Codex or Copilot over MCP.",
      ].join("\n");
    }
    default:
      return USAGE;
  }
}
