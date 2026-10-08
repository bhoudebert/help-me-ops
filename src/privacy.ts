// A safeguard over what the tools return: fields and patterns the workspace
// lists are replaced by stars before the answer leaves the server, so the
// assistant (and the AI provider behind it) never sees them. It sits at the one
// place every tool answer passes (ADR 0010). It is a seat belt, not a promise of
// anonymity: a name in free text is not a pattern. Fail closed: if masking cannot
// run, the tool fails rather than answering unmasked.
import { z } from "zod";

const luhn = (digits: string) => {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1 && (n *= 2) > 9) n -= 9;
    sum += n;
  }
  return sum % 10 === 0;
};

interface Detector {
  /** What it finds, for a hint: "an email address". */
  label: string;
  /** Replaces every match, and counts them. */
  replace(text: string, replacement: string): { text: string; count: number };
}

const byRegex = (label: string, regex: RegExp, accept: (match: string) => boolean = () => true): Detector => ({
  label,
  replace(text, replacement) {
    let count = 0;
    const out = text.replace(regex, (match) => {
      if (!accept(match)) return match;
      count++;
      return replacement;
    });
    return { text: out, count };
  },
});

/** The patterns a workspace can name. Conservative on purpose: a miss is better than hiding every number. */
export const DETECTORS = {
  email: byRegex("an email address", /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g),
  ip: byRegex(
    "an IP address",
    /(?<![\d.])(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}(?!\d|\.\d)/g,
  ),
  iban: byRegex("an IBAN", /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g),
  card: byRegex("a card number", /(?<![\d.])\d(?:[ -]?\d){12,18}(?![\d.])/g, (m) => luhn(m.replace(/\D/g, ""))),
  phone: byRegex("a phone number", /(?<![\w+])\+\d[\d ().-]{7,}\d/g),
  token: byRegex(
    "what looks like a credential",
    /\b(?:Bearer\s+[\w.-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_\w{20,}|github_pat_\w{20,}|sk-[\w-]{20,}|eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,})/g,
  ),
} satisfies Record<string, Detector>;
export type DetectorName = keyof typeof DETECTORS;

/** What in a text looks like personal data or a credential, as labels: a hint, never a verdict. */
export function hintsIn(text: string): string[] {
  return Object.values(DETECTORS)
    .filter((d) => d.replace(text, "").count > 0)
    .map((d) => d.label);
}

const names = Object.keys(DETECTORS) as [DetectorName, ...DetectorName[]];

// ---- what an addon declares about personal data (in its addon.json, as JSON: it can only hide) ----

const mod97 = (text: string) => {
  // ISO 7064 mod 97-10, as an IBAN uses it: the first four characters go last, letters are numbers.
  const compact = text.replace(/\s/g, "").toUpperCase();
  if (compact.length < 8) return false;
  const digits = [...`${compact.slice(4)}${compact.slice(0, 4)}`]
    .map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c))
    .join("");
  let rest = 0;
  for (const c of digits) rest = (rest * 10 + Number(c)) % 97;
  return rest === 1;
};

/** Checksums an addon can name, so a format with a check digit hides only what really is one. */
export const VALIDATORS = {
  luhn: (match: string) => luhn(match.replace(/\D/g, "")),
  iban: mod97,
} as const;
export type ValidatorName = keyof typeof VALIDATORS;

const safeRegex = (source: string): string | null => {
  if (source.length > 200) return "longer than 200 characters";
  // A group that repeats and holds a repeat, `(a+)+`, can make a search take forever.
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(source)) return "a repeated group inside a repeat can run away; write it flat";
  try {
    new RegExp(source);
  } catch {
    return "not a valid regular expression";
  }
  return null;
};

export const DetectorSpec = z.object({
  /** What it finds, in words: it names the hint and the line of `doctor`. */
  description: z.string().optional(),
  regex: z
    .string()
    .min(1)
    .superRefine((source, context) => {
      const problem = safeRegex(source);
      if (problem) context.addIssue({ code: "custom", message: problem });
    }),
  /** A checksum the match must pass, or it is left alone. */
  validate: z.enum(Object.keys(VALIDATORS) as [ValidatorName, ...ValidatorName[]]).optional(),
  ignoreCase: z.boolean().default(false),
  /** Checked by `addon check`: what must be hidden, and what must not. */
  examples: z.object({ matches: z.array(z.string()).default([]), ignores: z.array(z.string()).default([]) }).optional(),
});
export type DetectorSpec = z.infer<typeof DetectorSpec>;

export const AddonPrivacy = z.object({
  /** Keys of the addon's records that are personal, hidden when the workspace asks (`fromAddons`). */
  personalFields: z.array(z.string().min(1)).default([]),
  /** Formats only this addon knows, named in `privacy.mask.patterns` as `<addon>.<name>`. */
  detectors: z
    .record(
      z.string().regex(/^[a-z][a-z0-9-]*$/, "a detector name is lowercase letters, digits and hyphens"),
      DetectorSpec,
    )
    .default({}),
});
export type AddonPrivacy = z.infer<typeof AddonPrivacy>;

