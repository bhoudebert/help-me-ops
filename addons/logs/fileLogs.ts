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
      const wanted = input.query.toLowerCase();
      const from = input.from ? Date.parse(input.from) : -Infinity;
      const to = input.to ? Date.parse(input.to) : Infinity;
      const found: Evidence[] = [];
      for (const line of text.split("\n")) {
        if (!line.toLowerCase().includes(wanted)) continue;
        const at = STAMP.exec(line)?.[1] ?? null;
        const ms = at ? Date.parse(at) : NaN;
        // A line without a time is kept only when no window was asked for.
        if (Number.isNaN(ms) ? input.from || input.to : ms < from || ms > to) continue;
        found.push({ source: options.id, at, summary: line.trim(), data: { line } });
        if (found.length >= (input.limit ?? DEFAULT_LIMIT)) break;
      }
      return found;
    },
  };
}
