// The mask: fields and patterns listed in ops.config.json are replaced by stars
// in what the tools return, before the assistant sees it. A seat belt.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { runCommand } from "../src/commands.ts";
import { loadConfig } from "../src/config.ts";
import { createMasker, DETECTORS, hintsIn, MaskConfig, PrivacyConfig } from "../src/privacy.ts";
import { openToolbox } from "../src/toolbox.ts";
import { createToolDefinitions } from "../src/tools/index.ts";

const masker = (mask: Partial<MaskConfig>) => createMasker(PrivacyConfig.parse({ mask }))!;
const answer = (...evidence: object[]) => JSON.stringify({ app: "shop", env: "prod", evidence });
const record = (summary: string, data: object = {}) => ({ source: "db", at: "2026-10-07T10:00:00Z", summary, data });
const evidenceOf = (text: string) =>
  JSON.parse(text) as { evidence: { summary: string; data: any }[]; masked?: number };

test("fields: the value of a listed key is hidden at any depth, case ignored, in arrays too", () => {
  const out = evidenceOf(
    masker({ fields: ["email", "customer.name", "*phone*"] }).answer(
      answer(
        record("row", {
          id: 4512,
          Email: "jane@example.com",
          customer: { name: "Jane Doe", city: "Lyon" },
          contacts: [{ mobilePhone: "0612345678" }, { fax: "x" }],
          name: "not hidden: only customer.name is listed",
        }),
      ),
    ).text,
  );
  const data = out.evidence[0]!.data;
  assert.equal(data.Email, "***");
  assert.deepEqual(data.customer, { name: "***", city: "Lyon" });
  assert.equal(data.contacts[0].mobilePhone, "***");
  assert.equal(data.contacts[1].fax, "x");
  assert.equal(data.name, "not hidden: only customer.name is listed");
  assert.equal(data.id, 4512);
  assert.equal(out.masked, 3);
});

test("fields: what was hidden is hidden elsewhere in the same record too, the summary included", () => {
  const out = evidenceOf(
    masker({ fields: ["email"] }).answer(
      answer(
        record("order 4512 of jane@example.com: awaiting_payment, mail jane@example.com", {
          email: "jane@example.com",
          note: "wrote from jane@example.com",
        }),
      ),
    ).text,
  );
  const [item] = out.evidence;
  assert.equal(item!.summary, "order 4512 of ***: awaiting_payment, mail ***");
  assert.equal(item!.data.note, "wrote from ***");
  assert.ok(!JSON.stringify(out).includes("jane@example.com"));
  // short values and other records are not swept up
  const short = evidenceOf(
    masker({ fields: ["tag"] }).answer(answer(record("a b", { tag: "ab" }), record("tag ab here", {}))).text,
  );
  assert.equal(short.evidence[1]!.summary, "tag ab here");
});

test("patterns: emails, IPs, IBANs, cards that pass Luhn, phone numbers and credentials in any text", () => {
  const all = masker({ patterns: ["email", "ip", "iban", "card", "phone", "token"] });
  const text =
    "mail a.b+c@example.org from 203.0.113.42 pays FR76 3000 6000 0112 3456 7890 189 by 4111 1111 1111 1111 call +33 6 12 34 56 78 with Bearer abcdefghijklmnopqrstuvwxyz012345";
  const out = evidenceOf(all.answer(answer(record(text, { line: text }))).text);
  assert.equal(out.evidence[0]!.summary, "mail *** from *** pays *** by *** call *** with ***");
  assert.equal(out.evidence[0]!.data.line, out.evidence[0]!.summary);
  assert.equal(out.masked, 12);
  const kept = "order 4111 1111 1111 1112 at 2026-10-07T10:00:00Z, version 10.2.3.4.5, 4512, u-881";
  assert.equal(
    evidenceOf(all.answer(answer(record(kept))).text).evidence[0]!.summary,
    kept,
    "numbers that are not data are left alone",
  );
  assert.equal(evidenceOf(all.answer(answer(record("the +33 number"))).text).masked, undefined);
});

test("patterns: your own regex, a replacement of your choice, nothing configured means no masker", () => {
  const custom = masker({ patterns: [{ name: "customer-id", regex: "CUST-\\d{6}" }], replacement: "[hidden]" });
  assert.equal(
    evidenceOf(custom.answer(answer(record("CUST-123456 paid, CUST-9 not an id"))).text).evidence[0]!.summary,
    "[hidden] paid, CUST-9 not an id",
  );
  assert.equal(createMasker(undefined), null);
  assert.equal(createMasker(PrivacyConfig.parse({ mask: {} })), null);
  assert.match(
    masker({ fields: ["email"], patterns: ["ip", { name: "x", regex: "y" }] }).describe(),
    /masking fields email; patterns ip, x as \*\*\*/,
  );
  assert.throws(() => PrivacyConfig.parse({ mask: { patterns: ["name"] } }));
  assert.throws(
    () => PrivacyConfig.parse({ mask: { patterns: [{ name: "bad", regex: "(" }] } }),
    /not a valid regular expression/,
  );
});

