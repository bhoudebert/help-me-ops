// `ops eval` (ADR 0014): run the scenarios of a workspace against a model, several
// times, and count what it did. Nothing here judges reasoning: it counts whether a
// run ended in an accepted conclusion, and which of the facts the scenario expects
// the answer names (keywords). The numbers are those of this model on this
// machine, and the only basis to rely on one.
import { scenarios, type Scenario } from "../demo.ts";
import type { Toolbox } from "../tools/index.ts";
import { assertModelAllowed, displayUrl, resolveModel, type Model } from "./endpoint.ts";
import { Session } from "./loop.ts";

export interface EvalOptions {
  scenario?: string;
  runs: number;
  /** Models to compare, as the server names them. */
  models: string[];
  /** `none`, `low`, `medium`, `high`, or `default` (nothing sent). */
  reasoning: string[];
  baseUrl?: string;
}

export interface RunResult {
  status: "concluded" | "answered" | "limit" | "error";
  steps: number;
  tokens: number;
  seconds: number;
  /** Names of the expected facts the answer mentions. */
  facts: string[];
  /** Every required fact is named. */
  cause: boolean;
  note?: string;
}

export interface SettingResult {
  model: string;
  reasoning: string;
  runs: RunResult[];
}

export interface EvalReport {
  scenario: string;
  expected: string[];
  baseUrl: string;
  settings: SettingResult[];
}

const median = (numbers: number[]) => {
  if (!numbers.length) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * The question as the person would ask it: the method says to ask which
 * environment when it is not clear, and an eval has nobody to answer, so the
 * scenario's `scope` is said up front.
 */
export function questionFor(scenario: Scenario): string {
  const { app, env } = scenario.scope ?? {};
  const where = [app && `the ${app} app`, env && `the ${env} environment`].filter(Boolean).join(", in ");
  return where ? `${scenario.question}. It is ${where}.` : scenario.question;
}

/** Which expected facts a text names, and whether the required ones are all there. */
export function scoreAnswer(scenario: Scenario, text: string): { facts: string[]; cause: boolean } {
  const lower = text.toLowerCase();
  const expected = scenario.expect?.facts ?? [];
  const facts = expected.filter((f) => f.any.some((word) => lower.includes(word.toLowerCase())));
  const cause = expected.filter((f) => f.required).every((f) => facts.includes(f));
  return { facts: facts.map((f) => f.name), cause };
}

export async function runEval(
  toolbox: Toolbox,
  workspace: string,
  options: EvalOptions,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = globalThis.fetch,
  progress: (line: string) => void = () => undefined,
): Promise<EvalReport> {
  const all = scenarios(workspace);
  const scenario = options.scenario ? all.find((s) => s.id === options.scenario) : all[0];
  if (!scenario) {
    throw new Error(
      options.scenario
        ? `No scenario "${options.scenario}" in ${workspace}/scenarios (known: ${all.map((s) => s.id).join(", ") || "none"}).`
        : `No scenario in ${workspace}/scenarios: ops eval needs a question to ask. The demo workspace has one.`,
    );
  }
  const settings: SettingResult[] = [];
  let baseUrl = "";
  for (const name of options.models) {
    for (const reasoning of options.reasoning) {
      const model: Model = resolveModel(toolbox.model, { baseUrl: options.baseUrl, model: name }, env);
      model.reasoningEffort = reasoning === "default" ? undefined : (reasoning as Model["reasoningEffort"]);
      assertModelAllowed(model.baseUrl, toolbox.privacy?.modelHosts);
      baseUrl = displayUrl(model.baseUrl);
      const runs: RunResult[] = [];
      for (let i = 1; i <= options.runs; i++) {
        progress(`${name} · reasoning ${reasoning} · run ${i}/${options.runs}`);
        const began = Date.now();
        try {
          // A new session each run: a new ledger, a new conversation.
          const turn = await new Session(toolbox, model, fetchImpl).turn(questionFor(scenario));
          runs.push({
            status: turn.status,
            steps: turn.steps,
            tokens: turn.tokens,
            seconds: (Date.now() - began) / 1000,
            ...scoreAnswer(scenario, turn.status === "limit" ? "" : turn.text),
            ...(turn.reason ? { note: turn.reason } : {}),
          });
        } catch (error) {
          // A server that is not there on the first run is a configuration mistake, not a result.
          if (!runs.length && i === 1) throw error;
          runs.push({
            status: "error",
            steps: 0,
            tokens: 0,
            seconds: (Date.now() - began) / 1000,
            facts: [],
            cause: false,
            note: error instanceof Error ? error.message : String(error),
          });
        }
      }
      settings.push({ model: name, reasoning, runs });
    }
  }
  return {
    scenario: scenario.id,
    expected: (scenario.expect?.facts ?? []).map((f) => `${f.name}${f.required ? " (required)" : ""}`),
    baseUrl,
    settings,
  };
}

/** The report as text: one line per setting, then what was missed. */
export function formatReport(report: EvalReport): string {
  const rows = report.settings.map((s) => {
    const n = s.runs.length;
    const count = (test: (r: RunResult) => boolean) => `${s.runs.filter(test).length}/${n}`;
    return [
      `${s.model} · reasoning ${s.reasoning}`,
      count((r) => r.status === "concluded"),
      report.expected.length ? count((r) => r.cause) : "-",
      report.expected.length
        ? `${(s.runs.reduce((sum, r) => sum + r.facts.length, 0) / n).toFixed(1)}/${report.expected.length}`
        : "-",
      String(median(s.runs.map((r) => r.steps))),
      Math.round(median(s.runs.map((r) => r.tokens))).toLocaleString("en-US"),
      `${Math.round(median(s.runs.map((r) => r.seconds)))} s`,
    ];
  });
  const head = ["setting", "accepted", "cause", "facts", "steps", "tokens", "time"];
  const width = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
  const line = (cells: string[]) =>
    cells
      .map((c, i) => c.padEnd(width[i]!))
      .join("  ")
      .trimEnd();
  const out = [
    `ops eval: ${report.scenario} · ${report.settings[0]?.runs.length ?? 0} run(s) per setting · ${report.baseUrl}`,
    "",
    line(head),
    ...rows.map(line),
    "",
    "accepted: the conclusion check accepted a conclusion. cause / facts: keywords of the scenario's `expect` found in the answer (median over the runs for steps, tokens and time).",
  ];
  if (report.expected.length) out.push(`expected: ${report.expected.join("; ")}`);
  else out.push("this scenario has no `expect`: only the conclusion check is counted.");
  for (const s of report.settings) {
    const never = report.expected.length
      ? report.expected
          .map((e) => e.replace(/ \(required\)$/, ""))
          .filter((name) => !s.runs.some((r) => r.facts.includes(name)))
      : [];
    if (never.length) out.push(`${s.model} · reasoning ${s.reasoning} never named: ${never.join("; ")}`);
    const problems = [...new Set(s.runs.filter((r) => r.status !== "concluded").map((r) => r.note ?? r.status))];
    if (problems.length) out.push(`${s.model} · reasoning ${s.reasoning} did not conclude: ${problems.join("; ")}`);
  }
  return out.join("\n");
}
