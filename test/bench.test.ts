// The records of benchmark runs, and the table made from them.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BenchRecord, fileNameOf, readRecords, recordOf, renderTable, withTable } from "../src/agent/bench.ts";
import type { EvalSuite } from "../src/agent/eval.ts";

const run = (cause: boolean, status: "concluded" | "answered" = "concluded", seconds = 10) => ({
  status,
  steps: 5,
  tokens: 1000,
  seconds,
  facts: cause ? ["a fact"] : [],
  cause,
});
const suite = (model: string, reasoning: string, scenarios: Record<string, boolean[]>): EvalSuite => ({
  baseUrl: "http://localhost:11434/v1",
  reports: Object.entries(scenarios).map(([scenario, causes]) => ({
    scenario,
    expected: [],
    baseUrl: "http://localhost:11434/v1",
    settings: [{ model, reasoning, runs: causes.map((c) => run(c)) }],
  })),
});
const record = (at: string, s: EvalSuite) => recordOf(s, { commit: "abc1234", machine: "a box", now: new Date(at) });

test("table: one row per setting, one column per scenario with the runs that found the cause", () => {
  const table = renderTable([
    record(
      "2026-10-09T10:00:00Z",
      suite("m1", "none", { "a-one": [true, true, false], "b-two": [false, false, false] }),
    ),
  ]);
  assert.equal(
    table,
    [
      "| Setting             | a-one | b-two | Accepted | Median time |",
      "| ------------------- | ----: | ----: | -------: | ----------: |",
      "| m1 · reasoning none |   2/3 |   0/3 |      6/6 |        10 s |",
    ].join("\n"),
  );
});

test("table: the latest record of a setting wins, whole, and settings of other records stay", () => {
  const old = record("2026-10-01T10:00:00Z", suite("m1", "none", { a: [false], b: [false] }));
  const fresh = record("2026-10-09T10:00:00Z", suite("m1", "none", { a: [true] }));
  const other = record("2026-10-05T10:00:00Z", suite("m2", "default", { a: [true], b: [true] }));
  const table = renderTable([old, fresh, other]);
  // m1 comes from the fresh record only (no `b` from the old one); m2 from its own
  assert.match(table, /\| m1 · reasoning none\s+\|\s+1\/1 \|\s+- \|\s+1\/1 \|/);
  assert.match(table, /\| m2 · reasoning default \|\s+1\/1 \|\s+1\/1 \|\s+2\/2 \|/);
  // the order of the records given does not matter
  assert.equal(renderTable([other, fresh, old]), table);
});

test("page: the table is what the markers hold, and a page without markers is an error", () => {
  const page = "intro\n\n<!-- bench:table:start -->\n\nold\n\n<!-- bench:table:end -->\n\noutro";
  assert.equal(
    withTable(page, "| t |"),
    "intro\n\n<!-- bench:table:start -->\n\n| t |\n\n<!-- bench:table:end -->\n\noutro",
  );
  assert.throws(() => withTable("no markers", "| t |"), /needs <!-- bench:table:start -->/);
});

test("records: a file name from the date, the machine and the models; a bad file is named", () => {
  const r = record("2026-10-09T10:00:00Z", suite("qwen3:14b", "none", { a: [true] }));
  assert.equal(fileNameOf(r, "RTX 5080"), "2026-10-09-rtx-5080-qwen3-14b.json");
  const dir = mkdtempSync(join(tmpdir(), "ops-bench-"));
  writeFileSync(join(dir, "bad.json"), JSON.stringify({ version: 1 }));
  assert.throws(() => readRecords(dir), /bad\.json is not a benchmark record/);
});

test("the stored records are valid, and the table of the guide is exactly what they produce", () => {
  const records = readRecords("bench/results");
  assert.ok(records.length >= 2);
  for (const r of records) {
    assert.ok(BenchRecord.safeParse(r).success);
    assert.match(r.machine, /\S/);
    assert.match(r.commit, /^[0-9a-f]{7}/);
    for (const report of r.suite.reports) for (const s of report.settings) assert.ok(s.runs.length >= 1);
  }
  const page = readFileSync("docs/guide/benchmarks.md", "utf8");
  assert.equal(withTable(page, renderTable(records)), page, "run `npm run bench:table`");
});
