// From loaded addons to what the toolbox serves: settings per app and
// environment, namespaced tools, connector types.
import { z } from "zod";
import type { ConnectorType } from "./types.ts";
import type { LoadedAddon } from "./loader.ts";
import { resolveScope, type AppSetup } from "../scope.ts";
import { appParam, envParam, type ToolDefinition } from "../tools/index.ts";

type Settings = Record<string, unknown>;

/** `${NAME}` in a configured string is the environment variable NAME: credentials stay out of the file. */
function fromEnvironment(value: unknown, env: NodeJS.ProcessEnv): unknown {
  if (typeof value !== "string") return value;
  return value.replace(/\$\{(\w+)\}/g, (_, name: string) => {
    const found = env[name];
    if (found === undefined) throw new Error(`environment variable ${name} is not set`);
    return found;
  });
}

/** Settings of an addon in one environment: its environment variables, overridden by the configuration. */
export function resolveSettings(
  addon: LoadedAddon,
  overrides: Settings | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Settings {
  const definition = addon.definition;
  if (!definition?.settings) return {};
  const raw: Settings = {};
  for (const [field, name] of Object.entries(definition.env ?? {})) if (env[name] !== undefined) raw[field] = env[name];
  for (const [field, value] of Object.entries(overrides ?? {})) raw[field] = fromEnvironment(value, env);
  const parsed = definition.settings.safeParse(raw);
  if (!parsed.success) throw new Error(`invalid settings: ${z.prettifyError(parsed.error).replaceAll("\n", " ")}`);
  return parsed.data as Settings;
}

/** The connector types the addons bring, by the `type` they answer to; a later addon wins. */
export function connectorTypes(addons: LoadedAddon[]): Map<string, ConnectorType> {
  const types = new Map<string, ConnectorType>();
  for (const addon of addons) {
    for (const [type, connector] of Object.entries(addon.definition?.connectors ?? {})) types.set(type, connector);
  }
  return types;
}

/**
 * The tools of the addons, namespaced (`order.getOrder`), each reading one app
 * and environment like the core tools. Settings are checked for every
 * environment now; an environment where they are invalid is noted and refused
 * at call time, and the rest works.
 */
export function addonTools(
  addons: LoadedAddon[],
  apps: AppSetup[],
  workspace: string,
  notes: (addon: string, note: string) => void,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = globalThis.fetch,
): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  for (const addon of addons) {
    const definition = addon.definition;
    if (!definition?.tools?.length) continue;
    const settings = new Map<string, Settings | string>();
    for (const app of apps) {
      for (const environment of app.envs) {
        const key = `${app.name}/${environment.name}`;
        try {
          settings.set(key, resolveSettings(addon, environment.addons[addon.name], env));
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          settings.set(key, reason);
          notes(addon.name, `unavailable in ${key}: ${reason}`);
        }
      }
    }
    for (const tool of definition.tools) {
      const name = `${addon.name}.${tool.name}`;
      tools.push({
        name,
        description: tool.description,
        inputSchema: tool.inputSchema.extend({ app: appParam, env: envParam }),
        annotations: tool.annotations,
        run: async (input) => {
          const { app: appName, env: envName, ...own } = input as { app?: string; env?: string } & Settings;
          const scope = resolveScope(apps, appName, envName);
          const key = `${scope.app.name}/${scope.env.name}`;
          const found = settings.get(key);
          if (typeof found === "string") throw new Error(`${name} is unavailable in ${key}: ${found}`);
          const parsed = tool.inputSchema.parse(own);
          const run = tool.run as (input: unknown, context: unknown) => Promise<unknown>;
          const context = {
            app: scope.app.name,
            env: scope.env.name,
            settings: found ?? {},
            workspace,
            fetch: fetchImpl,
          };
          let evidence;
          try {
            evidence = await run(parsed, context);
          } catch (error) {
            // A secret setting never reaches the person or the model, even inside an error.
            const secrets = (definition.secrets ?? [])
              .map((key) => String(context.settings[key] ?? ""))
              .filter(Boolean);
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(
              secrets.reduce((text, secret) => text.replaceAll(secret, "***"), message),
              { cause: error },
            );
          }
          return JSON.stringify({ app: scope.app.name, env: scope.env.name, tool: name, evidence }, null, 2);
        },
      });
    }
  }
  return tools;
}
