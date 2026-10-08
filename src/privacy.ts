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

export const MaskConfig = z
  .object({
    /** Keys whose values are hidden, at any depth: `email`, `*phone*`, `customer.name`. Case ignored. */
    fields: z.array(z.string().min(1)).default([]),
    /** Patterns hidden wherever they appear in a text: the named detectors, or your own regex. */
    patterns: z
      .array(
        z.union([
          z.enum(names),
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
  })
  .default({ fields: [], patterns: [], replacement: "***" });
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
  /** Masks the evidence of a tool's answer; an answer without evidence is returned as it is. */
  answer(text: string): Masked;
}

const keyMatcher = (pattern: string) => {
  const parts = pattern.toLowerCase().split(".");
  const wild = (part: string) => new RegExp(`^${part.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
  const tests = parts.map(wild);
  return (path: string[]) => {
    if (path.length < tests.length) return false;
    const tail = path.slice(-tests.length).map((p) => p.toLowerCase());
    return tests.every((test, i) => test.test(tail[i]!));
  };
};

/** A masker for the configuration, or null when nothing is to be hidden. */
export function createMasker(config: PrivacyConfig | undefined): Masker | null {
  const mask = config?.mask;
  if (!mask || (!mask.fields.length && !mask.patterns.length)) return null;
  const { replacement } = mask;
  const matchers = mask.fields.map(keyMatcher);
  const detectors: Detector[] = mask.patterns.map((p) =>
    typeof p === "string" ? DETECTORS[p] : byRegex(p.name, new RegExp(p.regex, "g")),
  );

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
  const walk = (value: unknown, path: string[], hidden: Set<string>): { value: unknown; count: number } => {
    if (Array.isArray(value)) {
      let count = 0;
      const out = value.map((item) => {
        const done = walk(item, path, hidden);
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
        if (matchers.some((m) => m(here))) {
          const seen = collect(item);
          seen.forEach((s) => hidden.add(s));
          count += 1;
          out[key] = replacement;
        } else {
          const done = walk(item, here, hidden);
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
      return `masking ${[fields, patterns].filter(Boolean).join("; ")} as ${replacement}`;
    },
    answer(text) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return { text, count: 0 };
      }
      const evidence = (parsed as { evidence?: unknown } | null)?.evidence;
      if (!Array.isArray(evidence)) return { text, count: 0 };
      let count = 0;
      const masked = evidence.map((item: Record<string, unknown>) => {
        const hidden = new Set<string>();
        const data = walk(item.data, [], hidden);
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
