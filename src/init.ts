// `ops init addon <name> --template file|api|sql`: write a working addon into
// the workspace, ready to edit. It never overwrites a folder (ADR 0009).
import { cp, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export const TEMPLATES = ["file", "api", "sql"] as const;
const NAME = /^[a-z][a-z0-9-]*$/;
const TEMPLATE_DIR = resolve(import.meta.dirname, "../templates/addon");

export const INIT_USAGE = `Usage: npm run ops -- init addon <name> --template file|api|sql [--workspace <dir>]

  file   search a text file (logs, exports)
  api    GET a REST API with a token
  sql    SELECT from a PostgreSQL database (read-only)`;

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

/** Writes the addon and returns what to do next, as text. */
export async function initAddon(workspace: string, args: string[]): Promise<string> {
  const [what, name] = args;
  const template = option(args, "--template");
  if (what !== "addon" || !name || name.startsWith("--")) throw new Error(INIT_USAGE);
  if (!NAME.test(name))
    throw new Error(`"${name}" is not a name: use lowercase letters, digits and hyphens (order, my-db).`);
  if (!TEMPLATES.includes(template as (typeof TEMPLATES)[number])) {
    throw new Error(`--template must be one of ${TEMPLATES.join(", ")}.\n\n${INIT_USAGE}`);
  }
  const target = join(workspace, "addons", name);
  if (existsSync(target))
    throw new Error(`${target} already exists: nothing was written. Pick another name or remove it.`);

  await mkdir(join(workspace, "addons"), { recursive: true });
  await cp(join(TEMPLATE_DIR, template!), target, { recursive: true, errorOnExist: true });
  const variables = { __NAME__: name, __ENV__: name.toUpperCase().replaceAll("-", "_") };
  for (const file of await readdir(target)) {
    const path = join(target, file);
    let text = await readFile(path, "utf8");
    for (const [key, value] of Object.entries(variables)) text = text.replaceAll(key, value);
    const final = file.endsWith(".tpl") ? path.slice(0, -4) : path;
    await writeFile(path, text);
    if (final !== path) await rename(path, final);
  }

  return [
    `Wrote ${target}/addon.json and tools.ts.`,
    "",
    "Next:",
    "  1. Open both files and follow the TODO comments (what it reads, the tool names).",
    ...(template === "sql"
      ? [`  2. cd ${workspace} && npm install pg   # the driver lives in the workspace, not in help-me-ops`]
      : []),
    `  ${template === "sql" ? 3 : 2}. Give it its settings under the environment that uses it, in ops.config.json:`,
    `       "addons": { "${name}": { ... } }   (the addon.json lists the settings; credentials as "\${VARIABLE}")`,
    `  ${template === "sql" ? 4 : 3}. npm run ops -- --workspace ${workspace} doctor   # the addon must show as loaded`,
    "Read-only: use an account that can only read.",
  ].join("\n");
}
