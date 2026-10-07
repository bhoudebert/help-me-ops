// Terminal entry point: npm run ops -- <command>. Thin: the logic is in commands.ts.
import { runCommand, USAGE } from "./commands.ts";
import { resolveWorkspace } from "./config.ts";
import { openToolbox } from "./toolbox.ts";

const argv = process.argv.slice(2);
// Options may come before the command; commands.ts reads --app and --env from the rest.
const at = argv.indexOf("--workspace");
const [command, ...args] = at >= 0 ? argv.filter((_, i) => i !== at && i !== at + 1) : argv;
try {
  if (!command || command === "help" || command === "--help") console.log(USAGE);
  else console.log(await runCommand(await openToolbox(resolveWorkspace(argv)), command, args));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
