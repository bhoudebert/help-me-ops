// `ops demo`: an investigation replayed in the terminal, with no model and no
// AI client. The steps of a scenario file go through the real tools, and its
// conclusion through the real check, so what is shown is what an assistant would
// get. Doubles as a smoke test of the toolbox: it fails if the check refuses.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createToolDefinitions, type Toolbox } from "./tools/index.ts";

interface Scenario {
  id: string;
  question: string;
  steps: { why: string; tool: string; input: Record<string, unknown> }[];
  conclusion: Record<string, unknown>;
}

export interface DemoOptions {
  /** Which scenario of `scenarios/`; the only one by default. */
  scenario?: string;
  /** Milliseconds between steps, so a person can follow. */
  pace?: number;
  color?: boolean;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function scenarios(workspace: string): Scenario[] {
  const dir = join(workspace, "scenarios");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(dir, file), "utf8")) as Scenario);
}

type Evidence = { at: string | null; source: string; summary: string };

/** What a tool answered, in a few lines. */
function describe(tool: string, text: string): string[] {
  let answer: Record<string, unknown>;
  try {
    answer = JSON.parse(text);
  } catch {
    return [cut(text.replace(/\s+/g, " "), 110)];
  }
  if (tool === "scope") {
    const { likely, ask } = answer as {
      likely: { app: string | null; env: string | null; reasons: string[] };
      ask: string[];
    };
    return [
      likely.app
        ? `${likely.app} / ${likely.env ?? "?"}: ${likely.reasons.join("; ")}`
        : `cannot tell: ask ${ask.join(", ")}`,
    ];
  }
  if (tool === "listPlaybooks") {
    return (answer as unknown as { id: string; name: string }[])
      .slice(0, 3)
      .map((p, i) => `${p.id}: ${p.name}${i === 0 ? " (best match)" : ""}`);
  }
  if (Array.isArray(answer.evidence)) {
    const found = answer.evidence as Evidence[];
    if (!found.length) return ["nothing found"];
    const lines = found.slice(0, 4).map((e) => {
      // A log line repeats its own time: say it once.
      const text = e.at && e.summary.startsWith(e.at) ? e.summary.slice(e.at.length).trim() : e.summary;
      return `${(e.at ?? "-").padEnd(20)} ${e.source.padEnd(9)} ${cut(text, 88)}`;
    });
    if (found.length > 4) lines.push(`(and ${found.length - 4} more)`);
    if (answer.masked) lines.push(`(${answer.masked} value(s) hidden by the mask)`);
    return lines;
  }
  return [cut(JSON.stringify(answer), 110)];
}

export async function runDemo(
  toolbox: Toolbox,
  workspace: string,
  options: DemoOptions,
  write: (line: string) => void,
): Promise<{ ok: boolean }> {
  const all = scenarios(workspace);
  const scenario = options.scenario ? all.find((s) => s.id === options.scenario) : all[0];
  if (!scenario) {
    throw new Error(
      all.length
        ? `No scenario "${options.scenario}" in ${join(workspace, "scenarios")}. Known: ${all.map((s) => s.id).join(", ")}.`
        : `${workspace} has no scenarios/ folder to replay. The demo workspace is examples/my-workspace (npm run ops -- demo, with no --workspace).`,
    );
  }
  const paint = (code: number, text: string) => (options.color ? `\u001b[${code}m${text}\u001b[0m` : text);
  const bold = (t: string) => paint(1, t);
  const dim = (t: string) => paint(2, t);
  const good = (t: string) => paint(32, t);
  const bad = (t: string) => paint(31, t);
  const pause = () => (options.pace ? sleep(options.pace) : Promise.resolve());

  const tools = createToolDefinitions(toolbox);
  write(bold(`help-me-ops demo: ${scenario.id}`));
  write(dim(`workspace ${workspace}`));
  write(dim("No model and no AI client: the steps of an investigation, replayed through the real tools."));
  write("");
  write(`${bold("You")}  ${scenario.question}`);
  await pause();

  let number = 0;
  for (const step of scenario.steps) {
    const tool = tools.find((t) => t.name === step.tool);
    if (!tool) throw new Error(`The scenario uses ${step.tool}, which this workspace does not have.`);
    number += 1;
    write("");
    write(`${bold(`${number}.`)} ${step.why}`);
    write(dim(`   ${step.tool} ${cut(JSON.stringify(step.input), 90)}`));
    const answer = await tool.run(tool.inputSchema.parse(step.input));
    for (const line of describe(step.tool, answer)) write(`   ${line}`);
    await pause();
  }

  write("");
  write(bold("Conclusion, checked"));
  const check = tools.find((t) => t.name === "checkConclusion")!;
  const verdict = JSON.parse(await check.run(check.inputSchema.parse(scenario.conclusion))) as {
    ok: boolean;
    problems: string[];
    checked: unknown[];
    report?: string;
  };
  if (!verdict.ok) {
    write(bad(`REFUSED: ${verdict.problems.length} problem(s)`));
    for (const problem of verdict.problems) write(bad(`   ${problem}`));
    return { ok: false };
  }
  write("");
  for (const line of verdict.report!.split("\n")) write(`   ${line}`);
  write("");
  write(
    good(
      `ok: all ${verdict.checked.length} quotes were returned by the tools above, at the time and from the source stated.`,
    ),
  );
  write(
    dim(
      "Try it with a model: open this folder in Claude Code, Codex or Copilot and ask the question above. Guide: docs/guide/demo.md",
    ),
  );
  return { ok: true };
}
