// The code of the __NAME__ addon: one plain function per tool declared in
// addon.json, with the same name. It receives the tool's parameters and a
// context (app, env, settings, workspace, fetch).
//
// PERSONAL DATA: what this function returns is sent to the AI provider of the client.
// Return only what an investigation needs (the lines of the file); leave out names, emails,
// addresses and the like. Guide: https://bhoudebert.github.io/help-me-ops/guide/privacy
//
// Return records (an array of objects), a string, or nothing. A record with `at`
// (a time) and `summary` (one readable line) makes the best evidence; without
// them the core derives a line from the record.
//
// Set the file in ops.config.json, under the environment it belongs to:
//   "addons": { "__NAME__": { "path": "logs/prod.log" } }
// or with the environment variable __ENV___PATH.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

interface Context {
  settings: { path: string };
  workspace: string;
}

export async function search({ term }: { term: string }, { settings, workspace }: Context) {
  const lines = (await readFile(resolve(workspace, settings.path), "utf8")).split("\n");
  return lines
    .filter((line) => line.toLowerCase().includes(term.toLowerCase()))
    .map((line) => ({
      // TODO if your lines start with a time, `at` is it; otherwise it is left empty.
      at: line.split(" ")[0],
      summary: line,
    }));
}
