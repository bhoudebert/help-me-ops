// `ops setup claude|codex|copilot|all`: the exact configuration to connect an AI
// client to this server, with the real paths filled in, after checking that the
// workspace loads and that the server answers over MCP the way the client will
// start it. It prints; it only writes with --write --into <project>, and never
// over an entry that exists.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadConfig } from "./config.ts";

export const CLIENTS = ["claude", "codex", "copilot"] as const;
export type ClientName = (typeof CLIENTS)[number];

export const SETUP_USAGE = `Usage: npm run ops -- setup [claude|codex|copilot|all] [--workspace <dir>] [--into <project> --write] [--no-verify]

  Prints the configuration that connects an AI client to this server, with the real paths,
  after checking that the workspace loads and that the server answers over MCP.
  --into <project> --write   write .mcp.json (claude) or .vscode/mcp.json (copilot) in that
                             project, keeping what is there and never replacing help-me-ops`;

export interface Launch {
  /** The folder of this clone: where src/mcp.ts and .env live. */
  clone: string;
  workspace: string;
}

/** What the client runs to start the server. */
export function command(launch: Launch): { command: string; args: string[] } {
  return {
    command: "node",
    args: [
      `--env-file-if-exists=${join(launch.clone, ".env")}`,
      join(launch.clone, "src/mcp.ts"),
      "--workspace",
      launch.workspace,
    ],
  };
}

const quote = (text: string) => (/^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`);
const toml = (text: string) => JSON.stringify(text);

export function claudeJson(launch: Launch) {
  return { mcpServers: { "help-me-ops": { ...command(launch) } } };
}

export function copilotJson(launch: Launch) {
  const { args } = command(launch);
  return {
    servers: {
      "help-me-ops": {
        type: "stdio",
        command: "node",
        args: [args[1]!, "--workspace", launch.workspace],
        envFile: join(launch.clone, ".env"),
      },
    },
  };
}

export function codexToml(launch: Launch): string {
  const { args } = command(launch);
  return ["[mcp_servers.help-me-ops]", 'command = "node"', `args = [${args.map(toml).join(", ")}]`].join("\n");
}

export function claudeCommand(launch: Launch): string {
  const { args } = command(launch);
  return `claude mcp add help-me-ops --scope user -- node ${args.map(quote).join(" ")}`;
}

/** Starts the server the way a client would and asks it for its tools. */
export async function verifyServer(launch: Launch): Promise<{ tools: number; instructions: boolean }> {
  const { command: cmd, args } = command(launch);
  const client = new Client({ name: "ops-setup", version: "0" });
  await client.connect(
    new StdioClientTransport({
      command: cmd === "node" ? process.execPath : cmd,
      args,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
      stderr: "pipe",
    }),
  );
  try {
    const { tools } = await client.listTools();
    return { tools: tools.length, instructions: Boolean(client.getInstructions()) };
  } finally {
    await client.close();
  }
}

/** Adds the server to a JSON file of MCP servers, keeping the rest, refusing to replace an entry. */
export async function writeJson(file: string, key: "mcpServers" | "servers", entry: object): Promise<string> {
  let current: Record<string, Record<string, unknown>> = {};
  if (existsSync(file)) {
    try {
      current = JSON.parse(await readFile(file, "utf8")) as typeof current;
    } catch (error) {
      throw new Error(
        `${file} is not valid JSON (${error instanceof Error ? error.message : String(error)}): nothing was written`,
        {
          cause: error,
        },
      );
    }
  }
  if (current[key]?.["help-me-ops"]) {
    throw new Error(
      `${file} already has a help-me-ops server: nothing was written. Edit it by hand, or remove the entry first.`,
    );
  }
  const merged = { ...current, [key]: { ...(current[key] ?? {}), "help-me-ops": entry } };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(merged, null, 2)}\n`);
  return file;
}

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

export interface SetupResult {
  ok: boolean;
  text: string;
}

