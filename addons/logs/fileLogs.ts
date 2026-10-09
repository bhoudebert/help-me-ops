// A working example connector: plain-text log files, one event per line,
// starting with an ISO 8601 timestamp. Copy it for your own formats.
import { readFile } from "node:fs/promises";
import { type Connector, DEFAULT_LIMIT, type Evidence, type SearchInput } from "../../src/connectors/types.ts";

const STAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)/;

export function fileLogs(options: { id: string; description: string; path: string }): Connector {
  return {
    id: options.id,
    kind: "logs",
    description: options.description,
    async search(input: SearchInput): Promise<Evidence[]> {
      const text = await readFile(options.path, "utf8");
      // Every word must be in the line, in any order: "slow checkout" finds "checkout ... slow".
      const words = [...new Set(input.query.toLowerCase().split(/\s+/).filter(Boolean))];
      const from = input.from ? Date.parse(input.from) : -Infinity;
      const to = input.to ? Date.parse(input.to) : Infinity;
      const limit = input.limit ?? DEFAULT_LIMIT;
      const candidates: { evidence: Evidence; matched: number }[] = [];
      for (const line of text.split("\n")) {
        const lower = line.toLowerCase();
        const matched = words.filter((word) => lower.includes(word)).length;
        if (!matched) continue;
        const at = STAMP.exec(line)?.[1] ?? null;
        const ms = at ? Date.parse(at) : NaN;
        // A line without a time is kept only when no window was asked for.
        if (Number.isNaN(ms) ? input.from || input.to : ms < from || ms > to) continue;
        candidates.push({ evidence: { source: options.id, at, summary: line.trim(), data: { line } }, matched });
      }
      const whole = candidates.filter((c) => c.matched === words.length).map((c) => c.evidence);
      if (whole.length || words.length < 2) return whole.slice(0, limit);
      // No line has every word: the lines with the most of them, best first, marked as partial.
      return candidates
        .sort((a, b) => b.matched - a.matched)
        .slice(0, limit)
        .map(({ evidence, matched }) => ({
          ...evidence,
          data: { line: (evidence.data as { line: string }).line, partial: `${matched} of ${words.length} words` },
        }));
    },
  };
}