export function buildDetector(spec: DetectorSpec, label: string): Detector {
  const accept = spec.validate ? VALIDATORS[spec.validate] : () => true;
  return byRegex(label, new RegExp(spec.regex, spec.ignoreCase ? "gi" : "g"), accept);
}

/** Runs the examples of a detector: the problems found, none when it does what it says. */
export function selfTest(name: string, spec: DetectorSpec): string[] {
  const detector = buildDetector(spec, name);
  const problems: string[] = [];
  for (const text of spec.examples?.matches ?? []) {
    if (detector.replace(text, "***").count === 0) problems.push(`${name}: "${text}" should be hidden and is not`);
  }
  for (const text of spec.examples?.ignores ?? []) {
    if (detector.replace(text, "***").count > 0) problems.push(`${name}: "${text}" should be left alone and is hidden`);
  }
  return problems;
}

export const MaskConfig = z
  .object({
    /** Keys whose values are hidden, at any depth: `email`, `*phone*`, `customer.name`. Case ignored. */
    fields: z.array(z.string().min(1)).default([]),
    /** Patterns hidden wherever they appear in a text: the named detectors, or your own regex. */
    patterns: z
      .array(
        z.union([
          z.enum(names),
          // `<addon>.<detector>`: a format an addon declares
          z
            .string()
            .regex(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/, "a built-in pattern, <addon>.<detector>, or { name, regex }"),
          z.object({
            name: z.string().min(1),
            regex: z
              .string()
              .min(1)
              .refine((r) => {
                try {
                  new RegExp(r);
                  return true;
                } catch {
                  return false;
                }
              }, "not a valid regular expression"),
          }),
        ]),
      )
      .default([]),
    /** What replaces a hidden value. It does not keep the length of what it hides. */
    replacement: z.string().default("***"),
    /** Also hide the personal fields addons declare, in their own tools' answers: true, or the addons to take. */
    fromAddons: z.union([z.boolean(), z.array(z.string().min(1))]).default(false),
  })
  .default({ fields: [], patterns: [], replacement: "***", fromAddons: false });
export type MaskConfig = z.infer<typeof MaskConfig>;

export const PrivacyConfig = z.object({ mask: MaskConfig });
export type PrivacyConfig = z.infer<typeof PrivacyConfig>;

export interface Masked {
  text: string;
  /** How many values or matches were hidden. */
  count: number;
}

export interface Masker {
  /** The one-line description for `doctor` and the instructions. */
  describe(): string;
  /** Masks the evidence of a tool's answer (`tool` is its name, `addon.tool` for an addon); an answer without evidence is returned as it is. */
  answer(text: string, tool?: string): Masked;
}

/** Case, underscores, hyphens and spaces do not tell two spellings of a key apart: firstName, first_name, FIRST-NAME. */
const squash = (text: string) => text.toLowerCase().replace(/[\s_-]+/g, "");

const keyMatcher = (pattern: string) => {
  const wild = (part: string) =>
    new RegExp(
      `^${squash(part)
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")}$`,
    );
  const tests = pattern.split(".").map(wild);
  return (path: string[]) => {
    if (path.length < tests.length) return false;
    const tail = path.slice(-tests.length).map(squash);
    return tests.every((test, i) => test.test(tail[i]!));
  };
};

/**
 * A masker for the configuration, or null when nothing is to be hidden. `addons`
 * is what the loaded addons declare: the detectors a pattern can name
 * (`acme.company-id`) and the personal fields `fromAddons` switches on, for the
 * answers of that addon's own tools. A reference to what does not exist is an
 * error: a mask that silently hides nothing is worse than none.
 */
