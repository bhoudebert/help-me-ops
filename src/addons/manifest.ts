// The easy way to write an addon (ADR 0009): addon.json says what it is,
// tools.ts holds one plain function per tool. This turns the pair into the
// definition the core serves, so the author never meets MCP, zod or Evidence.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { Evidence } from "../connectors/types.ts";
import { ADDON_API_VERSION, type AddonContext, type AddonDefinition, type AddonTool } from "./types.ts";

const TYPES = ["string", "number", "integer", "boolean"] as const;
const type = z.enum(TYPES);
const spec = z.union([
  type,
  z.object({
    type,
    description: z.string().optional(),
    optional: z.boolean().optional(),
    default: z.union([z.string(), z.number(), z.boolean()]).optional(),
    enum: z.array(z.string()).min(1).optional(),
  }),
]);
const setting = z.union([
  type,
  spec.options[1].extend({
    /** The environment variable this setting is read from, before the configuration overrides it. */
    env: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*$/)
      .optional(),
    /** Never printed: kept out of errors and notes. */
    secret: z.boolean().optional(),
  }),
]);
const name = /^[a-zA-Z][a-zA-Z0-9_]*$/;

export const Manifest = z
  .object({
    apiVersion: z.number().int(),
    description: z.string().optional(),
    settings: z.record(z.string(), setting).optional(),
    tools: z
      .record(z.string(), z.object({ description: z.string().min(1), params: z.record(z.string(), spec).optional() }))
      .optional(),
  })
  .superRefine((manifest, context) => {
    const names: [string, string[]][] = [
      ["setting", Object.keys(manifest.settings ?? {})],
      ["tool", Object.keys(manifest.tools ?? {})],
      ["parameter", Object.values(manifest.tools ?? {}).flatMap((t) => Object.keys(t.params ?? {}))],
    ];
    for (const [kind, keys] of names) {
      for (const key of keys.filter((k) => !name.test(k))) {
        context.addIssue({ code: "custom", message: `${kind} "${key}": a name is letters, digits and underscores` });
      }
    }
  });
type Spec = z.infer<typeof spec>;

/** `fromText`: a setting read from an environment variable arrives as text. */
function field(item: Spec, fromText = false): z.ZodType {
  const detail = typeof item === "string" ? { type: item } : item;
  let schema: z.ZodType =
    detail.type === "string"
      ? "enum" in detail && detail.enum
        ? z.enum(detail.enum as [string, ...string[]])
        : z.string()
      : detail.type === "boolean"
        ? z.preprocess((v) => (fromText ? ({ true: true, false: false }[String(v)] ?? v) : v), z.boolean())
        : detail.type === "integer"
          ? (fromText ? z.coerce.number() : z.number()).int()
          : fromText
            ? z.coerce.number()
            : z.number();
  if ("description" in detail && detail.description) schema = schema.describe(detail.description);
  if ("default" in detail && detail.default !== undefined) schema = schema.default(detail.default);
  else if ("optional" in detail && detail.optional) schema = schema.optional();
  return schema;
}

const object = (items: Record<string, Spec> | undefined, fromText = false) =>
  z.object(Object.fromEntries(Object.entries(items ?? {}).map(([key, item]) => [key, field(item, fromText)])));

const SAFE_STAMP = ["at", "time", "timestamp"] as const;
const MAX_RECORDS = 100;
const MAX_SUMMARY = 240;

/** JSON-safe copy: dates and bigints become strings, so a record can always be returned. */
const plain = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));

function evidence(source: string, record: unknown): Evidence {
  if (typeof record !== "object" || record === null) {
    return { source, at: null, summary: String(record).slice(0, MAX_SUMMARY), data: record };
  }
  const data = plain(record) as Record<string, unknown>;
  const stamp = SAFE_STAMP.map((k) => data[k]).find((v) => typeof v === "string" && !Number.isNaN(Date.parse(v)));
  const summary =
    typeof data.summary === "string"
      ? data.summary
      : Object.entries(data)
          .filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))
          .map(([k, v]) => `${k}=${String(v)}`)
          .join(" ");
  return {
    source,
    at: typeof stamp === "string" ? stamp : null,
    summary: summary.length > MAX_SUMMARY ? `${summary.slice(0, MAX_SUMMARY - 1)}…` : summary,
    data,
  };
}

/** What a tool function returned, as evidence: records, one record, a string, or nothing; capped. */
export function toEvidence(source: string, result: unknown): Evidence[] {
  if (result === undefined || result === null) return [];
  const items = Array.isArray(result) ? result : [result];
  const shown = items.slice(0, MAX_RECORDS).map((item) => evidence(source, item));
  if (items.length > MAX_RECORDS) {
    shown.push({
      source,
      at: null,
      summary: `${items.length - MAX_RECORDS} more results not shown: narrow the query`,
      data: { truncated: items.length - MAX_RECORDS },
    });
  }
  return shown;
}

type ToolFunction = (params: unknown, context: AddonContext) => unknown;

/** Read addon.json and tools.ts of a folder and build the definition. */
export async function loadManifestAddon(dir: string, addon: string): Promise<AddonDefinition> {
  let json: unknown;
  try {
    json = JSON.parse(await readFile(join(dir, "addon.json"), "utf8"));
  } catch (error) {
    throw new Error(`addon.json: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const version = (json as { apiVersion?: unknown } | null)?.apiVersion;
  if (version !== ADDON_API_VERSION) {
    throw new Error(`written for addon API ${String(version)}, this version supports ${ADDON_API_VERSION}`);
  }
  const parsed = Manifest.safeParse(json);
  if (!parsed.success) throw new Error(`invalid addon.json: ${z.prettifyError(parsed.error)}`);
  const manifest = parsed.data;

  const definitions = Object.entries(manifest.tools ?? {});
  let functions: Record<string, unknown> = {};
  if (definitions.length) {
    try {
      functions = (await import(pathToFileURL(join(dir, "tools.ts")).href)) as Record<string, unknown>;
    } catch (error) {
      throw new Error(`tools.ts: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    const missing = definitions.map(([key]) => key).filter((key) => typeof functions[key] !== "function");
    if (missing.length) throw new Error(`tools.ts does not export ${missing.join(", ")}, declared in addon.json`);
    const extra = Object.keys(functions).filter(
      (key) => typeof functions[key] === "function" && !manifest.tools?.[key],
    );
    if (extra.length) throw new Error(`tools.ts exports ${extra.join(", ")}, which addon.json does not declare`);
  }

  const settings = Object.entries(manifest.settings ?? {}).map(([key, item]) => [key, item as Spec] as const);
  const tools: AddonTool[] = definitions.map(([key, tool]) => {
    const run = functions[key] as ToolFunction;
    return {
      name: key,
      description: tool.description,
      inputSchema: object(tool.params),
      // Not the author's to set (ADR 0009): a manifest addon only reads.
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      run: (async (input: unknown, context: AddonContext) =>
        toEvidence(addon, await run(input, context))) as AddonTool["run"],
    };
  });
  const env: Record<string, string> = {};
  for (const [key, item] of settings)
    if (typeof item === "object" && "env" in item && item.env) env[key] = String(item.env);
  return {
    apiVersion: manifest.apiVersion,
    settings: manifest.settings ? object(Object.fromEntries(settings), true) : undefined,
    env: Object.keys(env).length ? env : undefined,
    secrets: settings.flatMap(([key, item]) =>
      typeof item === "object" && "secret" in item && item.secret ? [key] : [],
    ),
    tools,
  };
}
