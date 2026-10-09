// MCP entry point over HTTP, for a team (ADR 0015). The logic is in http-server.ts.
//   OPS_MCP_TOKENS="alice:sha256:<hash>,bob:sha256:<hash>" npm run mcp:http -- --workspace ./ops
//   options: --host 127.0.0.1 --port 8808 --path /mcp --public-host mcp.company.example
//            --tls-cert cert.pem --tls-key key.pem --no-auth (this machine only)
//   OAuth with a company identity provider (ADR 0017): --oauth-issuer https://login.company.example/realms/ops
//            --public-url https://mcp.company.example/mcp [--oauth-jwks-uri ...] [--oauth-audience ...] [--oauth-scope ...]
//            [--oauth-client-id ... --oauth-client-secret ...]   (opaque tokens: asked about, RFC 7662)
//   or by environment, as in a container: OPS_MCP_HOST, OPS_MCP_PORT, OPS_MCP_PATH,
//   OPS_MCP_PUBLIC_HOSTS, OPS_MCP_TOKENS, OPS_MCP_TOKENS_FILE, OPS_MCP_OAUTH_ISSUER (and _JWKS_URI, _AUDIENCE, _SCOPES,
//   _IDENTITY_CLAIMS, _ALGORITHMS), OPS_MCP_PUBLIC_URL
import { resolveAddonDirs } from "./addons/loader.ts";
import { startupNotices } from "./commands.ts";
import { resolveWorkspace } from "./config.ts";
import { optionsFromArgs, startHttpServer } from "./http-server.ts";
import { createOAuthVerifier, oauthConfigFrom } from "./oauth.ts";
import { readyLine } from "./mcp-server.ts";
import { openToolbox } from "./toolbox.ts";

try {
  const argv = process.argv.slice(2);
  const options = optionsFromArgs(argv, process.env, (event) => process.stderr.write(`${JSON.stringify(event)}\n`));
  const oauth = oauthConfigFrom(argv, process.env, { path: options.path, publicHosts: options.publicHosts });
  if (oauth) {
    options.oauth = await createOAuthVerifier(oauth);
    // The name people reach the server by is in its public URL: no need to say it twice.
    if (!options.publicHosts.length) options.publicHosts.push(new URL(oauth.resource).host);
  }
  const toolbox = await openToolbox(resolveWorkspace(argv), resolveAddonDirs(argv));
  for (const notice of startupNotices(toolbox)) process.stderr.write(`${notice}\n`);
  const running = await startHttpServer(toolbox, options);
  process.stderr.write(`help-me-ops MCP server on ${running.url}: ${readyLine(toolbox)}\n`);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => void running.close().then(() => process.exit(0)));
  }
} catch (error) {
  // A refusal to start is an answer, not a crash: say what to fix.
  process.stderr.write(`help-me-ops MCP server: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
