// Run `ops eval` and keep the result as a file in bench/results, with where and
// when. The guide's table is made of these files (npm run bench:table).
//
//   npm run bench -- --machine "RTX 5080 16 GB, Ollama 0.32.14 (CUDA)" --label rtx5080 \
//     --model qwen3:14b --reasoning none --runs 5 --base-url http://localhost:11434/v1
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileNameOf, readRecords, recordOf, renderTable, withTable } from "../src/agent/bench.ts";
import { runSuite } from "../src/agent/eval.ts";
import { resolveAddonDirs } from "../src/addons/loader.ts";
import { openToolbox } from "../src/toolbox.ts";

const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
const list = (value: string | undefined, fallback: string[]) =>
  value
    ? value
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
    : fallback;
const resultsDir = resolve("bench/results");
const pagePath = resolve("docs/guide/benchmarks.md");

if (process.argv.includes("--table")) {
  // Rewrite the table of the guide page from the records.
  const table = renderTable(readRecords(resultsDir));
  const page = withTable(readFileSync(pagePath, "utf8"), table);
  writeFileSync(pagePath, page);
  console.log(table);
} else {
  const machine = arg("--machine");
  const label = arg("--label");
  const models = list(arg("--model"), []);
  if (!machine || !label || !models.length) {
    throw new Error(
      'Usage: npm run bench -- --machine "<hardware and server>" --label <short> --model a[,b] [--runs 5] [--reasoning none,default] [--scenario a,b] [--base-url url] [--notes "..."]',
    );
  }
  const workspace = resolve(arg("--workspace") ?? "examples/my-workspace");
  const toolbox = await openToolbox(workspace, resolveAddonDirs(process.argv));
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const commit = `${git("rev-parse", "--short", "HEAD")}${git("status", "--porcelain", "--", "src", "addons", "examples") ? "+dirty" : ""}`;
  const suite = await runSuite(
    toolbox,
    workspace,
    {
      scenario: arg("--scenario"),
      runs: Number(arg("--runs") ?? 5),
      models,
      reasoning: list(arg("--reasoning"), ["default"]),
      baseUrl: arg("--base-url"),
    },
    process.env,
    globalThis.fetch,
    (line) => console.error(line),
  );
  const record = recordOf(suite, { commit, machine, notes: arg("--notes") });
  mkdirSync(resultsDir, { recursive: true });
  const file = join(resultsDir, fileNameOf(record, label));
  writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  console.log(`Wrote ${file}\nThen: npm run bench:table`);
}
