// The checked conclusion: every quote must be something a tool returned in this
// session, from the source, at the time and for the environment it claims.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { checkConclusion, Ledger, type Conclusion } from "../src/conclusion.ts";
import { openToolbox } from "../src/toolbox.ts";
import { createToolDefinitions } from "../src/tools/index.ts";

const answer = (env: string | undefined, evidence: object[]) => JSON.stringify({ app: "shop", env, evidence });
const log = (summary: string, at: string | null, source = "app-logs", data: object = {}) => ({
  source,
  at,
  summary,
  data,
});

function ledger(...answers: string[]) {
  const l = new Ledger();
  answers.forEach((a, i) => l.record(`tool${i}`, a));
  return l;
}

const base: Conclusion = {
  env: "prod",
  cause: "The webhook was refused because the queue was full.",
  certainty: "likely",
  evidence: [{ source: "app-logs", at: "2026-10-07T10:00:02Z", quote: "webhook returned 503 (queue full)" }],
  unknowns: ["Whether the provider retries."],
  next: "Restart the worker, then replay the webhooks.",
};
const seen = ledger(
  answer("prod", [
    log("10:00:02 ERROR payments webhook returned 503 (queue full)", "2026-10-07T10:00:02Z"),
    log("order 4512: awaiting_payment", "2026-10-07T09:58:13Z", "order", {
      id: "4512",
      user: "u-881",
      status: "awaiting_payment",
    }),
  ]),
  answer("staging", [log("worker memory 212 MB, flat", "2026-10-07T10:00:00Z", "metrics")]),
  JSON.stringify({
    query: "x",
    evidence: [log("runbook: a 503 means the queue is over 1000 jobs", null, "knowledge")],
  }),
);

test("ledger: takes evidence out of tool answers, ignores what is not, and is capped", () => {
  const l = new Ledger();
  l.record("scope", "not json at all");
  l.record("scope", JSON.stringify({ likely: { app: "shop" } }));
  l.record(
    "odd",
    JSON.stringify({ evidence: [1, { source: 2 }, { source: "x", summary: "kept one", at: undefined }] }),
  );
  assert.deepEqual(
    l.seen.map((s) => [s.source, s.at, s.tool]),
    [["x", null, "odd"]],
  );
  const many = new Ledger();
  many.record(
    "t",
    answer(
      "prod",
      Array.from({ length: 6000 }, (_, i) => log(`line number ${i}`, null)),
    ),
  );
  assert.equal(many.seen.length, 5000);
  assert.equal(many.seen.at(-1)!.summary, "line number 5999");
});

