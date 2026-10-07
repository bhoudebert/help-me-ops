// The toolbox of a workspace: its apps with their environments' connectors,
// and its playbooks.
import { resolve } from "node:path";
import { loadConfig, resolveWorkspace } from "./config.ts";
import { createConnectors } from "./connectors/registry.ts";
import { loadPlaybooks } from "./playbooks.ts";
import type { AppSetup } from "./scope.ts";
import type { Toolbox } from "./tools/index.ts";

export async function openToolbox(workspace = resolveWorkspace()): Promise<Toolbox> {
  const { config, baseDir } = await loadConfig(workspace);
  const apps: AppSetup[] = [];
  for (const [appName, app] of Object.entries(config.apps)) {
    const envs = [];
    for (const [envName, env] of Object.entries(app.envs)) {
      envs.push({ name: envName, sources: await createConnectors(env.sources, baseDir) });
    }
    apps.push({ name: appName, description: app.description, envs });
  }
  return { apps, playbooks: await loadPlaybooks(resolve(baseDir, config.playbooks)) };
}
