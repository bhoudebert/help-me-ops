// The code of the health addon. Demo: recorded checks in a JSON file. For real,
// replace the file read with one GET per target (read-only) and return the
// status and the latency the same way.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

interface Check {
  at: string;
  target: string;
  status: number;
  ms: number;
  note: string;
}

export async function checkHealth(
  { target, from, to }: { target?: string; from?: string; to?: string },
  { settings, workspace }: { settings: { path: string }; workspace: string },
) {
  const { checks } = JSON.parse(await readFile(resolve(workspace, settings.path), "utf8")) as { checks: Check[] };
  const [start, end] = [from ? Date.parse(from) : -Infinity, to ? Date.parse(to) : Infinity];
  return checks
    .filter((c) => !target || c.target.toLowerCase().includes(target.toLowerCase()))
    .filter((c) => Date.parse(c.at) >= start && Date.parse(c.at) <= end)
    .map((c) => ({ ...c, summary: `${c.target} -> ${c.status} in ${c.ms}ms (${c.note})` }));
}
