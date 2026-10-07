// A template for a database source. It answers from an in-memory table so the
// example runs anywhere; replace the table with your client (pg, mysql2, …)
// connected with a READ-ONLY user, and keep the same Evidence shape.
import type { Connector, ConnectorFactory, Evidence, SearchInput } from "../../../src/connectors/types.ts";

interface OrderRow {
  id: string;
  user: string;
  status: string;
  updated_at: string;
}

// TODO: replace with a read-only query, e.g. SELECT id, user_id, status, updated_at FROM orders WHERE id = $1
const TABLE: OrderRow[] = [
  { id: "4511", user: "u-312", status: "confirmed", updated_at: "2026-10-07T09:40:00Z" },
  { id: "4512", user: "u-881", status: "awaiting_payment", updated_at: "2026-10-07T09:58:13Z" },
];

export const createConnector: ConnectorFactory = ({ id, description }): Connector => ({
  id,
  kind: "database",
  description,
  async search(input: SearchInput): Promise<Evidence[]> {
    const wanted = input.query.toLowerCase();
    return TABLE.filter((row) => Object.values(row).some((v) => v.toLowerCase().includes(wanted)))
      .slice(0, input.limit ?? 50)
      .map((row) => ({
        source: id,
        at: row.updated_at,
        summary: `order ${row.id} of ${row.user}: ${row.status} since ${row.updated_at}`,
        data: row,
      }));
  },
});