export function createMasker(
  config: PrivacyConfig | undefined,
  addons: Record<string, AddonPrivacy> = {},
): Masker | null {
  const mask = config?.mask;
  if (!mask) return null;
  const { replacement } = mask;
  const taken = mask.fromAddons === true ? Object.keys(addons) : Array.isArray(mask.fromAddons) ? mask.fromAddons : [];
  for (const name of taken) {
    if (!addons[name]) {
      throw new Error(
        `privacy.mask.fromAddons: no loaded addon "${name}" declares personal fields (those that do: ${Object.keys(addons).join(", ") || "none"})`,
      );
    }
  }
  const addonMatchers = new Map(taken.map((name) => [name, addons[name]!.personalFields.map(keyMatcher)]));
  const used = [...addonMatchers.values()].some((m) => m.length);
  if (!mask.fields.length && !mask.patterns.length && !used) return null;
  const matchers = mask.fields.map(keyMatcher);
  const detectors: Detector[] = mask.patterns.map((p) => {
    if (typeof p !== "string") return byRegex(p.name, new RegExp(p.regex, "g"));
    if (!p.includes(".")) return DETECTORS[p as DetectorName];
    const [addon = "", name = ""] = p.split(".");
    const spec = addons[addon]?.detectors[name];
    if (!spec) {
      const known = Object.entries(addons).flatMap(([a, x]) => Object.keys(x.detectors).map((d) => `${a}.${d}`));
      throw new Error(
        `privacy.mask.patterns: "${p}" is not a detector of a loaded addon (detectors: ${known.join(", ") || "none"})`,
      );
    }
    return buildDetector(spec, p);
  });

  const applyPatterns = (text: string): { text: string; count: number } => {
    let count = 0;
    for (const detector of detectors) {
      const done = detector.replace(text, replacement);
      text = done.text;
      count += done.count;
    }
    return { text, count };
  };

  /** Hides the values of the listed fields, collecting what was hidden. */
  const walk = (
    value: unknown,
    path: string[],
    hidden: Set<string>,
    rules: ((path: string[]) => boolean)[],
  ): { value: unknown; count: number } => {
    if (Array.isArray(value)) {
      let count = 0;
      const out = value.map((item) => {
        const done = walk(item, path, hidden, rules);
        count += done.count;
        return done.value;
      });
      return { value: out, count };
    }
    if (value && typeof value === "object") {
      let count = 0;
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        const here = [...path, key];
        if (rules.some((m) => m(here))) {
          const seen = collect(item);
          seen.forEach((s) => hidden.add(s));
          count += 1;
          out[key] = replacement;
        } else {
          const done = walk(item, here, hidden, rules);
          count += done.count;
          out[key] = done.value;
        }
      }
      return { value: out, count };
    }
    return { value, count: 0 };
  };

  /** The text of everything under a hidden key, to hide it elsewhere in the same record too. */
  const collect = (value: unknown): string[] => {
    if (typeof value === "string") return value.length >= 3 ? [value] : [];
    if (typeof value === "number") return String(value).length >= 4 ? [String(value)] : [];
    if (Array.isArray(value)) return value.flatMap(collect);
    if (value && typeof value === "object") return Object.values(value).flatMap(collect);
    return [];
  };

  /** Hides what was hidden under a key wherever else the record says it, then the patterns. */
  const scrub = (text: string, hidden: string[]): { text: string; count: number } => {
    let count = 0;
    for (const secret of hidden) {
      const parts = text.split(secret);
      if (parts.length > 1) {
        count += parts.length - 1;
        text = parts.join(replacement);
      }
    }
    const done = applyPatterns(text);
    return { text: done.text, count: count + done.count };
  };

  const strings = (value: unknown, hidden: string[]): { value: unknown; count: number } => {
    if (typeof value === "string") {
      const done = scrub(value, hidden);
      return { value: done.text, count: done.count };
    }
    if (Array.isArray(value)) {
      let count = 0;
      return {
        value: value.map((item) => {
          const done = strings(item, hidden);
          count += done.count;
          return done.value;
        }),
        count,
      };
    }
    if (value && typeof value === "object") {
      let count = 0;
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        // A value already replaced is left alone: it would be counted twice.
        if (item === replacement) out[key] = item;
        else {
          const done = strings(item, hidden);
          count += done.count;
          out[key] = done.value;
        }
      }
      return { value: out, count };
    }
    return { value, count: 0 };
  };

  return {
    describe() {
      const fields = mask.fields.length ? `fields ${mask.fields.join(", ")}` : "";
      const patterns = mask.patterns.length
        ? `patterns ${mask.patterns.map((p) => (typeof p === "string" ? p : p.name)).join(", ")}`
        : "";
      const declared = [...addonMatchers.entries()]
        .filter(([, m]) => m.length)
        .map(([name]) => `${name}(${addons[name]!.personalFields.join(", ")})`);
      const fromAddons = declared.length ? `fields declared by addons ${declared.join(", ")}` : "";
      return `masking ${[fields, patterns, fromAddons].filter(Boolean).join("; ")} as ${replacement}`;
    },
    answer(text, tool = "") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { text, count: 0 };
      }
      const evidence = (parsed as { evidence?: unknown } | null)?.evidence;
      if (!Array.isArray(evidence)) return { text, count: 0 };
      let count = 0;
      // The personal fields an addon declares apply to the answers of that addon's own tools.
      const rules = [...matchers, ...(addonMatchers.get(tool.split(".")[0] ?? "") ?? [])];
      const masked = evidence.map((item: Record<string, unknown>) => {
        const hidden = new Set<string>();
        const data = walk(item.data, [], hidden, rules);
        const all = [...hidden].sort((a, b) => b.length - a.length);
        const rest = strings({ summary: item.summary, data: data.value }, all) as {
          value: { summary: unknown; data: unknown };
          count: number;
        };
        count += data.count + rest.count;
        return { ...item, summary: rest.value.summary, data: rest.value.data };
      });
      const out = { ...(parsed as object), evidence: masked, ...(count ? { masked: count } : {}) };
      return { text: JSON.stringify(out, null, 2), count };
    },
  };
}
