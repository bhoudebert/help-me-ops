// The mask: fields and patterns listed in ops.config.json are replaced by stars
// in what the tools return, before the assistant sees it. A seat belt.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

// ---- what an addon declares: its personal fields, and detectors for its own formats ----

import { AddonPrivacy, selfTest } from "../src/privacy.ts";
import { checkAddon } from "../src/addons/check.ts";
import { loadAddons } from "../src/addons/loader.ts";

const acme = AddonPrivacy.parse({
  personalFields: ["email", "contact.name"],
  detectors: {
    "company-id": {
      description: "A company id: ACME- and six digits, the last of them a Luhn check",
      regex: "ACME-\\d{6}",
      validate: "luhn",
      examples: { matches: ["ACME-123455"], ignores: ["ACME-123456", "ACME-12"] },
    },
    ticket: { regex: "tkt-[a-z]{4}", ignoreCase: true },
  },
});

test("addon detectors: named as addon.name, with a checksum so only real ids are hidden", () => {
  const m = createMasker(PrivacyConfig.parse({ mask: { patterns: ["acme.company-id", "acme.ticket"] } }), { acme })!;
  const out = evidenceOf(
    m.answer(answer(record("ACME-123455 paid, ACME-123456 is no id, see TKT-ABCD and tkt-wxyz"))).text,
  );
  assert.equal(out.evidence[0]!.summary, "*** paid, ACME-123456 is no id, see *** and ***");
  assert.match(m.describe(), /patterns acme\.company-id, acme\.ticket/);
  assert.deepEqual(selfTest("company-id", acme.detectors["company-id"]!), []);
  assert.deepEqual(
    selfTest(
      "x",
      AddonPrivacy.parse({ detectors: { x: { regex: "a+", examples: { matches: ["b"], ignores: ["aa"] } } } }).detectors
        .x!,
    ),
    ['x: "b" should be hidden and is not', 'x: "aa" should be left alone and is hidden'],
  );
  const iban = AddonPrivacy.parse({
    detectors: { iban: { regex: "[A-Z]{2}\\d{2}[A-Z0-9]{10,30}", validate: "iban" } },
  });
  const ibans = createMasker(PrivacyConfig.parse({ mask: { patterns: ["x.iban"] } }), { x: iban })!;
  assert.equal(
    evidenceOf(ibans.answer(answer(record("GB82WEST12345698765432 and GB83WEST12345698765432"))).text).evidence[0]!
      .summary,
    "*** and GB83WEST12345698765432",
  );
});

test("addon fields: declared by the addon, switched on by the workspace, and applied to that addon's own answers", () => {
  const record1 = answer(
    record("jane@example.com, Jane Doe, jane@example.com", {
      email: "jane@example.com",
      contact: { name: "Jane Doe" },
    }),
  );
  const off = createMasker(PrivacyConfig.parse({ mask: { patterns: ["ip"] } }), { acme })!;
  assert.ok(off.answer(record1, "acme.getAccount").text.includes("jane@example.com"), "not switched on");
  for (const fromAddons of [true, ["acme"]]) {
    const on = createMasker(PrivacyConfig.parse({ mask: { fromAddons } }), { acme })!;
    const own = evidenceOf(on.answer(record1, "acme.getAccount").text);
    assert.equal(own.evidence[0]!.data.email, "***");
    assert.equal(own.evidence[0]!.data.contact.name, "***");
    assert.equal(own.evidence[0]!.summary, "***, ***, ***");
    assert.ok(
      on.answer(record1, "other.getThing").text.includes("jane@example.com"),
      "another addon's answer is not touched",
    );
    assert.ok(on.answer(record1, "searchSource").text.includes("jane@example.com"), "nor a core tool's");
    assert.match(on.describe(), /fields declared by addons acme\(email, contact\.name\)/);
  }
  assert.equal(
    createMasker(PrivacyConfig.parse({ mask: { fromAddons: true } }), {}),
    null,
    "no addon declares anything: nothing to hide",
  );
});

test("a reference to what does not exist is refused, not ignored", () => {
  const config = (mask: object) => PrivacyConfig.parse({ mask });
  assert.throws(
    () => createMasker(config({ patterns: ["acme.nope"] }), { acme }),
    /"acme\.nope" is not a detector of a loaded addon \(detectors: acme\.company-id, acme\.ticket\)/,
  );
  assert.throws(
    () => createMasker(config({ patterns: ["ghost.id"] }), {}),
    /not a detector of a loaded addon \(detectors: none\)/,
  );
  assert.throws(
    () => createMasker(config({ fromAddons: ["ghost"] }), { acme }),
    /no loaded addon "ghost" declares personal fields \(those that do: acme\)/,
  );
  assert.throws(() => config({ patterns: ["Bad.Name"] }), /built-in pattern, <addon>\.<detector>/);
});

