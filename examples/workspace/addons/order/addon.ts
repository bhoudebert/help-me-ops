// The orders of the shop. A template for a database-backed addon: it answers
// from a JSON file so the demo runs anywhere. To plug in the real database,
// replace readOrders() with a read-only query (pg, mysql2, …) using a URL
// named in the configuration as "${ORDER_DB_URL}", and keep the Evidence shape.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AddonExport } from "../../../../src/addons/types.ts";

interface Order {
  id: string;
  user: string;
  status: string;
  total: number;
  created_at: string;
  updated_at: string;
}

const addon: AddonExport = ({ z, defineTool }) => {
  // TODO: replace with a read-only query, e.g. SELECT … FROM orders WHERE id = $1
  const readOrders = async (workspace: string, settings: Record<string, unknown>) =>
    (JSON.parse(await readFile(resolve(workspace, String(settings.dataFile)), "utf8")) as { orders: Order[] }).orders;

  const evidence = (o: Order) => ({
    source: "order",
    at: o.updated_at,
    summary: `order ${o.id} of ${o.user}: ${o.status} since ${o.updated_at} (${o.total.toFixed(2)} EUR)`,
    data: o,
  });
  const hints = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

  return {
    apiVersion: 1,
    settings: z.object({ dataFile: z.string().min(1) }),
    env: { dataFile: "ORDER_DATA_FILE" },
    tools: [
      defineTool({
        name: "getOrder",
        description: "One order by its number: its user, status and when it last changed. Read-only.",
        inputSchema: z.object({ id: z.string().min(1).describe("The order number, e.g. 4512") }),
        annotations: hints,
        run: async ({ id }, { workspace, settings }) =>
          (await readOrders(workspace, settings)).filter((o) => o.id === id).map(evidence),
      }),
      defineTool({
        name: "listOrders",
        description:
          "Orders in a status, optionally changed since a time: to see how many others are affected. Read-only.",
        inputSchema: z.object({
          status: z.string().min(1).describe("e.g. awaiting_payment, confirmed"),
          since: z.string().optional().describe("Only orders updated at or after this time, ISO 8601"),
        }),
        annotations: hints,
        run: async ({ status, since }, { workspace, settings }) =>
          (await readOrders(workspace, settings))
            .filter((o) => o.status === status && (!since || Date.parse(o.updated_at) >= Date.parse(since)))
            .map(evidence),
      }),
    ],
  };
};

export default addon;
