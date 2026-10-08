// `ops init addon <name> --template file|api|sql` writes a working addon into
// the workspace, ready to edit (ADR 0009). `ops init workspace <folder>` writes
// the folder itself: a configuration, a starter playbook, a README. Neither
// ever overwrites anything.
import { cp, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export const TEMPLATES = ["file", "api", "sql"] as const;
const NAME = /^[a-z][a-z0-9-]*$/;
const TEMPLATE_DIR = resolve(import.meta.dirname, "../templates/addon");
const WORKSPACE_TEMPLATE = resolve(import.meta.dirname, "../templates/workspace");

export const INIT_USAGE = `Usage: npm run ops -- init workspace <folder> [--app <name>] [--envs prod,staging]
       npm run ops -- init addon <name> --template file|api|sql [--workspace <dir>]

  workspace  a new folder for your own system: configuration, a starter playbook, a README
  addon      a working addon in the workspace, to edit:
    file   search a text file (logs, exports)
    api    GET a REST API with a token
    sql    SELECT from a PostgreSQL database (read-only)`;

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

/** `init workspace` or `init addon`: the workspace is the one found with --workspace, OPS_WORKSPACE or the current folder. */
export async function runInit(workspace: string, args: string[]): Promise<string> {
  if (args[0] === "workspace") return initWorkspace(workspace, args);
  return initAddon(workspace, args);
}

/** Creates the workspace folder `<folder>` (or the one found by --workspace) and returns what to do next. */
export async function initWorkspace(found: string, args: string[]): Promise<string> {
  const positional = args
    .slice(1)
    .filter((arg, index, all) => !arg.startsWith("--") && !all[index - 1]?.startsWith("--"));
  if (positional.length > 1) throw new Error(INIT_USAGE);
  const folder = resolve(positional[0] ?? found);
  const app = option(args, "--app") ?? "my-app";
  const envs = (option(args, "--envs") ?? "prod,staging").split(",").map((e) => e.trim());
  if (!NAME.test(app))
    throw new Error(`--app "${app}" is not a name: use lowercase letters, digits and hyphens (shop, my-api).`);
  for (const env of envs) {
    if (!NAME.test(env))
      throw new Error(`environment "${env}" is not a name: use lowercase letters, digits and hyphens (prod, staging).`);
  }
  if (new Set(envs).size !== envs.length) throw new Error(`--envs lists an environment twice: ${envs.join(", ")}`);

  const files: Record<string, string> = {};
  const configuration = {
    apps: {
      [app]: {
        description: "TODO say what this system does, in one sentence: the assistant reads it to choose where to look",
        envs: Object.fromEntries(envs.map((env) => [env, { sources: [], addons: {} }])),
      },
    },
    playbooks: "playbooks",
  };
  files["ops.config.json"] = `${JSON.stringify(configuration, null, 2)}\n`;
  for (const path of ["README.md", "playbooks/README.md", "playbooks/first-incident.md", "addons/README.md"]) {
    files[path] = (await readFile(join(WORKSPACE_TEMPLATE, path), "utf8")).replaceAll("{{app}}", app);
  }
  const clash = Object.keys(files).filter((path) => existsSync(join(folder, path)));
  if (clash.length)
    throw new Error(
      `${folder} already has ${clash.join(", ")}: nothing was written. Use another folder, or remove them.`,
    );

  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(folder, path, ".."), { recursive: true });
    await writeFile(join(folder, path), content);
  }
  return [
    `Created ${folder}: app "${app}", environments ${envs.join(", ")}.`,
    "",
    "Next:",
    "  1. Point help-me-ops at it, once, in the .env of the help-me-ops clone:",
    `       OPS_WORKSPACE=${folder}`,
    `  2. Add the evidence you have: open ${basename(folder)}/ops.config.json and add a log file under sources of an environment,`,
    "     or switch on an addon (npm run ops -- init addon <name> --template file|api|sql).",
    "  3. npm run ops -- doctor        # shows the workspace and its addons",
    `The README in ${basename(folder)}/ lists what each file is for.`,
  ].join("\n");
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
    `  ${template === "sql" ? 5 : 4}. npm run ops -- addon check ${target}   # ok / warn / FAIL, with the fix; edit check.json for the samples`,
    "Read-only: use an account that can only read.",
  ].join("\n");
}
