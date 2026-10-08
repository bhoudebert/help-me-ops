// Terminal entry point: npm run ops -- <command>. Thin: the logic is in commands.ts.
import { resolveAddonDirs } from "./addons/loader.ts";
import { runCommand, startupNotices, USAGE } from "./commands.ts";
import { resolveWorkspace } from "./config.ts";
import { initAddon } from "./init.ts";
import { openToolbox } from "./toolbox.ts";

const argv = process.argv.slice(2);
// Options may come before the command; commands.ts reads --app and --env from the rest.
const optionAt = new Set(argv.flatMap((a, i) => (a === "--workspace" || a === "--addons" ? [i, i + 1] : [])));
const [command, ...args] = argv.filter((_, i) => !optionAt.has(i));
try {
  if (!command || command === "help" || command === "--help") console.log(USAGE);
  else if (command === "init") console.log(await initAddon(resolveWorkspace(argv), args));
  else {
    const toolbox = await openToolbox(resolveWorkspace(argv), resolveAddonDirs(argv));
    if (command !== "doctor") for (const notice of startupNotices(toolbox)) console.error(notice);
    console.log(await runCommand(toolbox, command, args));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
