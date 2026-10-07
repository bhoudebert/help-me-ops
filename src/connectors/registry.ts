// From the config to live connectors: the types addons bring (log files, a
// database), or modules the people running the system write themselves.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { ConnectorType } from "../addons/types.ts";
import type { SourceConfig } from "../config.ts";
import type { Connector, ConnectorFactory } from "./types.ts";

export async function createConnectors(
  sources: SourceConfig[],
  baseDir: string,
  types: Map<string, ConnectorType> = new Map(),
): Promise<{ connectors: Connector[]; skipped: string[] }> {
  const connectors: Connector[] = [];
  const skipped: string[] = [];
  for (const source of sources) {
    if (source.type === "module") {
      if (typeof source.module !== "string") throw new Error(`Source ${source.id}: a module source needs "module".`);
      const url = pathToFileURL(resolve(baseDir, source.module)).href;
      const module = (await import(url)) as { createConnector?: ConnectorFactory };
      if (typeof module.createConnector !== "function") {
        throw new Error(`Source ${source.id}: ${source.module} does not export createConnector.`);
      }
      connectors.push(module.createConnector(source));
      continue;
    }
    const type = types.get(source.type);
    if (!type) {
      // The addon behind the type is missing or was skipped: leave this source out, keep the rest.
      skipped.push(`source ${source.id}: no connector type "${source.type}" (is its addon loaded? see doctor)`);
      continue;
    }
    const { type: _type, id, description, ...rest } = source;
    const options = type.options.safeParse(rest);
    if (!options.success) throw new Error(`Source ${id} (${source.type}): ${z.prettifyError(options.error)}`);
    connectors.push(
      type.create({ ...(options.data as Record<string, unknown>), id, description }, { workspace: baseDir }),
    );
  }
  const ids = connectors.map((c) => c.id);
  const twice = ids.find((id, i) => ids.indexOf(id) !== i);
  if (twice) throw new Error(`Two sources are named ${twice}: ids must be unique.`);
  return { connectors, skipped };
}
