// The code of the order addon: one plain function per tool declared in
// addon.json. Return records (or a string, or nothing); the core turns them
// into evidence. A record with `at` (a time) and `summary` (one readable line)
// gives the best evidence; without them it is derived.
//
// Demo: the orders come from a JSON file. For real, replace readOrders() with a
// READ-ONLY query (a read-only database user, SELECT only) and keep the rest.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

interface Context {
  settings: { path: string };
  workspace: string;
}

interface Order {
  id: string;
  user: string;
  status: string;
  total: number;
  created_at: string;
  updated_at: string;
}

async function readOrders({ settings, workspace }: Context): Promise<Order[]> {
  // TODO real system: SELECT id, user_id AS user, status, total, created_at, updated_at FROM orders WHERE …
  return (JSON.parse(await readFile(resolve(workspace, settings.path), "utf8")) as { orders: Order[] }).orders;
}

const record = (o: Order) => ({
  ...o,
  at: o.updated_at,
  summary: `order ${o.id} of ${o.user}: ${o.status} since ${o.updated_at} (${o.total.toFixed(2)} EUR)`,
});

export async function getOrder({ id }: { id: string }, context: Context) {
  return (await readOrders(context)).filter((o) => o.id === id).map(record);
}

export async function listOrders({ status, since }: { status: string; since?: string }, context: Context) {
  return (await readOrders(context))
    .filter((o) => o.status === status && (!since || Date.parse(o.updated_at) >= Date.parse(since)))
    .map(record);
}
