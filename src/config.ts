// What a team has: a workspace folder holding ops.config.json (apps, their
// environments, their sources), playbooks/ and, later, knowledge/ and addons/.
// examples/workspace shows how; ADR 0007.
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";

// A source: its type (a connector type from an addon, or "module" for a file of
// your own) and the options that type takes, checked when the connector is made.
const source = z
  .object({
    type: z.string().min(1),
    id: z.string().min(1),
    description: z.string().min(1),
  })
  .loose();

const name = z.string().min(1);

const env = z.object({
  sources: z.array(source).default([]),
  /** Settings per addon in this environment, overriding its environment variables. */
  addons: z.record(name, z.record(z.string(), z.unknown())).default({}),
});

const app = z.object({
  description: z.string().default(""),
  envs: z.record(name, env).refine((envs) => Object.keys(envs).length > 0, "an app needs at least one environment"),
});

export const OpsConfig = z.object({
  apps: z.record(name, app).refine((apps) => Object.keys(apps).length > 0, "declare at least one app"),
  /** Folder of playbooks, relative to the workspace. */
  playbooks: z.string().default("playbooks"),
});
export type OpsConfig = z.infer<typeof OpsConfig>;
export type SourceConfig = z.infer<typeof source>;

export const CONFIG_FILE = "ops.config.json";

/** The workspace folder: --workspace, else OPS_WORKSPACE, else the working directory. */
export function resolveWorkspace(argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): string {
  const at = argv.indexOf("--workspace");
  const given = at >= 0 ? argv[at + 1] : undefined;
  if (at >= 0 && !given) throw new Error("--workspace needs a folder.");
  return resolve(given ?? env.OPS_WORKSPACE ?? ".");
}

export async function loadConfig(workspace = resolveWorkspace()): Promise<{ config: OpsConfig; baseDir: string }> {
  const path = join(workspace, CONFIG_FILE);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(
      `No ${CONFIG_FILE} in ${workspace}. Copy examples/workspace to a folder of your own and point to it with --workspace or OPS_WORKSPACE.`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid config ${path}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
    });
  }
  if (typeof json === "object" && json !== null && "sources" in json && !("apps" in json)) {
    throw new Error(
      `Invalid config ${path}: it uses the flat "sources" list of an earlier version. Put the sources under apps.<app>.envs.<env>.sources (see examples/workspace/ops.config.json), or point to another workspace with --workspace or OPS_WORKSPACE.`,
    );
  }
  const parsed = OpsConfig.safeParse(json);
  if (!parsed.success) throw new Error(`Invalid config ${path}: ${z.prettifyError(parsed.error)}`);
  return { config: parsed.data, baseDir: workspace };
}
