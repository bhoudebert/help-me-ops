// `ops addon check <folder>`: is this addon ready to be dropped in? It loads the
// addon the way the server does and says, line by line, what is right and what
// to fix: the manifest, the functions, the settings against the workspace, and
// sample calls against fixtures (check.json, no network), then exits non-zero if
// anything failed. It reads; it never calls anything unless --call asks to.
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { z } from "zod";
import { loadConfig } from "../config.ts";
import type { Evidence } from "../connectors/types.ts";
import { loadDefinition, type LoadedAddon } from "./loader.ts";
import { loadManifestAddon } from "./manifest.ts";
import { resolveSettings } from "./runtime.ts";
import type { AddonDefinition } from "./types.ts";

export interface CheckResult {
  ok: boolean;
  text: string;
}

const NAME = /^[a-z][a-z0-9-]*$/;

const Case = z.object({
  name: z.string().optional(),
  tool: z.string(),
  input: z.record(z.string(), z.unknown()).default({}),
  settings: z.record(z.string(), z.unknown()).default({}),
  /** Recorded answers by "METHOD url"; a request with no entry fails the case: a check never touches the network. */
  responses: z
    .record(z.string(), z.object({ status: z.number().int().default(200), body: z.unknown().optional() }))
    .default({}),
  expect: z
    .object({
      minRecords: z.number().int().optional(),
      maxRecords: z.number().int().optional(),
      summaryIncludes: z.string().optional(),
      withTime: z.boolean().optional(),
    })
    .default({}),
});
const Cases = z.array(Case);

