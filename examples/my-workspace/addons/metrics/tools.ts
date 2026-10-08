// The code of the metrics addon. Demo: recorded series in a JSON file. For real,
// replace readSeries() with a range query on your metrics store (Prometheus,
// Datadog …), read-only, and keep returning one record per point.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

interface Context {
  settings: { path: string };
  workspace: string;
}

interface Series {
  description: string;
  unit: string;
  points: [string, number][];
}

async function readSeries({ settings, workspace }: Context): Promise<Record<string, Series>> {
  return (JSON.parse(await readFile(resolve(workspace, settings.path), "utf8")) as { series: Record<string, Series> })
    .series;
}

export async function listMetrics(_params: unknown, context: Context) {
  return Object.entries(await readSeries(context)).map(([name, s]) => ({
    name,
    unit: s.unit,
    summary: `${name} (${s.unit}): ${s.description}`,
  }));
}

export async function queryMetric(
  { metric, from, to }: { metric: string; from?: string; to?: string },
  context: Context,
) {
  const series = await readSeries(context);
  const found = series[metric];
  if (!found) throw new Error(`No metric "${metric}". Known: ${Object.keys(series).join(", ")}.`);
  const [start, end] = [from ? Date.parse(from) : -Infinity, to ? Date.parse(to) : Infinity];
  return found.points
    .filter(([at]) => Date.parse(at) >= start && Date.parse(at) <= end)
    .map(([at, value]) => ({
      at,
      metric,
      value,
      unit: found.unit,
      summary: `${metric} = ${value} ${found.unit} at ${at}`,
    }));
}
