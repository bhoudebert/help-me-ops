// From loaded addons to what the toolbox serves: settings per app and
// environment, namespaced tools, connector types.
import { z } from "zod";
import type { ConnectorType } from "./types.ts";
import type { LoadedAddon } from "./loader.ts";
import { resolveScope, type AppSetup } from "../scope.ts";
import { appParam, envParam, type ToolDefinition } from "../tools/index.ts";

type Settings = Record<string, unknown>;

/** A setting refers to an environment variable this machine does not have: not a mistake, a credential that is absent. */
export class UnsetVariable extends Error {
  variable: string;
  constructor(variable: string) {
    super(`environment variable ${variable} is not set`);
    this.variable = variable;
  }
}

/** `${NAME}` in a configured string is the environment variable NAME: credentials stay out of the file. */
function fromEnvironment(value: unknown, env: NodeJS.ProcessEnv): unknown {
  if (typeof value !== "string") return value;
  return value.replace(/\$\{(\w+)\}/g, (_, name: string) => {
    const found = env[name];
    if (found === undefined) throw new UnsetVariable(name);
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

/** The environment variables of the settings an addon cannot work without; a required setting with no variable is `null`. */
function requiredVariables(addon: LoadedAddon): (string | null)[] {
  const definition = addon.definition;
  const missing = definition?.settings?.safeParse({});
  if (!definition || !missing || missing.success) return [];
  const fields = new Set(missing.error.issues.map((issue) => String(issue.path[0])));
  return [...fields].map((field) => definition.env?.[field] ?? null);
}

/**
 * Is the addon set up in this environment: an entry in the configuration, or
 * every setting it cannot work without given by its environment variable, or
 * nothing it needs. One shared variable (a DD_SITE, a GITHUB_API_URL that some
 * other tool exports) is not a decision to use the addon.
 */
function isConfigured(addon: LoadedAddon, overrides: Settings | undefined, env: NodeJS.ProcessEnv): boolean {
  if (!addon.definition?.settings || overrides !== undefined) return true;
  return requiredVariables(addon).every((name) => name !== null && env[name] !== undefined);
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
 * at call time, and the rest works. An addon no environment sets up, or whose
 * settings only wait for environment variables this machine lacks, serves no
 * tools and is reported through `idle`, so shipped addons cost nothing until used.
 */
export function addonTools(
  addons: LoadedAddon[],
  apps: AppSetup[],
  workspace: string,
  notes: (addon: string, note: string) => void,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = globalThis.fetch,
  idle: (addon: string, reason: string) => void = () => undefined,
): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  for (const addon of addons) {
    const definition = addon.definition;
    if (!definition?.tools?.length) continue;
    const settings = new Map<string, Settings | string>();
    let setUp = false;
    const waiting = new Set<string>();
    // Some of its variables are set, not all: say which are missing rather than only "no environment sets it up".
    const some = Object.values(definition.env ?? {}).some((name) => env[name] !== undefined);
    const partial = some
      ? requiredVariables(addon).filter((name): name is string => name !== null && env[name] === undefined)
      : [];
    for (const app of apps) {
      for (const environment of app.envs) {
        const key = `${app.name}/${environment.name}`;
        if (!isConfigured(addon, environment.addons[addon.name], env)) {
          settings.set(key, `not set up: add "addons": { "${addon.name}": { … } } to ${key} in ops.config.json`);
          continue;
        }
        try {
          settings.set(key, resolveSettings(addon, environment.addons[addon.name], env));
          setUp = true;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          settings.set(key, reason);
          if (error instanceof UnsetVariable) waiting.add(error.variable);
          else {
            setUp = true;
            notes(addon.name, `unavailable in ${key}: ${reason}`);
          }
        }
      }
    }
    if (!setUp) {
      const names = waiting.size ? [...waiting] : partial;
      idle(
        addon.name,
        names.length
          ? `waiting for ${names.join(", ")}: set ${names.length > 1 ? "them" : "it"} (in .env, for example) to turn it on`
          : `no environment sets it up: add "addons": { "${addon.name}": { … } } in ops.config.json`,
      );
      continue;
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
            // The value, and each word of it that is long enough to be a credential: of a header
            // "Bearer abcdef..." a server may echo only the token.
            const secrets = (definition.secrets ?? [])
              .flatMap((key) => {
                const value = String(context.settings[key] ?? "");
                return [value, ...value.split(/\s+/).filter((part) => part.length >= 8)];
              })
              .filter(Boolean)
              .sort((a, b) => b.length - a.length);
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
