// Which sources and playbooks this installation has: ops.config.json, which
// the people running the system fill in (ops.config.example.json shows how).
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const source = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("file-logs"),
    id: z.string().min(1),
    description: z.string().min(1),
    path: z.string().min(1),
  }),
  z
    .object({
      type: z.literal("module"),
      id: z.string().min(1),
      description: z.string().min(1),
      /** A file exporting createConnector, relative to the config file. */
      module: z.string().min(1),
    })
    .loose(),
]);

export const OpsConfig = z.object({
  sources: z.array(source),
  /** Folder of playbooks, relative to the config file. */
  playbooks: z.string().default("playbooks"),
});
export type OpsConfig = z.infer<typeof OpsConfig>;
export type SourceConfig = OpsConfig["sources"][number];

/** The config file: OPS_CONFIG, else ops.config.json in the working directory. */
export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.OPS_CONFIG ?? "ops.config.json");
}

export async function loadConfig(path = configPath()): Promise<{ config: OpsConfig; baseDir: string }> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(
      `No config at ${path}. Copy ops.config.example.json to ops.config.json and describe your sources, or set OPS_CONFIG.`,
    );
  }
  const parsed = OpsConfig.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new Error(`Invalid config ${path}: ${z.prettifyError(parsed.error)}`);
  return { config: parsed.data, baseDir: dirname(path) };
}
