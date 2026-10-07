// Which app and which environment a question is about. Sources belong to an
// environment, so every read of evidence names one; this resolves it, or says
// what to choose from.
import type { Connector } from "./connectors/types.ts";

export interface EnvSetup {
  name: string;
  sources: Connector[];
  /** Settings the configuration gives each addon in this environment. */
  addons: Record<string, Record<string, unknown>>;
}

export interface AppSetup {
  name: string;
  description: string;
  envs: EnvSetup[];
}

export interface Scope {
  app: AppSetup;
  env: EnvSetup;
}

function pick<T extends { name: string }>(kind: string, items: T[], wanted: string | undefined, where: string): T {
  const known = items.map((i) => i.name).join(", ");
  if (wanted) {
    const found = items.find((i) => i.name === wanted);
    if (!found) throw new Error(`No ${kind} "${wanted}"${where}. Known: ${known}.`);
    return found;
  }
  if (items.length === 1) return items[0]!;
  throw new Error(
    `Several ${kind}s (${known}): say which with "${kind}". The scope tool proposes one from the question.`,
  );
}

/** The app and environment asked for; one that is the only choice may be left out. */
export function resolveScope(apps: AppSetup[], app?: string, env?: string): Scope {
  const found = pick("app", apps, app, "");
  return { app: found, env: pick("env", found.envs, env, ` in app ${found.name}`) };
}

// Words people use for the same environment.
const ENV_WORDS = [
  ["prod", "production", "prd", "live"],
  ["staging", "stage", "preprod", "uat"],
  ["dev", "development", "local"],
];

const words = (text: string) => new Set(text.toLowerCase().match(/\p{L}[\p{L}\d]{2,}/gu) ?? []);

const envWords = (name: string) =>
  new Set([name.toLowerCase(), ...(ENV_WORDS.find((g) => g.includes(name.toLowerCase())) ?? [])]);

/** The single best candidate: the highest score, if it is above zero and not tied. */
function best<T>(items: T[], score: (item: T) => string[]): { item: T; hits: string[] } | null {
  const scored = items.map((item) => ({ item, hits: score(item) })).sort((a, b) => b.hits.length - a.hits.length);
  const [first, second] = scored;
  if (!first || first.hits.length === 0 || first.hits.length === second?.hits.length) return null;
  return first;
}

/** The apps and environments, and which ones a question points at, with why. Reads no evidence. */
export function describeScope(apps: AppSetup[], question?: string) {
  const asked = words(question ?? "");
  const reasons: string[] = [];
  const ask: string[] = [];

  let app: AppSetup | null = null;
  if (apps.length === 1) {
    app = apps[0]!;
    reasons.push(`${app.name} is the only app`);
  } else {
    const hit = best(apps, (a) => [...words(`${a.name} ${a.description}`)].filter((w) => asked.has(w)));
    if (hit) {
      app = hit.item;
      reasons.push(`the question mentions ${hit.hits.join(", ")}: app ${app.name}`);
    } else ask.push(`which app (${apps.map((a) => a.name).join(", ")})`);
  }

  let env: EnvSetup | null = null;
  if (app) {
    if (app.envs.length === 1) {
      env = app.envs[0]!;
      reasons.push(`${env.name} is the only environment of ${app.name}`);
    } else {
      const hit = best(app.envs, (e) => [...envWords(e.name)].filter((w) => asked.has(w)));
      if (hit) {
        env = hit.item;
        reasons.push(`the question mentions ${hit.hits.join(", ")}: environment ${env.name}`);
      } else ask.push(`which environment of ${app.name} (${app.envs.map((e) => e.name).join(", ")})`);
    }
  }

  return {
    apps: apps.map((a) => ({
      name: a.name,
      description: a.description,
      envs: a.envs.map((e) => ({ name: e.name, sources: e.sources.length })),
    })),
    likely: { app: app?.name ?? null, env: env?.name ?? null, reasons },
    ask,
  };
}
