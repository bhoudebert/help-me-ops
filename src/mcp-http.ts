// MCP entry point over HTTP, for a team (ADR 0015). The logic is in http-server.ts.
//   OPS_MCP_TOKENS="alice:<token>,bob:<token>" npm run mcp:http -- --workspace ./ops
//   options: --host 127.0.0.1 --port 8808 --path /mcp --public-host mcp.company.example
//            --tls-cert cert.pem --tls-key key.pem --no-auth (this machine only)
//   or by environment, as in a container: OPS_MCP_HOST, OPS_MCP_PORT, OPS_MCP_PATH,
//   OPS_MCP_PUBLIC_HOSTS, OPS_MCP_TOKENS, OPS_MCP_TOKENS_FILE
import { resolveAddonDirs } from "./addons/loader.ts";
import { startupNotices } from "./commands.ts";
import { resolveWorkspace } from "./config.ts";
import { optionsFromArgs, startHttpServer } from "./http-server.ts";
import { readyLine } from "./mcp-server.ts";
import { openToolbox } from "./toolbox.ts";

const argv = process.argv.slice(2);
const options = optionsFromArgs(argv, process.env, (event) => process.stderr.write(`${JSON.stringify(event)}\n`));
const toolbox = await openToolbox(resolveWorkspace(argv), resolveAddonDirs(argv));
for (const notice of startupNotices(toolbox)) process.stderr.write(`${notice}\n`);
const running = await startHttpServer(toolbox, options);
process.stderr.write(`help-me-ops MCP server on ${running.url}: ${readyLine(toolbox)}\n`);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void running.close().then(() => process.exit(0)));
}