test("a detector is JSON that can only hide: regex length, runaway repeats and names are checked", () => {
  const spec = (regex: string) => () => AddonPrivacy.parse({ detectors: { d: { regex } } });
  assert.throws(spec("("), /not a valid regular expression/);
  assert.throws(spec("(a+)+$"), /a repeated group inside a repeat/);
  assert.throws(spec("(\\d*)*"), /a repeated group inside a repeat/);
  assert.throws(spec("a".repeat(201)), /longer than 200 characters/);
  assert.doesNotThrow(spec("[A-Z]{3}-\\d{4,8}(?:-[a-z]+)?"));
  assert.throws(
    () => AddonPrivacy.parse({ detectors: { "Bad Name": { regex: "x" } } }),
    /a detector name is lowercase/,
  );
  assert.throws(() => AddonPrivacy.parse({ detectors: { d: { regex: "x", validate: "rot13" } } }));
});

test("in the demo: the order addon's own field and detector hide the customer in the order and in the logs", async () => {
  const dir = maskedDemo({ fromAddons: ["order"], patterns: ["order.user-id"] });
  const toolbox = await openToolbox(dir);
  const tools = createToolDefinitions(toolbox);
  const order = JSON.parse(await tools.find((t) => t.name === "order.getOrder")!.run({ env: "prod", id: "4512" }));
  assert.equal(order.evidence[0].data.user, "***");
  assert.ok(!JSON.stringify(order).includes("u-881"));
  const logs = JSON.stringify(
    await tools.find((t) => t.name === "searchSource")!.run({ env: "prod", source: "app-logs", query: "order=4512" }),
  );
  assert.ok(
    !logs.includes("u-881") && logs.includes("user=***"),
    "the detector of the order addon hides the same customer in the logs",
  );
  assert.match(
    await runCommand(toolbox, "doctor", []),
    /Privacy: masking patterns order\.user-id; fields declared by addons order\(user\) as \*\*\*/,
  );

  assert.ok(
    JSON.stringify(await tools.find((t) => t.name === "metrics.listMetrics")!.run({ env: "prod" })).length > 10,
    "another addon is untouched",
  );
  await assert.rejects(
    openToolbox(maskedDemo({ patterns: ["order.nope"] })),
    /"order\.nope" is not a detector of a loaded addon \(detectors: order\.user-id\)/,
  );
  await assert.rejects(
    openToolbox(maskedDemo({ fromAddons: ["metrics"] })),
    /no loaded addon "metrics" declares personal fields \(those that do: order\)/,
  );
});

test("an addon.ts can declare it too, and a bad declaration skips the addon with the reason", async () => {
  const root = mkdtempSync(join(tmpdir(), "ops-privacy-addon-"));
  const write = (path: string, text: string) => {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  write(
    "good/addon.ts",
    `export default { apiVersion: 1, privacy: { personalFields: ["email"], detectors: { id: { regex: "ID-\\\\d{4}" } } } };`,
  );
  write("bad/addon.ts", `export default { apiVersion: 1, privacy: { detectors: { id: { regex: "(a+)+" } } } };`);
  const { addons, report } = await loadAddons([{ dir: root, origin: "workspace" }]);
  assert.deepEqual(
    addons.map((a) => a.name),
    ["good"],
  );
  assert.deepEqual(addons[0]!.definition!.privacy!.personalFields, ["email"]);
  assert.match(report.find((r) => r.name === "bad")!.reason!, /a repeated group inside a repeat/);
});

test("addon check: the privacy of an addon is tested by its own examples", async () => {
  const demoOrder = resolve("examples/my-workspace/addons/order");
  const ok = await checkAddon(demoOrder);
  assert.match(ok.text, /ok\s+privacy: 1 personal field\(s\) \(user\), 1 detector\(s\)/);
  assert.match(ok.text, /ok\s+detector order\.user-id: 2 to hide and 3 to leave alone, as declared/);

  const dir = join(mkdtempSync(join(tmpdir(), "ops-privacy-check-")), "order");
  cpSync(demoOrder, dir, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(dir, "addon.json"), "utf8"));
  manifest.privacy.detectors["user-id"].examples.ignores.push("u-999");
  manifest.privacy.detectors.extra = { regex: "X-\\d{3}" };
  writeFileSync(join(dir, "addon.json"), JSON.stringify(manifest));
  const bad = await checkAddon(dir);
  assert.equal(bad.ok, false);
  assert.match(bad.text, /FAIL\s+detector order\.user-id: user-id: "u-999" should be left alone and is hidden/);
  assert.match(bad.text, /fix: fix the regex or the examples in addon.json \(privacy.detectors\)/);
  assert.match(bad.text, /warn\s+detector order\.extra: no examples/);
});
