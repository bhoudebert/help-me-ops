// The toolbox of a workspace: its apps with their environments' connectors,
// its playbooks, and what its addons bring.
import { join, resolve } from "node:path";
import { addonFolders, loadAddons } from "./addons/loader.ts";
import { addonTools, connectorTypes } from "./addons/runtime.ts";
import { loadConfig, resolveWorkspace } from "./config.ts";
import { createConnectors } from "./connectors/registry.ts";
import { loadPlaybooks } from "./playbooks.ts";
import { createMasker } from "./privacy.ts";
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
  const idle = (addon: string, reason: string) => {
    const entry = report.find((r) => r.name === addon && r.status === "loaded");
    if (entry)
      Object.assign(entry, {
        status: "idle",
        reason,
      });
  };
  const playbooks = await loadPlaybooks(resolve(baseDir, config.playbooks));
  for (const addon of addons) {
    if (!addon.playbooks) continue;
    const own = await loadPlaybooks(addon.playbooks);
    playbooks.push(...own.map((p) => ({ ...p, id: `${addon.name}/${p.id}` })));
  }
  const knowledge = [
    { dir: join(baseDir, "knowledge"), origin: "workspace" },
    { dir: resolve(baseDir, config.playbooks), origin: "playbooks" },
    ...addons.flatMap((addon) => [
      ...(addon.knowledge ? [{ dir: addon.knowledge, origin: `addon:${addon.name}` }] : []),
      ...(addon.playbooks ? [{ dir: addon.playbooks, origin: `addon:${addon.name}` }] : []),
    ]),
  ];
  return {
    workspace: baseDir,
    privacy: config.privacy,
    masker: createMasker(
      config.privacy,
      Object.fromEntries(addons.flatMap((a) => (a.definition?.privacy ? [[a.name, a.definition.privacy]] : []))),
    ),
    apps,
    playbooks,
    knowledge,
    addonTools: addonTools(addons, apps, baseDir, note, process.env, globalThis.fetch, idle),
    addons: report,
    warnings,
  };
}