function recordedFetch(responses: z.infer<typeof Case>["responses"]): typeof fetch {
  return (async (input: URL | RequestInfo, init?: RequestInit) => {
    const key = `${(init?.method ?? "GET").toUpperCase()} ${String(input)}`;
    const found = responses[key];
    if (!found) {
      throw new Error(
        `no recorded response for "${key}" in check.json${Object.keys(responses).length ? `; it has: ${Object.keys(responses).join(", ")}` : ""}`,
      );
    }
    const body = typeof found.body === "string" ? found.body : JSON.stringify(found.body ?? null);
    return new Response(body, { status: found.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const first = (error: unknown) => (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "";

/** What to do about an error the loader reports, when there is a known fix. */
function hint(message: string): string | undefined {
  const pkg = /Cannot find (?:package|module) '([^']+)'/.exec(message);
  if (pkg) return `install it next to the addon, in the workspace: cd <workspace> && npm install ${pkg[1]}`;
  if (/does not declare/.test(message)) return "declare the tool in addon.json, or remove the export";
  if (/does not export/.test(message))
    return "export a function of that name from tools.ts, or remove the tool from addon.json";
  if (/addon API/.test(message)) return 'set "apiVersion": 1';
  return undefined;
}

export async function checkAddon(
  folder: string,
  options: {
    workspace?: string;
    call?: { tool: string; input: Record<string, unknown>; app?: string; env?: string };
  } = {},
): Promise<CheckResult> {
  const dir = resolve(folder);
  const name = basename(dir);
  const lines: string[] = [`Checking ${dir}`];
  let failed = 0;
  let passed = 0;
  const ok = (text: string) => (passed++, lines.push(`  ok    ${text}`));
  const fail = (text: string, fix?: string) => (
    failed++,
    lines.push(`  FAIL  ${text}`, ...(fix ? [`        fix: ${fix}`] : []))
  );
  const warn = (text: string) => lines.push(`  warn  ${text}`);
  const done = (): CheckResult => {
    lines.push(
      "",
      failed
        ? `${failed} failed, ${passed} passed.`
        : `All ${passed} checks passed: this addon is ready to be dropped into a workspace.`,
    );
    return { ok: failed === 0, text: lines.join("\n") };
  };

  if (!existsSync(dir)) {
    fail("the folder does not exist", "pass the addon's folder, e.g. my-workspace/addons/billing");
    return done();
  }
  if (!NAME.test(name))
    fail(`the folder name "${name}" must be lowercase letters, digits and hyphens`, "rename the folder");
  else ok(`name "${name}"`);

  const manifest = existsSync(join(dir, "addon.json"));
  const advanced = existsSync(join(dir, "addon.ts"));
  if (manifest && advanced) {
    fail("it has both addon.json and addon.ts", "keep one: addon.json and tools.ts is the simple form");
    return done();
  }
  if (!manifest && !advanced) {
    fail(
      "it has no addon.json (or addon.ts)",
      "an addon needs an addon.json and a tools.ts; start with: npm run ops -- init addon <name> --template file|api|sql",
    );
    return done();
  }
  ok(manifest ? "files: addon.json and tools.ts" : "files: addon.ts (advanced form)");

  let definition: AddonDefinition;
  try {
    definition = manifest ? await loadManifestAddon(dir, name) : await loadDefinition(join(dir, "addon.ts"));
  } catch (error) {
    const message = first(error);
    fail(message, hint(message));
    return done();
  }
  const tools = definition.tools ?? [];
  const fields = Object.keys(definition.settings?.shape ?? {});
  ok(`loads: apiVersion ${definition.apiVersion}, ${tools.length} tool(s), ${fields.length} setting(s)`);
  if (!tools.length && !definition.connectors) warn("it declares no tool: the assistant will have nothing to call");

  for (const tool of tools) {
    const shape = Object.entries(tool.inputSchema.shape);
    const params = shape.map(
      ([key, schema]) => `${key}${(schema as z.ZodType).safeParse(undefined).success ? "?" : ""}`,
    );
    ok(`tool ${name}.${tool.name}(${params.join(", ")}): read-only`);
    if (tool.description.length < 20)
      warn(`${tool.name}: a one-word description is little for the assistant to choose by; say what it returns`);
    for (const [key, schema] of shape) {
      if (!(schema as z.ZodType).description)
        warn(`${tool.name}: parameter ${key} has no description (the assistant reads it)`);
    }
  }
  for (const key of fields) {
    const variable = definition.env?.[key];
    const secret = definition.secrets?.includes(key) ? ", secret" : "";
    ok(`setting ${key}${variable ? ` (variable ${variable})` : ""}${secret}`);
  }

  const loaded: LoadedAddon = { name, dir, origin: "workspace", definition, playbooks: null, knowledge: null };

  // The settings, against the workspace this addon is going into.
  type Apps = Record<string, { envs: Record<string, { addons: Record<string, Record<string, unknown>> }> }>;
  let apps: Apps | null = null;
  if (options.workspace) {
    try {
      apps = (await loadConfig(options.workspace)).config.apps as unknown as Apps;
    } catch {
      warn(`no workspace found at ${options.workspace}: settings were not checked against environments`);
    }
  }
  if (apps && fields.length) {
    for (const [app, setup] of Object.entries(apps)) {
      for (const [env, config] of Object.entries(setup.envs)) {
        const block = config.addons[name];
        if (block === undefined) {
          warn(
            `${app}/${env}: no block for "${name}" in ops.config.json, so it stays idle there (variables alone can also set it up)`,
          );
          continue;
        }
        try {
          resolveSettings(loaded, block);
          ok(`settings in ${app}/${env}: valid`);
        } catch (error) {
          const message = first(error);
          if (/is not set$/.test(message))
            warn(`settings in ${app}/${env}: ${message}, so it stays idle there until it is`);
          else
            fail(
              `settings in ${app}/${env}: ${message}`,
              "fix the block of this addon in ops.config.json, or the settings in addon.json",
            );
        }
      }
    }
  }

  // Sample calls against recorded answers.
  const casesFile = join(dir, "check.json");
  if (existsSync(casesFile)) {
    let cases: z.infer<typeof Cases>;
    try {
      cases = Cases.parse(JSON.parse(await readFile(casesFile, "utf8")));
    } catch (error) {
      fail(
        `check.json: ${error instanceof z.ZodError ? z.prettifyError(error).split("\n").join(" ") : first(error)}`,
        "see the guide for the check.json format",
      );
      return done();
    }
    for (const sample of cases) {
      const label = sample.name ?? `${sample.tool} ${JSON.stringify(sample.input)}`;
      const tool = tools.find((t) => t.name === sample.tool);
      if (!tool) {
        fail(
          `sample "${label}": the addon has no tool ${sample.tool}`,
          `one of: ${tools.map((t) => t.name).join(", ")}`,
        );
        continue;
      }
      try {
        const settings = definition.settings ? definition.settings.parse(sample.settings) : {};
        const evidence = (await tool.run(tool.inputSchema.parse(sample.input) as never, {
          app: "check",
          env: "check",
          settings,
          workspace: dir,
          fetch: recordedFetch(sample.responses),
        })) as Evidence[];
        const problems: string[] = [];
        const { minRecords = 1, maxRecords, summaryIncludes, withTime } = sample.expect;
        if (evidence.length < minRecords)
          problems.push(`${evidence.length} record(s), expected at least ${minRecords}`);
        if (maxRecords !== undefined && evidence.length > maxRecords)
          problems.push(`${evidence.length} record(s), expected at most ${maxRecords}`);
        if (evidence.some((e) => !e.summary.trim())) problems.push("a record has an empty summary");
        if (summaryIncludes && !evidence.some((e) => e.summary.includes(summaryIncludes)))
          problems.push(`no summary includes "${summaryIncludes}"`);
        if (withTime && evidence.some((e) => e.at === null))
          problems.push("a record has no time (give it an `at` field)");
        const secrets = (definition.secrets ?? [])
          .map((key) => String((settings as Record<string, unknown>)[key] ?? ""))
          .filter(Boolean);
        const text = JSON.stringify(evidence);
        if (secrets.some((secret) => text.includes(secret))) problems.push("a secret setting appears in the evidence");
        if (problems.length) fail(`sample "${label}": ${problems.join("; ")}`);
        else
          ok(
            `sample "${label}": ${evidence.length} record(s), ${evidence.filter((e) => e.at !== null).length} with a time`,
          );
      } catch (error) {
        fail(`sample "${label}": ${first(error)}`);
      }
    }
  } else {
    warn("no check.json: add sample calls with recorded answers to test the tools without a network (see the guide)");
  }

  // One real call, only when asked.
  if (options.call) {
    const { tool: toolName, input, app, env } = options.call;
    const tool = tools.find((t) => t.name === toolName);
    if (!tool) fail(`--call: the addon has no tool ${toolName}`, `one of: ${tools.map((t) => t.name).join(", ")}`);
    else if (!apps)
      fail("--call needs a workspace with the addon set up in an environment", "pass --workspace, and --env");
    else {
      try {
        const appName = app ?? Object.keys(apps)[0]!;
        const envName = env ?? Object.keys(apps[appName]!.envs)[0]!;
        const settings = resolveSettings(loaded, apps[appName]!.envs[envName]!.addons[name]);
        const evidence = (await tool.run(tool.inputSchema.parse(input) as never, {
          app: appName,
          env: envName,
          settings,
          workspace: options.workspace!,
          fetch: globalThis.fetch,
        })) as Evidence[];
        ok(`--call ${toolName} in ${appName}/${envName}, for real: ${evidence.length} record(s)`);
        for (const e of evidence.slice(0, 3)) lines.push(`        ${e.at ?? "-"}  ${e.summary}`);
      } catch (error) {
        fail(`--call ${toolName}: ${first(error)}`);
      }
    }
  }
  return done();
}