test("check: a conclusion whose quotes were all returned is accepted, with a report", () => {
  const check = checkConclusion(base, seen);
  assert.equal(check.ok, true, check.problems.join("; "));
  assert.deepEqual(
    check.checked.map((c) => c.status),
    ["found"],
  );
  assert.match(check.report!, /^## Conclusion: likely \(prod\)/);
  assert.match(check.report!, /- 2026-10-07T10:00:02Z · app-logs · webhook returned 503 \(queue full\)/);
});

test("check: a quote is matched whatever its case, spacing and time notation, in the text of the data too", () => {
  const ok = (evidence: Conclusion["evidence"]) => checkConclusion({ ...base, evidence }, seen).ok;
  assert.equal(
    ok([{ source: "APP-LOGS", at: "2026-10-07T10:00:02.000Z", quote: "WEBHOOK   returned 503\n(queue full)" }]),
    true,
  );
  assert.equal(
    ok([{ source: "order", at: "2026-10-07T09:58:13Z", quote: "status awaiting_payment" }]),
    false,
    "words in another order are not a quote",
  );
  assert.equal(ok([{ source: "order", at: "2026-10-07T09:58:13Z", quote: "u-881" }]), false, "too short");
  assert.equal(ok([{ source: "order", at: "2026-10-07T09:58:13Z", quote: "order 4512: awaiting_payment" }]), true);
  const data = ledger(
    answer("prod", [log("a row", "2026-10-07T09:00:00Z", "db", { note: "paid by customer u-881 at the till" })]),
  );
  assert.equal(
    checkConclusion(
      {
        ...base,
        certainty: "likely",
        evidence: [{ source: "db", at: "2026-10-07T09:00:00Z", quote: "paid by customer u-881" }],
      },
      data,
    ).ok,
    true,
    "found in the data of the evidence",
  );
});

test("check: what is refused, and why", () => {
  const refuse = (change: Partial<Conclusion>) => checkConclusion({ ...base, ...change }, seen).problems.join("\n");
  const one = (quote: Partial<Conclusion["evidence"][number]>) => ({ evidence: [{ ...base.evidence[0]!, ...quote }] });
  assert.match(
    refuse(one({ quote: "the disk was full on the database host" })),
    /quote not found in anything a tool returned this session: "the disk was full/,
  );
  assert.match(refuse(one({ quote: "short" })), /is too short/);
  assert.match(refuse(one({ source: "metrics" })), /comes from app-logs, not from metrics/);
  assert.match(refuse(one({ at: "2026-10-07T11:00:00Z" })), /is at 2026-10-07T10:00:02Z, not 2026-10-07T11:00:00Z/);
  assert.match(refuse(one({ at: null })), /not no time/);
  assert.match(refuse({ env: "staging" }), /comes from prod, and the conclusion is about staging/);
  assert.match(refuse({ env: undefined }), /session read prod and staging: say which environment/);
  assert.match(refuse({ cause: "short" }), /cause: say what you think happened/);
  assert.match(refuse({ next: "  " }), /next: give the next step/);
  assert.match(refuse({ unknowns: [] }), /a likely conclusion says what is still unknown/);
  assert.match(refuse({ unknowns: ["  "] }), /still unknown/);
  assert.match(refuse({ certainty: "likely", evidence: [] }), /needs at least one piece of evidence/);
  const refused = checkConclusion({ ...base, ...one({ quote: "invented line of the log" }) }, seen);
  assert.equal(refused.ok, false);
  assert.equal(refused.report, undefined, "no report for a refused conclusion");
});

test("check: confirmed needs two sources, unknown needs no evidence, knowledge has no time", () => {
  const two: Conclusion["evidence"] = [
    base.evidence[0]!,
    { source: "order", at: "2026-10-07T09:58:13Z", quote: "order 4512: awaiting_payment" },
  ];
  assert.equal(checkConclusion({ ...base, certainty: "confirmed", evidence: two, unknowns: [] }, seen).ok, true);
  assert.match(
    checkConclusion({ ...base, certainty: "confirmed", unknowns: [] }, seen).problems.join(),
    /at least two different sources/,
  );
  const unknown = checkConclusion(
    { ...base, certainty: "unknown", evidence: [], cause: "Nothing in the evidence explains it yet." },
    seen,
  );
  assert.equal(unknown.ok, true, unknown.problems.join());
  assert.match(unknown.report!, /- none/);
  const runbook = checkConclusion(
    { ...base, evidence: [{ source: "knowledge", at: null, quote: "a 503 means the queue is over 1000 jobs" }] },
    seen,
  );
  assert.equal(runbook.ok, true, runbook.problems.join());
  assert.match(runbook.report!, /- no time · knowledge · a 503 means/);
});

test("check: the report lists the evidence oldest first, whatever the order given", () => {
  const evidence: Conclusion["evidence"] = [
    { source: "knowledge", at: null, quote: "a 503 means the queue is over 1000 jobs" },
    base.evidence[0]!,
    { source: "order", at: "2026-10-07T09:58:13Z", quote: "order 4512: awaiting_payment" },
  ];
  const report = checkConclusion({ ...base, evidence }, seen).report!;
  const at = (text: string) => report.indexOf(text);
  assert.ok(at("09:58:13") < at("10:00:02") && at("10:00:02") < at("no time · knowledge"));
  assert.match(report, /\*\*Next step, for a person\.\*\* Restart the worker/);
  assert.match(report, /Nothing was changed: every tool is read-only/);
  const none = checkConclusion(
    {
      ...base,
      certainty: "confirmed",
      evidence: [
        { source: "order", at: "2026-10-07T09:58:13Z", quote: "order 4512: awaiting_payment" },
        base.evidence[0]!,
      ],
      unknowns: [],
    },
    seen,
  ).report!;
  assert.match(none, /\*\*Still unknown\*\*\n- nothing the evidence leaves open/);
});

test("checkConclusion tool: sees what the other tools returned in the session, and only that session", async () => {
  const toolbox = await openToolbox(resolve("examples/my-workspace"));
  const session = createToolDefinitions(toolbox);
  const other = createToolDefinitions(toolbox);
  const run = async (tools: typeof session, name: string, input: Record<string, unknown>) => {
    const tool = tools.find((t) => t.name === name)!;
    return JSON.parse(await tool.run(tool.inputSchema.parse(input)));
  };
  const check = tools_check(session);
  const claim = {
    env: "prod",
    cause: "The order waits for a payment that was captured.",
    certainty: "likely",
    unknowns: ["Why."],
    next: "Look at the webhook.",
    evidence: [{ source: "order", at: "2026-10-07T09:58:13Z", quote: "order 4512 of u-881: awaiting_payment" }],
  };
  assert.equal((await check(claim)).ok, false, "nothing was read yet");
  await run(session, "order.getOrder", { env: "prod", id: "4512" });
  assert.equal((await check(claim)).ok, true);
  assert.equal((await tools_check(other)(claim)).ok, false, "another session has not read it");
  await assert.rejects(
    check({ ...claim, env: "production" }),
    /No env "production" in app shop\. Known: prod, staging\./,
  );
  assert.equal(session.find((t) => t.name === "checkConclusion")!.annotations.readOnlyHint, true);
  function tools_check(tools: typeof session) {
    return (input: Record<string, unknown>) => run(tools, "checkConclusion", input);
  }
});
