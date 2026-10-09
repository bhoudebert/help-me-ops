// MCP entry point for Claude Code, Codex and GitHub Copilot, on stdio: the client
// starts this process. Stdout carries the protocol only; anything else goes to stderr.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveAddonDirs } from "./addons/loader.ts";
import { startupNotices } from "./commands.ts";
import { resolveWorkspace } from "./config.ts";
import { createMcpServer, readyLine } from "./mcp-server.ts";
import { openToolbox } from "./toolbox.ts";

const toolbox = await openToolbox(resolveWorkspace(), resolveAddonDirs());
for (const notice of startupNotices(toolbox)) process.stderr.write(`${notice}\n`);
await createMcpServer(toolbox).connect(new StdioServerTransport());
process.stderr.write(`help-me-ops MCP server ready: ${readyLine(toolbox)}\n`);
