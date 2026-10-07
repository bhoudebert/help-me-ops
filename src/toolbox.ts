// The toolbox of a workspace: its apps with their environments' connectors,
// its playbooks, and what its addons bring.
import { resolve } from "node:path";
import { addonFolders, loadAddons } from "./addons/loader.ts";
import { addonTools, connectorTypes } from "./addons/runtime.ts";
import { loadConfig, resolveWorkspace } from "./config.ts";
import { createConnectors } from "./connectors/registry.ts";
import { loadPlaybooks } from "./playbooks.ts";
import type { AppSetup } from "./scope.ts";
import type { Toolbox } from "./tools/index.ts";

/** `extraAddons`: the folders of --addons and OPS_ADDONS (see resolveAddonDirs). */
export async function openToolbox(workspace = resolveWorkspace(), extraAddons: string[] = []): Promise<Toolbox> {
  const { config, baseDir } = await loadConfig(workspace);
  const { addons, report } = await loadAddons(addonFolders(baseDir, extraAddons));
  const types = connectorTypes(addons);
  const warnings: string[] = [];

  const apps: AppSetup[] = [];
  for (const [appName, app] of Object.entries(config.apps)) {
    const envs = [];
    for (const [envName, env] of Object.entries(app.envs)) {
      const { connectors, skipped } = await createConnectors(env.sources, baseDir, types);
      warnings.push(...skipped.map((s) => `${appName}/${envName}: ${s}`));
      envs.push({ name: envName, sources: connectors, addons: env.addons });
    }
    apps.push({ name: appName, description: app.description, envs });
  }

  const note = (addon: string, text: string) =>
    report.find((r) => r.name === addon && r.status === "loaded")?.notes.push(text);
  const playbooks = await loadPlaybooks(resolve(baseDir, config.playbooks));
  for (const addon of addons) {
    if (!addon.playbooks) continue;
    const own = await loadPlaybooks(addon.playbooks);
    playbooks.push(...own.map((p) => ({ ...p, id: `${addon.name}/${p.id}` })));
  }
  return { apps, playbooks, addonTools: addonTools(addons, apps, baseDir, note), addons: report, warnings };
}
