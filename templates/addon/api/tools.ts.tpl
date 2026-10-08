// The code of the __NAME__ addon: one plain function per tool declared in
// addon.json, with the same name. It receives the tool's parameters and a
// context (app, env, settings, workspace, fetch).
//
// READ-ONLY: only GET. Use a token that can only read, so even a mistake here
// cannot change anything.
//
// PERSONAL DATA: what this function returns is sent to the AI provider of the client.
// Return only what an investigation needs (the fields of the API answer); leave out names, emails,
// addresses and the like. Guide: https://bhoudebert.github.io/help-me-ops/guide/privacy
//
// Return records (an array of objects), a string, or nothing. A record with `at`
// (a time) and `summary` (one readable line) makes the best evidence.
//
// Put the credential in your environment, never in a file:
//   export __ENV___TOKEN=...
// and the URL per environment in ops.config.json:
//   "addons": { "__NAME__": { "url": "https://api.example.com", "token": "${__ENV___TOKEN}" } }
interface Context {
  settings: { url: string; token: string };
  fetch: typeof fetch;
}

export async function getItem({ id }: { id: string }, { settings, fetch }: Context) {
  // TODO the path of your API.
  const response = await fetch(`${settings.url}/items/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: { authorization: `Bearer ${settings.token}`, accept: "application/json" },
  });
  if (!response.ok) throw new Error(`GET /items/${id} answered ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  return [
    {
      ...body,
      // TODO name the fields of your API: when it changed, and a line to read.
      at: body.updated_at,
      summary: `item ${id}: ${JSON.stringify(body).slice(0, 200)}`,
    },
  ];
}
