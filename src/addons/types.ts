// What an addon is, for the people who write one (ADR 0008). An addon is a
// folder with an addon.ts whose default export is a definition, or a function
// receiving { z, defineTool } and returning one, so an addon needs no packages
// of its own.
import type { z } from "zod";
import type { Connector, Evidence } from "../connectors/types.ts";
import type { AddonPrivacy } from "../privacy.ts";
import type { ToolHints } from "../tools/index.ts";

/** The addon API this core understands; an addon declares the one it was written for. */
export const ADDON_API_VERSION = 1;

/** What a tool or a connector of an addon is told about where it runs. */
export interface AddonContext {
  app: string;
  env: string;
  /** The addon's settings for this app and environment, validated. */
  settings: Record<string, unknown>;
  /** The workspace folder, to resolve relative paths. */
  workspace: string;
  /** fetch, for calling an API; tests hand in a fake. */
  fetch: typeof fetch;
}

export interface AddonTool {
  /** Namespaced by the addon when served: `order.getOrder`. */
  name: string;
  description: string;
  /** The tool's own parameters; `app` and `env` are added for it. */
  inputSchema: z.ZodObject;
  /** All four hints; `readOnlyHint: true` and `destructiveHint: false` are required (ADR 0002). */
  annotations: ToolHints;
  run(input: never, context: AddonContext): Promise<Evidence[]>;
}

/** A kind of source, usable as `type` in ops.config.json. */
export interface ConnectorType {
  /** The options a source of this type takes, besides its id and description. */
  options: z.ZodObject;
  create(
    options: { id: string; description: string } & Record<string, unknown>,
    context: { workspace: string },
  ): Connector;
}

export interface AddonDefinition {
  apiVersion: number;
  /** Settings of the addon, per app and environment. */
  settings?: z.ZodObject;
  /** Environment variable read for each setting, which the configuration may override. */
  env?: Record<string, string>;
  /** Names of settings never to print. */
  secrets?: string[];
  tools?: AddonTool[];
  connectors?: Record<string, ConnectorType>;
  /** What the addon knows is personal: its fields, and detectors for its own formats. */
  privacy?: AddonPrivacy;
}

/** What the core hands an addon that exports a function: zod, and the typed tool helper. */
export interface AddonApi {
  z: typeof z;
  defineTool: typeof defineTool;
}

/** What an addon.ts may export as default. */
export type AddonExport = AddonDefinition | ((api: AddonApi) => AddonDefinition | Promise<AddonDefinition>);

/** Typing helpers: they return what they are given. */
export const defineAddon = (addon: AddonExport): AddonExport => addon;
export function defineTool<I extends z.ZodObject>(tool: {
  name: string;
  description: string;
  inputSchema: I;
  annotations: ToolHints;
  run(input: z.infer<I>, context: AddonContext): Promise<Evidence[]>;
}): AddonTool {
  return tool as unknown as AddonTool;
}
