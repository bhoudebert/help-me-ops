// The checked conclusion. The assistant ends an investigation with a cause, how
// sure it is, the evidence, what is unknown and a next step. Each quote of the
// evidence must be one the tools actually returned in this session, in the
// source, at the time, and for the environment it claims: otherwise the
// conclusion is refused, naming what could not be found. The model reasons;
// this only checks that it did not invent (ADR 0007).
import type { Evidence } from "./connectors/types.ts";

export const CERTAINTIES = ["confirmed", "likely", "unknown"] as const;
export type Certainty = (typeof CERTAINTIES)[number];

export interface Conclusion {
  app?: string;
  env?: string;
  cause: string;
  certainty: Certainty;
  evidence: { source: string; at: string | null; quote: string }[];
  unknowns: string[];
  next: string;
}

/** A piece of evidence a tool returned, with where it was returned from. */
export interface Seen extends Evidence {
  tool: string;
  app?: string;
  env?: string;
}

const MAX_SEEN = 5000;
const MIN_QUOTE = 8;

const plain = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/** Everything the tools of one session returned as evidence, to check quotes against. */
export class Ledger {
  readonly seen: Seen[] = [];

  /** Takes the evidence out of a tool's answer, when it holds some. */
  record(tool: string, answer: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(answer);
    } catch {
      return;
    }
    const found = (parsed as { evidence?: unknown } | null)?.evidence;
    if (!Array.isArray(found)) return;
    const { app, env } = parsed as { app?: string; env?: string };
    for (const item of found as Evidence[]) {
      if (typeof item?.source !== "string" || typeof item.summary !== "string") continue;
      this.seen.push({ ...item, at: item.at ?? null, tool, app, env });
    }
    if (this.seen.length > MAX_SEEN) this.seen.splice(0, this.seen.length - MAX_SEEN);
  }
}

/** The words an evidence can be quoted by: its summary and the text of its data. */
function quotable(item: Seen): string {
  const values: string[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string" || typeof value === "number") values.push(String(value));
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(item.data);
  return plain(`${item.summary} ${values.join(" ")}`);
}

const sameTime = (a: string | null, b: string | null) =>
  a === b || (a !== null && b !== null && Date.parse(a) === Date.parse(b) && !Number.isNaN(Date.parse(a)));

export interface Check {
  ok: boolean;
  problems: string[];
  checked: { quote: string; source: string; at: string | null; status: string }[];
  report?: string;
}

export function checkConclusion(conclusion: Conclusion, ledger: Ledger): Check {
  const problems: string[] = [];
  const checked: Check["checked"] = [];
  const { evidence, certainty } = conclusion;

  if (conclusion.cause.trim().length < 10) problems.push("cause: say what you think happened, in a sentence");
  if (!conclusion.next.trim()) problems.push("next: give the next step for a person to take");

  const environments = new Set(ledger.seen.flatMap((s) => (s.env ? [s.env] : [])));
  if (!conclusion.env && environments.size > 1) {
    problems.push(
      `env: this session read ${[...environments].join(" and ")}: say which environment the conclusion is about (a conclusion about prod is never built on staging)`,
    );
  }

  for (const item of evidence) {
    const quote = plain(item.quote);
    const base = { quote: item.quote, source: item.source, at: item.at };
    if (quote.length < MIN_QUOTE) {
      checked.push({ ...base, status: "too short to prove anything" });
      problems.push(`quote "${item.quote}" is too short: quote the line the tool returned`);
      continue;
    }
    const holding = ledger.seen.filter((s) => quotable(s).includes(quote));
    if (!holding.length) {
      checked.push({ ...base, status: "not found" });
      problems.push(`quote not found in anything a tool returned this session: "${item.quote}"`);
      continue;
    }
    const fromSource = holding.filter((s) => s.source.toLowerCase() === item.source.toLowerCase());
    if (!fromSource.length) {
      const where = [...new Set(holding.map((s) => s.source))].join(", ");
      checked.push({ ...base, status: `found in ${where}, not in ${item.source}` });
      problems.push(`quote "${item.quote}" comes from ${where}, not from ${item.source}`);
      continue;
    }
    const atTime = fromSource.filter((s) => sameTime(s.at, item.at));
    if (!atTime.length) {
      const times = [...new Set(fromSource.map((s) => s.at ?? "no time"))].join(", ");
      checked.push({ ...base, status: `time differs: the evidence says ${times}` });
      problems.push(`quote "${item.quote}" is at ${times}, not ${item.at ?? "no time"}`);
      continue;
    }
    const inScope = atTime.filter((s) => !conclusion.env || !s.env || s.env === conclusion.env);
    if (!inScope.length) {
      const where = [...new Set(atTime.flatMap((s) => (s.env ? [s.env] : [])))].join(", ");
      checked.push({ ...base, status: `from ${where}, not ${conclusion.env}` });
      problems.push(`quote "${item.quote}" comes from ${where}, and the conclusion is about ${conclusion.env}`);
      continue;
    }
    checked.push({ ...base, status: "found" });
  }

  const sources = new Set(evidence.map((e) => e.source.toLowerCase()));
  if (certainty === "confirmed" && sources.size < 2) {
    problems.push("certainty confirmed needs evidence from at least two different sources; otherwise say likely");
  }
  if (certainty === "likely" && !evidence.length)
    problems.push("certainty likely needs at least one piece of evidence");
  if (certainty !== "confirmed" && !conclusion.unknowns.some((u) => u.trim())) {
    problems.push(`unknowns: a ${certainty} conclusion says what is still unknown`);
  }

  const ok = problems.length === 0;
  return { ok, problems, checked, ...(ok ? { report: render(conclusion) } : {}) };
}

/** The same layout for every client. */
function render(conclusion: Conclusion): string {
  const timeline = [...conclusion.evidence].sort((a, b) => {
    if (a.at === b.at) return 0;
    if (a.at === null) return 1;
    if (b.at === null) return -1;
    return Date.parse(a.at) - Date.parse(b.at);
  });
  const scope = [conclusion.app, conclusion.env].filter(Boolean).join(" / ");
  const unknowns = conclusion.unknowns.map((u) => u.trim()).filter(Boolean);
  return [
    `## Conclusion: ${conclusion.certainty}${scope ? ` (${scope})` : ""}`,
    "",
    `**Cause.** ${conclusion.cause.trim()}`,
    "",
    "**Evidence**, oldest first:",
    ...(timeline.length ? timeline.map((e) => `- ${e.at ?? "no time"} · ${e.source} · ${e.quote.trim()}`) : ["- none"]),
    "",
    "**Still unknown**",
    ...(unknowns.length ? unknowns.map((u) => `- ${u}`) : ["- nothing the evidence leaves open"]),
    "",
    `**Next step, for a person.** ${conclusion.next.trim()}`,
    "",
    "_Nothing was changed: every tool is read-only. Each quote above was returned by a tool in this session._",
  ].join("\n");
}
