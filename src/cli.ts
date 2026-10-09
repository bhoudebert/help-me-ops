// Terminal entry point: npm run ops -- <command>. Thin: the logic is in commands.ts.
import { checkAddon } from "./addons/check.ts";
import { runDemo } from "./demo.ts";
import { runSetup } from "./setup.ts";
import { resolveAddonDirs } from "./addons/loader.ts";
import { runCommand, startupNotices, USAGE } from "./commands.ts";
import { resolve } from "node:path";
import { resolveWorkspace } from "./config.ts";
import { runAsk, runChat } from "./agent/commands.ts";
import { formatSuite, runSuite } from "./agent/eval.ts";
import { runInit } from "./init.ts";
import { createInterface } from "node:readline/promises";
import { openToolbox } from "./toolbox.ts";

const argv = process.argv.slice(2);
// Options may come before the command; commands.ts reads --app and --env from the rest.
const optionAt = new Set(argv.flatMap((a, i) => (a === "--workspace" || a === "--addons" ? [i, i + 1] : [])));
const [command, ...args] = argv.filter((_, i) => !optionAt.has(i));
try {
  if (!command || command === "help" || command === "--help") console.log(USAGE);
  else if (command === "setup") {
    const explicit = argv.includes("--workspace") || process.env.OPS_WORKSPACE;
    const result = await runSetup(args, {
      clone: resolve(import.meta.dirname, ".."),
      workspace: explicit ? resolveWorkspace(argv) : resolve(import.meta.dirname, "../examples/my-workspace"),
      defaulted: !explicit,
    });
    console.log(result.text);
    if (!result.ok) process.exitCode = 1;
  } else if (command === "demo") {
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
  } else if (command === "eval") {
    // the last one wins, so `npm run eval:local -- --runs 5` overrides the script
    const flag = (name: string) => (argv.includes(name) ? argv[argv.lastIndexOf(name) + 1] : undefined);
    const workspace = resolveWorkspace(argv);
    const toolbox = await openToolbox(workspace, resolveAddonDirs(argv));
    const list = (value: string | undefined, fallback: string[]) =>
      value
        ? value
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)
        : fallback;
    const model = flag("--model") ?? process.env.OPS_MODEL ?? toolbox.model?.model;
    if (!model)
      throw new Error('ops eval needs a model: --model <name>[,<name>] (or OPS_MODEL, or "model" in ops.config.json).');
    const report = await runSuite(
      toolbox,
      workspace,
      {
        scenario: flag("--scenario"),
        runs: Number(flag("--runs") ?? 3),
        models: list(flag("--model"), [model]),
        reasoning: list(flag("--reasoning"), [toolbox.model?.reasoningEffort ?? "default"]),
        baseUrl: flag("--base-url"),
      },
      process.env,
      globalThis.fetch,
      (line) => console.error(line),
    );
    console.log(argv.includes("--json") ? JSON.stringify(report, null, 2) : formatSuite(report));
  } else if (command === "ask" || command === "chat") {
    const flag = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
    const flags = {
      baseUrl: flag("--base-url"),
      model: flag("--model"),
      maxSteps: flag("--max-steps") ? Number(flag("--max-steps")) : undefined,
      reasoningEffort: flag("--reasoning"),
    };
    const toolbox = await openToolbox(resolveWorkspace(argv), resolveAddonDirs(argv));
    for (const notice of startupNotices(toolbox)) console.error(notice);
    const io = { write: (line: string) => console.log(line), step: (line: string) => console.error(line) };
    if (command === "ask") {
      const valued = new Set(["--base-url", "--model", "--max-steps", "--reasoning"]);
      const words = args.filter((a, i) => !a.startsWith("--") && !valued.has(args[i - 1] ?? ""));
      const result = await runAsk(
        toolbox,
        words.join(" "),
        argv.includes("--json") ? { ...io, write: () => undefined } : io,
        flags,
      );
      if (argv.includes("--json")) console.log(JSON.stringify(result, null, 2));
      if (result.status !== "concluded") process.exitCode = 1;
    } else {
      const terminal = createInterface({ input: process.stdin, output: process.stderr });
      try {
        await runChat(toolbox, { ...io, read: (prompt) => terminal.question(prompt).catch(() => null) }, flags);
      } finally {
        terminal.close();
      }
    }
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
