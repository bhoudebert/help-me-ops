// Metrics of the shop (CPU, memory, queue depth). A template for a metrics
// addon: it reads recorded series from a JSON file so the demo runs anywhere.
// To plug in Prometheus, replace readSeries() with a range query over its HTTP
// API (read-only), and keep the Evidence shape.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AddonExport } from "../../../../src/addons/types.ts";

interface Series {
  description: string;
  unit: string;
  points: [string, number][];
}

const addon: AddonExport = ({ z, defineTool }) => {
  const readSeries = async (workspace: string, settings: Record<string, unknown>) =>
    (
      JSON.parse(await readFile(resolve(workspace, String(settings.file)), "utf8")) as {
        series: Record<string, Series>;
      }
    ).series;
  const hints = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

  return {
    apiVersion: 1,
    settings: z.object({ file: z.string().min(1) }),
    env: { file: "METRICS_FILE" },
    tools: [
      defineTool({
        name: "listMetrics",
        description: "The metrics available, each with what it measures. Call it to know what to query.",
        inputSchema: z.object({}),
        annotations: hints,
        run: async (_input, { workspace, settings }) =>
          Object.entries(await readSeries(workspace, settings)).map(([name, s]) => ({
            source: "metrics",
            at: null,
            summary: `${name} (${s.unit}): ${s.description}`,
            data: { name, unit: s.unit },
          })),
      }),
      defineTool({
        name: "queryMetric",
        description: "The points of one metric, optionally within a time window, oldest first. Read-only.",
        inputSchema: z.object({
          metric: z.string().min(1).describe("Metric name, from listMetrics"),
          from: z.string().optional().describe("Start of the window, ISO 8601"),
          to: z.string().optional().describe("End of the window, ISO 8601"),
        }),
        annotations: hints,
        run: async ({ metric, from, to }, { workspace, settings }) => {
          const series = await readSeries(workspace, settings);
          const found = series[metric];
          if (!found) throw new Error(`No metric "${metric}". Known: ${Object.keys(series).join(", ")}.`);
          const [start, end] = [from ? Date.parse(from) : -Infinity, to ? Date.parse(to) : Infinity];
          return found.points
            .filter(([at]) => Date.parse(at) >= start && Date.parse(at) <= end)
            .map(([at, value]) => ({
              source: "metrics",
              at,
              summary: `${metric} = ${value} ${found.unit} at ${at}`,
              data: { metric, value, unit: found.unit },
            }));
        },
      }),
    ],
  };
};

export default addon;
