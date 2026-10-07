// From the config to live connectors: built-in types, or modules the people
// running the system write for their own logs, metrics and databases.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { SourceConfig } from "../config.ts";
import { fileLogs } from "./fileLogs.ts";
import type { Connector, ConnectorFactory } from "./types.ts";

export async function createConnectors(sources: SourceConfig[], baseDir: string): Promise<Connector[]> {
  const connectors: Connector[] = [];
  for (const source of sources) {
    if (source.type === "file-logs") {
      connectors.push(fileLogs({ ...source, path: resolve(baseDir, source.path) }));
      continue;
    }
    const url = pathToFileURL(resolve(baseDir, source.module)).href;
    const module = (await import(url)) as { createConnector?: ConnectorFactory };
    if (typeof module.createConnector !== "function") {
      throw new Error(`Source ${source.id}: ${source.module} does not export createConnector.`);
    }
    connectors.push(module.createConnector(source));
  }
  const ids = connectors.map((c) => c.id);
  const twice = ids.find((id, i) => ids.indexOf(id) !== i);
  if (twice) throw new Error(`Two sources are named ${twice}: ids must be unique.`);
  return connectors;
}
