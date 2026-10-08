// Which sources can return personal data, as the people who run them declare it,
// and the strict mode that serves only the ones declared free of it (ADR 0012).
import { z } from "zod";

/** What a person can say about a source or an addon: it holds no personal data, or it may. */
export const Declaration = z.enum(["none", "possible"]);
export type Declaration = z.infer<typeof Declaration>;

/** The written knowledge (runbooks, notes) is declared under this key. */
export const KNOWLEDGE = "knowledge";

export interface DataConfig {
  /** Serve only what is declared free of personal data. */
  strict: boolean;
  /** By source id, by addon name, or `knowledge`; wins over what an addon declares for itself. */
  data: Record<string, Declaration>;
}

export interface DataPolicy {
  strict: boolean;
  declared(key: string): Declaration | "unknown";
  /** True when the key may be served: always outside strict mode, only `none` inside it. */
  allowed(key: string): boolean;
  /** Throws, saying how to declare it, when strict mode does not serve the key. */
  require(key: string): void;
  /** The line for `doctor`. */
  describe(): string;
}

/**
 * `addonDefaults`: what each addon declares for itself. `known`: the source ids
 * and addon names of the workspace, so a declaration for something that does
 * not exist is refused when the workspace opens, not silently ignored.
 */
export function createDataPolicy(
  config: DataConfig | undefined,
  addonDefaults: Record<string, Declaration>,
  known: string[],
): DataPolicy {
  const own = config?.data ?? {};
  const keys = [...new Set([...known, KNOWLEDGE])];
  for (const key of Object.keys(own)) {
    if (!keys.includes(key)) {
      throw new Error(
        `privacy.data: "${key}" is not a source, an addon or "${KNOWLEDGE}" of this workspace (known: ${keys.join(", ")})`,
      );
    }
  }
  const strict = config?.strict ?? false;
  const declared = (key: string): Declaration | "unknown" => own[key] ?? addonDefaults[key] ?? "unknown";
  return {
    strict,
    declared,
    allowed: (key) => !strict || declared(key) === "none",
    require(key) {
      const state = declared(key);
      if (!strict || state === "none") return;
      throw new Error(
        `Strict mode: "${key}" is not declared free of personal data (${state === "unknown" ? "undeclared" : "declared: possible"}). If it holds none, say so in ops.config.json: "privacy": { "data": { "${key}": "none" } }.`,
      );
    },
    describe() {
      const by = (state: string) => keys.filter((k) => declared(k) === state);
      const list = (state: string) => by(state).join(", ") || "-";
      return strict
        ? `strict, serves only what is declared free of personal data: ${list("none")}; withheld: possible ${list("possible")}, undeclared ${list("unknown")}`
        : `not strict; free of personal data: ${list("none")}; may hold some: ${list("possible")}; undeclared: ${list("unknown")}`;
    },
  };
}