test("masking leaves what is not evidence alone, does not change its input, and keeps the shape", () => {
  const m = masker({ fields: ["email"], patterns: ["email"] });
  assert.deepEqual(m.answer("# A playbook\ncall jane@example.com"), {
    text: "# A playbook\ncall jane@example.com",
    count: 0,
  });
  const scope = JSON.stringify({ likely: { app: "shop" } });
  assert.equal(m.answer(scope).text, scope);
  const original = answer(record("jane@example.com", { email: "jane@example.com", id: 1 }));
  const before = original.slice();
  const done = m.answer(original);
  assert.equal(original, before);
  const item = evidenceOf(done.text).evidence[0]!;
  assert.deepEqual(Object.keys(item), ["source", "at", "summary", "data"]);
  assert.equal((item as any).at, "2026-10-07T10:00:00Z");
  assert.equal((item as any).source, "db");
});

test("hintsIn: the detectors of the mask are the ones addon check warns with", () => {
  assert.deepEqual(hintsIn("jane@example.com at 203.0.113.1"), ["an email address", "an IP address"]);
  assert.deepEqual(hintsIn("nothing to see"), []);
  assert.deepEqual(Object.keys(DETECTORS).sort(), ["card", "email", "iban", "ip", "phone", "token"]);
});

/** A copy of the demo workspace with the mask on. */
function maskedDemo(mask: object) {
  const dir = mkdtempSync(join(tmpdir(), "ops-mask-"));
  cpSync(resolve("examples/my-workspace"), dir, {
    recursive: true,
    filter: (src) => !/node_modules|\.demo-repo/.test(src),
  });
  const config = JSON.parse(readFileSync(join(dir, "ops.config.json"), "utf8"));
  writeFileSync(join(dir, "ops.config.json"), JSON.stringify({ ...config, privacy: { mask } }));
  return dir;
}

test("in the demo: the user of an order is hidden in the summary and the data, the order is still found", async () => {
  const dir = maskedDemo({ fields: ["user"] });
  const tools = createToolDefinitions(await openToolbox(dir));
  const order = tools.find((t) => t.name === "order.getOrder")!;
  const out = JSON.parse(await order.run({ env: "prod", id: "4512" })) as {
    masked: number;
    evidence: { summary: string; data: { user: string; status: string } }[];
  };
  assert.equal(out.masked, 3, "the field, the summary, and the copy of the summary in the data");
  assert.equal(out.evidence[0]!.data.user, "***");
  assert.equal(out.evidence[0]!.data.status, "awaiting_payment");
  assert.match(out.evidence[0]!.summary, /^order 4512 of \*\*\*: awaiting_payment since/);
  assert.ok(!JSON.stringify(out).includes("u-881"));
  // the logs are text: a pattern hides what a field cannot
  assert.match(
    JSON.stringify(
      JSON.parse(
        await tools.find((t) => t.name === "searchSource")!.run({ env: "prod", source: "app-logs", query: "u-881" }),
      ),
    ),
    /u-881/,
    "no pattern named: the log line is as it was",
  );
});

test("in the demo: patterns hide what is in free text (logs, knowledge)", async () => {
  const dir = maskedDemo({ patterns: [{ name: "user-id", regex: "u-\\d+" }, "phone"] });
  const tools = createToolDefinitions(await openToolbox(dir));
  const logs = JSON.parse(
    await tools.find((t) => t.name === "searchSource")!.run({ env: "prod", source: "app-logs", query: "order=4512" }),
  ) as { masked: number; evidence: { summary: string }[] };
  assert.ok(logs.masked >= 1);
  assert.ok(logs.evidence.some((e) => /user=\*\*\*/.test(e.summary)));
  assert.ok(!JSON.stringify(logs).includes("u-881"));
});

test("the checked conclusion is built on what the assistant saw: the masked line passes, the unmasked one is refused", async () => {
  const dir = maskedDemo({ fields: ["user"] });
  const tools = createToolDefinitions(await openToolbox(dir));
  const run = async (name: string, input: Record<string, unknown>) => {
    const tool = tools.find((t) => t.name === name)!;
    return JSON.parse(await tool.run(tool.inputSchema.parse(input)));
  };
  await run("order.getOrder", { env: "prod", id: "4512" });
  const claim = (quote: string) => ({
    env: "prod",
    cause: "The order waits for a payment that was captured.",
    certainty: "likely",
    unknowns: ["why"],
    next: "Look at the webhook.",
    evidence: [{ source: "order", at: "2026-10-07T09:58:13Z", quote }],
  });
  assert.equal((await run("checkConclusion", claim("order 4512 of ***: awaiting_payment"))).ok, true);
  const refused = await run("checkConclusion", claim("order 4512 of u-881: awaiting_payment"));
  assert.equal(refused.ok, false);
  assert.ok(!JSON.stringify(refused).includes("report"));
});

test("config and doctor: the mask is read from ops.config.json, shown by doctor, and a bad one is refused", async () => {
  const dir = maskedDemo({ fields: ["email", "phone"], patterns: ["card"] });
  const { config } = await loadConfig(dir);
  assert.deepEqual(config.privacy!.mask.fields, ["email", "phone"]);
  assert.equal(config.privacy!.mask.replacement, "***");
  const toolbox = await openToolbox(dir);
  assert.match(
    await runCommand(toolbox, "doctor", []),
    /^Workspace: .*\nPrivacy: masking fields email, phone; patterns card as \*\*\*\n/,
  );
  assert.match(
    await runCommand(await openToolbox(resolve("examples/my-workspace")), "doctor", []),
    /Privacy: no masking: what the tools return goes to your AI provider/,
  );
  const bad = maskedDemo({ patterns: ["social-security"] });
  await assert.rejects(openToolbox(bad), /Invalid config/);
});
