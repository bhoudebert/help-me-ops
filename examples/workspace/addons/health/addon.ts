// HTTP health checks of the shop's endpoints and of the payment provider. A
// template for a health addon: it replays recorded checks from a JSON file so
// the demo runs anywhere. To check for real, replace readChecks() with a GET
// per target (read-only) and keep the Evidence shape.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AddonExport } from "../../../../src/addons/types.ts";

interface Check {
  at: string;
  target: string;
  status: number;
  ms: number;
  note: string;
}

const addon: AddonExport = ({ z, defineTool }) => ({
  apiVersion: 1,
  settings: z.object({ file: z.string().min(1) }),
  env: { file: "HEALTH_FILE" },
  tools: [
    defineTool({
      name: "checkHealth",
      description:
        "Recorded HTTP checks of the shop's endpoints and of its payment provider, oldest first: the status and the latency of each. Read-only.",
      inputSchema: z.object({
        target: z.string().optional().describe("Part of the target name, e.g. hooks or provider"),
        from: z.string().optional().describe("Start of the window, ISO 8601"),
        to: z.string().optional().describe("End of the window, ISO 8601"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      run: async ({ target, from, to }, { workspace, settings }) => {
        const { checks } = JSON.parse(await readFile(resolve(workspace, String(settings.file)), "utf8")) as {
          checks: Check[];
        };
        const [start, end] = [from ? Date.parse(from) : -Infinity, to ? Date.parse(to) : Infinity];
        return checks
          .filter((c) => !target || c.target.toLowerCase().includes(target.toLowerCase()))
          .filter((c) => Date.parse(c.at) >= start && Date.parse(c.at) <= end)
          .map((c) => ({
            source: "health",
            at: c.at,
            summary: `${c.target} -> ${c.status} in ${c.ms}ms (${c.note})`,
            data: c,
          }));
      },
    }),
  ],
});

export default addon;
