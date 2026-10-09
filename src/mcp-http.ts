// MCP entry point over HTTP, for a team (ADR 0015). The logic is in http-server.ts.
//   OPS_MCP_TOKENS="alice:<token>,bob:<token>" npm run mcp:http -- --workspace ./ops
//   options: --host 127.0.0.1 --port 8808 --path /mcp --public-host mcp.company.example
//            --tls-cert cert.pem --tls-key key.pem --no-auth (this machine only)
import { readFileSync } from "node:fs";
import { resolveAddonDirs } from "./addons/loader.ts";
import { startupNotices } from "./commands.ts";
import { resolveWorkspace } from "./config.ts";
import { HTTP_DEFAULTS, parseTokens, startHttpServer } from "./http-server.ts";
import { readyLine } from "./mcp-server.ts";
import { openToolbox } from "./toolbox.ts";

const argv = process.argv.slice(2);
const all = (name: string) => argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]!] : []));
const one = (name: string) => all(name).at(-1);
const cert = one("--tls-cert");
const key = one("--tls-key");
if (Boolean(cert) !== Boolean(key)) throw new Error("--tls-cert and --tls-key go together.");

const toolbox = await openToolbox(resolveWorkspace(argv), resolveAddonDirs(argv));
for (const notice of startupNotices(toolbox)) process.stderr.write(`${notice}\n`);
const running = await startHttpServer(toolbox, {
  host: one("--host") ?? HTTP_DEFAULTS.host,
  port: Number(one("--port") ?? HTTP_DEFAULTS.port),
  path: one("--path") ?? HTTP_DEFAULTS.path,
  tokens: parseTokens(process.env.OPS_MCP_TOKENS),
  noAuth: argv.includes("--no-auth"),
  publicHosts: all("--public-host"),
  tls: cert && key ? { cert: readFileSync(cert, "utf8"), key: readFileSync(key, "utf8") } : undefined,
  maxSessions: HTTP_DEFAULTS.maxSessions,
  idleMs: HTTP_DEFAULTS.idleMs,
  maxBodyBytes: HTTP_DEFAULTS.maxBodyBytes,
  log: (event) => process.stderr.write(`${JSON.stringify(event)}\n`),
});
process.stderr.write(`help-me-ops MCP server on ${running.url}: ${readyLine(toolbox)}\n`);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void running.close().then(() => process.exit(0)));
}
