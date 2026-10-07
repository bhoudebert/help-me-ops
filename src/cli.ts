// Terminal entry point: npm run ops -- <command>. Thin: the logic is in commands.ts.
import { runCommand, USAGE } from "./commands.ts";
import { openToolbox } from "./toolbox.ts";

const [command, ...args] = process.argv.slice(2);
try {
  if (!command || command === "help" || command === "--help") console.log(USAGE);
  else console.log(await runCommand(await openToolbox(), command, args));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
