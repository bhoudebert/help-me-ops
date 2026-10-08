// The code of the __NAME__ addon: one plain function per tool declared in
// addon.json, with the same name. It receives the tool's parameters and a
// context (app, env, settings, workspace, fetch).
//
// Needs the PostgreSQL driver next to the addon:
//   cd <your workspace> && npm install pg
// (another database: use its driver in the same way.)
//
// PERSONAL DATA: what this function returns is sent to the AI provider of the client.
// Return only what an investigation needs (the columns you select); leave out names, emails,
// addresses and the like. Guide: https://bhoudebert.github.io/help-me-ops/guide/privacy
//
// READ-ONLY, twice: connect with a database user that can only SELECT, and the
// code runs inside a read-only transaction. Give the question as a parameter
// ($1), never build SQL from text the assistant wrote.
//
// Put the connection URL in your environment, never in a file:
//   export __ENV___DATABASE_URL=postgres://reader:...@host/db
// or per environment in ops.config.json:
//   "addons": { "__NAME__": { "url": "${PROD_DATABASE_URL}" } }
import pg from "pg";

interface Context {
  settings: { url: string };
}

export async function getRecord({ id }: { id: string }, { settings }: Context) {
  const client = new pg.Client({ connectionString: settings.url });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    // TODO your table and columns; keep the $1 parameter and the LIMIT.
    const { rows } = await client.query("SELECT * FROM items WHERE id = $1 LIMIT 100", [id]);
    return rows.map((row: Record<string, unknown>) => ({
      ...row,
      // TODO the column holding when the row last changed.
      at: row.updated_at,
      summary: `item ${id}: ${JSON.stringify(row).slice(0, 200)}`,
    }));
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
}