export async function runSetup(
  args: string[],
  context: { clone: string; workspace: string; defaulted: boolean },
): Promise<SetupResult> {
  const wanted = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--") && a !== "setup") ?? "all";
  if (wanted !== "all" && !CLIENTS.includes(wanted as ClientName))
    throw new Error(`Unknown client "${wanted}".\n\n${SETUP_USAGE}`);
  const clients = wanted === "all" ? [...CLIENTS] : [wanted as ClientName];
  const into = option(args, "--into");
  const write = args.includes("--write");
  if (write && !into) throw new Error(`--write needs --into <project>.\n\n${SETUP_USAGE}`);
  const launch: Launch = { clone: context.clone, workspace: context.workspace };
  const lines: string[] = [];
  let ok = true;

  const major = Number(process.versions.node.split(".")[0]);
  lines.push(
    major >= 24
      ? `ok    node ${process.versions.node}`
      : `FAIL  node ${process.versions.node}: this needs Node 24 (nvm use)`,
  );
  if (major < 24) ok = false;

  try {
    const { config } = await loadConfig(launch.workspace);
    const apps = Object.keys(config.apps);
    lines.push(
      `ok    workspace ${launch.workspace}: ${apps.length} app(s) (${apps.join(", ")})${context.defaulted ? ", the shipped demo: pass --workspace <dir> for yours" : ""}`,
    );
  } catch (error) {
    ok = false;
    lines.push(
      `FAIL  workspace ${launch.workspace}: ${(error instanceof Error ? error.message : String(error)).split("\n")[0]}`,
    );
  }

  if (ok && !args.includes("--no-verify")) {
    try {
      const seen = await verifyServer(launch);
      lines.push(
        `ok    the server started as a client will start it and answered over MCP: ${seen.tools} tools${seen.instructions ? ", with its method" : ""}`,
      );
    } catch (error) {
      ok = false;
      lines.push(
        `FAIL  the server did not answer: ${(error instanceof Error ? error.message : String(error)).split("\n")[0]}`,
      );
    }
  }
  lines.push("");

  const json = (value: object) => JSON.stringify(value, null, 2);
  for (const client of clients) {
    if (client === "claude") {
      lines.push(
        "Claude Code",
        "  For every project, once:",
        `    ${claudeCommand(launch)}`,
        "  Or for one project, in its .mcp.json:",
        ...json(claudeJson(launch))
          .split("\n")
          .map((l) => `    ${l}`),
        "  Then run `claude`, open /mcp, approve help-me-ops, and ask your question.",
        "",
      );
    } else if (client === "codex") {
      lines.push(
        "Codex",
        "  In ~/.codex/config.toml:",
        ...codexToml(launch)
          .split("\n")
          .map((l) => `    ${l}`),
        "  Then start `codex` and ask your question.",
        "",
      );
    } else {
      lines.push(
        "Copilot (VS Code)",
        "  In the project's .vscode/mcp.json (or your user configuration, `MCP: Open User Configuration`):",
        ...json(copilotJson(launch))
          .split("\n")
          .map((l) => `    ${l}`),
        "  Then start the server from the MCP view and use Copilot Chat in agent mode.",
        "",
      );
    }
  }

  if (write && into) {
    if (!ok) throw new Error("Not writing: a check failed above.");
    const project = resolve(into);
    for (const client of clients) {
      if (client === "claude")
        lines.push(
          `wrote ${await writeJson(join(project, ".mcp.json"), "mcpServers", claudeJson(launch).mcpServers["help-me-ops"])}`,
        );
      if (client === "copilot")
        lines.push(
          `wrote ${await writeJson(join(project, ".vscode/mcp.json"), "servers", copilotJson(launch).servers["help-me-ops"])}`,
        );
      if (client === "codex")
        lines.push("codex: ~/.codex/config.toml is yours, so it is not written: paste the block above.");
    }
    lines.push("");
  }
  lines.push(
    `Ask: "client u-881 paid but cannot find order 4512, what happened?" (the demo), or the problem of your own system.`,
    "What to expect from each client: docs/guide/clients.md",
  );
  return { ok, text: lines.join("\n") };
}
