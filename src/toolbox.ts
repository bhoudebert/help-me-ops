// The toolbox of this installation: its config, connectors and playbooks.
import { resolve } from "node:path";
import { configPath, loadConfig } from "./config.ts";
import { createConnectors } from "./connectors/registry.ts";
import { loadPlaybooks } from "./playbooks.ts";
import type { Toolbox } from "./tools/index.ts";

export async function openToolbox(path = configPath()): Promise<Toolbox> {
  const { config, baseDir } = await loadConfig(path);
  return {
    sources: await createConnectors(config.sources, baseDir),
    playbooks: await loadPlaybooks(resolve(baseDir, config.playbooks)),
  };
}
