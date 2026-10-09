// The record of a benchmark run and the table made from the records (ADR 0014).
// `ops eval` counts; this keeps what was counted, with where and when, so a table
// in the guide is made of files anyone can read and re-run, not typed by hand.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { EvalSuite } from "./eval.ts";

const Run = z.object({
  status: z.enum(["concluded", "answered", "limit", "error"]),
  steps: z.number(),
  tokens: z.number(),
  seconds: z.number(),
  facts: z.array(z.string()),
  cause: z.boolean(),
  note: z.string().optional(),
});

const Report = z.object({
  scenario: z.string(),
  expected: z.array(z.string()),
  baseUrl: z.string(),
  settings: z.array(z.object({ model: z.string(), reasoning: z.string(), runs: z.array(Run).min(1) })).min(1),
});

export const BenchRecord = z.object({
  version: z.literal(1),
  /** ISO date of the run. */
  recordedAt: z.string(),
  /** The commit of this repository that ran it, with `+dirty` when the tree had changes. */
  commit: z.string(),
  /** Hardware and server, as the person who ran it describes them. */
  machine: z.string(),
  /** Sampling temperature of the runs, when it was set for them. */
  temperature: z.number().optional(),
  /** Anything a reader needs: how the model was served, what differs from a plain run. */
  notes: z.string().optional(),
  suite: z.object({ baseUrl: z.string(), reports: z.array(Report).min(1) }),
});
export type BenchRecord = z.infer<typeof BenchRecord>;

export function recordOf(
  suite: EvalSuite,
  meta: { commit: string; machine: string; notes?: string; temperature?: number; now?: Date },
): BenchRecord {
  return BenchRecord.parse({
    version: 1,
    recordedAt: (meta.now ?? new Date()).toISOString(),
    commit: meta.commit,
    machine: meta.machine,
    ...(meta.temperature !== undefined ? { temperature: meta.temperature } : {}),
    ...(meta.notes ? { notes: meta.notes } : {}),
    suite,
  });
}

/** A file name for a record: date, machine label and models. */
export function fileNameOf(record: BenchRecord, label: string): string {
  const models = [...new Set(record.suite.reports.flatMap((r) => r.settings.map((s) => s.model)))];
  const slug = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, "-")
      .replace(/^-|-$/g, "");
  return `${record.recordedAt.slice(0, 10)}-${slug(label)}-${models.map(slug).join("+")}.json`;
}

const median = (numbers: number[]) => {
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

/**
 * The comparison as a Markdown table: one row per model and reasoning setting
 * (the latest record that has it), one column per scenario with the runs that
 * named the cause, and the conclusion check's acceptances and the median time.
 */
export function renderTable(records: BenchRecord[]): string {
  const ordered = [...records].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  const scenarios = [...new Set(ordered.flatMap((r) => r.suite.reports.map((x) => x.scenario)))].sort();
  type Runs = z.infer<typeof Run>[];
  const rows = new Map<string, { at: string; temperature?: number; byScenario: Map<string, Runs> }>();
  for (const record of ordered) {
    for (const report of record.suite.reports) {
      for (const setting of report.settings) {
        const key = `${setting.model} · reasoning ${setting.reasoning}`;
        // The latest record of a setting wins, whole: its scenarios are not mixed with an older run's.
        const row = rows.get(key) ?? {
          at: record.recordedAt,
          temperature: record.temperature,
          byScenario: new Map<string, Runs>(),
        };
        if (row.at !== record.recordedAt) continue;
        row.byScenario.set(report.scenario, setting.runs);
        rows.set(key, row);
      }
    }
  }
  const header = ["Setting", "Temp", ...scenarios, "Accepted", "Median time"];
  const found = (runs: Runs) => `${runs.filter((r) => r.cause).length}/${runs.length}`;
  const body = [...rows]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, { byScenario, temperature }]) => {
      const all = [...byScenario.values()].flat();
      return [
        key,
        temperature === undefined ? "-" : String(temperature),
        ...scenarios.map((s) => (byScenario.has(s) ? found(byScenario.get(s)!) : "-")),
        `${all.filter((r) => r.status === "concluded").length}/${all.length}`,
        `${Math.round(median(all.map((r) => r.seconds)))} s`,
      ];
    });
  // Padded the way Prettier formats a table, so the page is the same text before and after it.
  const width = header.map((h, c) => Math.max(3, h.length, ...body.map((r) => r[c]!.length)));
  const cell = (text: string, c: number) => (c === 0 ? text.padEnd(width[c]!) : text.padStart(width[c]!));
  const row = (cells: string[]) => `| ${cells.map(cell).join(" | ")} |`;
  const lines = [
    row(header),
    `| ${width.map((w, c) => (c === 0 ? "-".repeat(w) : `${"-".repeat(w - 1)}:`)).join(" | ")} |`,
    ...body.map(row),
  ];
  return lines.join("\n");
}

/** Replaces what is between the markers of a page by the table. */
export function withTable(page: string, table: string): string {
  const start = "<!-- bench:table:start -->";
  const end = "<!-- bench:table:end -->";
  const i = page.indexOf(start);
  const j = page.indexOf(end);
  if (i < 0 || j < i) throw new Error(`The page needs ${start} and ${end} around the table.`);
  return `${page.slice(0, i + start.length)}\n\n${table}\n\n${page.slice(j)}`;
}

/** Every stored record of a folder, oldest first; one that does not match the format is an error naming the file. */
export function readRecords(dir: string): BenchRecord[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => {
      const parsed = BenchRecord.safeParse(JSON.parse(readFileSync(join(dir, f), "utf8")));
      if (!parsed.success)
        throw new Error(`${join(dir, f)} is not a benchmark record: ${z.prettifyError(parsed.error)}`);
      return parsed.data;
    });
}
