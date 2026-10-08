// Find the addon folders, load each one, and say what happened to each. An
// addon that fails is skipped with a reason; the others keep working.
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { AddonPrivacy } from "../privacy.ts";
import { loadManifestAddon } from "./manifest.ts";
import { ADDON_API_VERSION, defineTool, type AddonDefinition, type AddonExport } from "./types.ts";

export type Origin = "built-in" | "extra" | "workspace";

export interface AddonFolder {
  dir: string;
  origin: Origin;
}

export interface LoadedAddon {
  name: string;
  dir: string;
  origin: Origin;
  definition: AddonDefinition | null;
  playbooks: string | null;
  knowledge: string | null;
}

export interface AddonReport {
  name: string;
  dir: string;
  origin: Origin;
  status: "loaded" | "skipped" | "replaced" | "idle";
  reason?: string;
  /** Things that do not work although the addon loaded, e.g. settings missing in one environment. */
  notes: string[];
}

const NAME = /^[a-z][a-z0-9-]*$/;

/** Extra addon folders: --addons and OPS_ADDONS, ":"-separated. */
export function resolveAddonDirs(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const at = argv.indexOf("--addons");
  const given = at >= 0 ? argv[at + 1] : undefined;
  if (at >= 0 && !given) throw new Error("--addons needs a folder.");
  return [given, env.OPS_ADDONS]
    .flatMap((list) => (list ?? "").split(delimiter))
    .filter(Boolean)
    .map((dir) => resolve(dir));
}

/** The built-ins of this repository, then the extra folders, then the workspace's. */
export function addonFolders(workspace: string, extra: string[]): AddonFolder[] {
  return [
    { dir: resolve(import.meta.dirname, "../../addons"), origin: "built-in" },
    ...extra.map((dir) => ({ dir, origin: "extra" as const })),
    { dir: join(workspace, "addons"), origin: "workspace" },
  ];
}

const hints = z.object({
  readOnlyHint: z.literal(true, "a tool must declare readOnlyHint: true (ADR 0002)"),
  destructiveHint: z.literal(false, "a tool must declare destructiveHint: false (ADR 0002)"),
  idempotentHint: z.boolean(),
  openWorldHint: z.boolean(),
});
const schemaLike = z.custom<z.ZodObject>(
  (v) => typeof (v as { parse?: unknown } | null)?.parse === "function" && "shape" in (v as object),
  "expected a zod object schema",
);
const fn = z.custom<(...args: never[]) => unknown>((v) => typeof v === "function", "expected a function");

const Definition = z.object({
  apiVersion: z.number().int(),
  settings: schemaLike.optional(),
  env: z.record(z.string(), z.string()).optional(),
  tools: z
    .array(
      z.object({
        name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, "a tool name is letters, digits and underscores"),
        description: z.string().min(1),
        inputSchema: schemaLike,
        annotations: hints,
        run: fn,
      }),
    )
    .optional(),
  connectors: z.record(z.string(), z.object({ options: schemaLike, create: fn })).optional(),
  privacy: AddonPrivacy.optional(),
});

export async function loadDefinition(file: string): Promise<AddonDefinition> {
  const module = (await import(pathToFileURL(file).href)) as { default?: AddonExport };
  if (module.default === undefined) throw new Error("addon.ts has no default export");
  const raw = typeof module.default === "function" ? await module.default({ z, defineTool }) : module.default;
  const version = (raw as { apiVersion?: unknown } | null)?.apiVersion;
  if (version !== ADDON_API_VERSION) {
    throw new Error(`written for addon API ${String(version)}, this version supports ${ADDON_API_VERSION}`);
  }
  const parsed = Definition.safeParse(raw);
  if (!parsed.success) throw new Error(`invalid definition: ${z.prettifyError(parsed.error)}`);
  return raw as AddonDefinition;
}

const dirOrNull = (dir: string) => (existsSync(dir) ? dir : null);

/** Load every addon of the folders, in order; a later one replaces an earlier one of the same name. */
export async function loadAddons(folders: AddonFolder[]): Promise<{ addons: LoadedAddon[]; report: AddonReport[] }> {
  const addons = new Map<string, LoadedAddon>();
  const report: AddonReport[] = [];
  for (const { dir: root, origin } of folders) {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries
      .filter((e) => e.isDirectory() && !/^[_.]/.test(e.name))
      .sort((a, b) => a.name.localeCompare(b.name))) {
      const dir = join(root, entry.name);
      const file = join(dir, "addon.ts");
      const manifest = join(dir, "addon.json");
      const playbooks = dirOrNull(join(dir, "playbooks"));
      const knowledge = dirOrNull(join(dir, "knowledge"));
      if (!existsSync(file) && !existsSync(manifest) && !playbooks && !knowledge) continue;
      const entryReport: AddonReport = { name: entry.name, dir, origin, status: "loaded", notes: [] };
      report.push(entryReport);
      if (!NAME.test(entry.name)) {
        Object.assign(entryReport, {
          status: "skipped",
          reason: "the folder name must be lowercase letters, digits and hyphens",
        });
        continue;
      }
      let definition: AddonDefinition | null = null;
      if (existsSync(file) && existsSync(manifest)) {
        Object.assign(entryReport, {
          status: "skipped",
          reason: "it has both addon.json and addon.ts: keep one",
        });
        continue;
      }
      if (existsSync(file) || existsSync(manifest)) {
        try {
          definition = existsSync(manifest) ? await loadManifestAddon(dir, entry.name) : await loadDefinition(file);
        } catch (error) {
          Object.assign(entryReport, {
            status: "skipped",
            reason: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
      }
      const before = addons.get(entry.name);
      if (before) {
        const earlier = report.find((r) => r.dir === before.dir)!;
        Object.assign(earlier, { status: "replaced", reason: `replaced by ${dir}` });
        entryReport.reason = `replaces ${before.dir}`;
      }
      addons.set(entry.name, { name: entry.name, dir, origin, definition, playbooks, knowledge });
    }
  }
  return { addons: [...addons.values()], report };
}

/** One line per addon, for `doctor` and for the start-up of the servers. */
export function formatReport(report: AddonReport[]): string[] {
  return report.flatMap((r) => [
    `  ${r.name.padEnd(16)} ${r.status.padEnd(9)} (${r.origin}) ${r.dir}${r.reason ? ` - ${r.reason}` : ""}`,
    ...r.notes.map((note) => `  ${"".padEnd(16)} ! ${note}`),
  ]);
}
