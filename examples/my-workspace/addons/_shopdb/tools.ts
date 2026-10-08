// The code of the shopdb addon: one plain function per tool declared in
// addon.json. It reads PostgreSQL with the `pg` driver, which is installed in
// the workspace (`cd examples/my-workspace && npm install`), not in help-me-ops.
//
// READ-ONLY, twice: the URL is the `readonly` user of docker/init.sql, which
// can only SELECT, and every query runs inside a read-only transaction. The
// question goes in as a parameter ($1), never glued into the SQL.
import pg from "pg";

interface Context {
  settings: { url: string };
}

/** One read: connect, open a read-only transaction, run one SELECT, always clean up. */
async function select(url: string, sql: string, params: unknown[]): Promise<Record<string, unknown>[]> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    return (await client.query(sql, params)).rows;
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}

export async function paymentsFor({ order }: { order: string }, { settings }: Context) {
  const payments = await select(
    settings.url,
    `SELECT order_id, provider_ref, status, amount::float AS amount, captured_at AS at
       FROM payments WHERE order_id = $1 ORDER BY captured_at LIMIT 100`,
    [order],
  );
  const events = await select(
    settings.url,
    `SELECT order_id, event, outcome, attempt, at
       FROM webhook_events WHERE order_id = $1 ORDER BY at LIMIT 100`,
    [order],
  );
  return [
    ...payments.map((p) => ({
      ...p,
      summary: `payment ${String(p.provider_ref)} of order ${order}: ${String(p.status)}, ${String(p.amount)} EUR`,
    })),
    ...events.map((e) => ({
      ...e,
      summary: `webhook ${String(e.event)} of order ${order}: ${String(e.outcome)} (attempt ${String(e.attempt)})`,
    })),
  ];
}

export async function paidButUnconfirmed({ since }: { since?: string }, { settings }: Context) {
  const rows = await select(
    settings.url,
    `SELECT o.id AS order_id, o.user_id, o.status, p.amount::float AS amount, p.captured_at AS at
       FROM orders o JOIN payments p ON p.order_id = o.id
      WHERE o.status = 'awaiting_payment' AND p.status = 'captured'
        AND ($1::timestamptz IS NULL OR p.captured_at >= $1::timestamptz)
      ORDER BY p.captured_at LIMIT 100`,
    [since ?? null],
  );
  return rows.map((r) => ({
    ...r,
    summary: `order ${String(r.order_id)} of ${String(r.user_id)}: paid ${String(r.amount)} EUR, still ${String(r.status)}`,
  }));
}
