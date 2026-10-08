// Terminal entry point: npm run ops -- <command>. Thin: the logic is in commands.ts.
import { checkAddon } from "./addons/check.ts";
import { runDemo } from "./demo.ts";
import { resolveAddonDirs } from "./addons/loader.ts";
import { runCommand, startupNotices, USAGE } from "./commands.ts";
import { resolve } from "node:path";
import { resolveWorkspace } from "./config.ts";
import { runInit } from "./init.ts";
import { openToolbox } from "./toolbox.ts";

const argv = process.argv.slice(2);
// Options may come before the command; commands.ts reads --app and --env from the rest.
const optionAt = new Set(argv.flatMap((a, i) => (a === "--workspace" || a === "--addons" ? [i, i + 1] : [])));
const [command, ...args] = argv.filter((_, i) => !optionAt.has(i));
try {
  if (!command || command === "help" || command === "--help") console.log(USAGE);
  else if (command === "demo") {
    const flag = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
    // The shipped demo, unless a workspace is named on the command line: OPS_WORKSPACE usually points at your own.
    const workspace = argv.includes("--workspace")
      ? resolveWorkspace(argv)
      : resolve(import.meta.dirname, "../examples/my-workspace");
    const toolbox = await openToolbox(workspace, resolveAddonDirs(argv));
    const pace = flag("--pace") !== undefined ? Number(flag("--pace")) : process.stdout.isTTY ? 350 : 0;
    const result = await runDemo(
      toolbox,
      workspace,
      { scenario: flag("--scenario"), pace, color: Boolean(process.stdout.isTTY) && !process.env.NO_COLOR },
      (line) => console.log(line),
    );
    if (!result.ok) process.exitCode = 1;
  } else if (command === "addon") {
    const flag = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
    const [sub, folder] = args;
    if (sub !== "check" || !folder || folder.startsWith("--"))
      throw new Error("Usage: npm run ops -- addon check <folder> [--call <tool> --input '{...}' [--app a] [--env e]]");
    const call = flag("--call");
    const result = await checkAddon(folder, {
      workspace: resolveWorkspace(argv),
      call: call
        ? {
            tool: call,
            input: JSON.parse(flag("--input") ?? "{}") as Record<string, unknown>,
            app: flag("--app"),
            env: flag("--env"),
          }
        : undefined,
    });
    console.log(result.text);
    if (!result.ok) process.exitCode = 1;
  } else if (command === "init") console.log(await runInit(resolveWorkspace(argv), args));
  else {
    const toolbox = await openToolbox(resolveWorkspace(argv), resolveAddonDirs(argv));
    if (command !== "doctor") for (const notice of startupNotices(toolbox)) console.error(notice);
    console.log(await runCommand(toolbox, command, args));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
