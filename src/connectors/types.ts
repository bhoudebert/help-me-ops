// The contract every source of evidence follows. A connector answers questions
// about a running system; it never changes it (ADR 0002).

/** What a source holds: it tells the model which questions a connector can answer. */
export type SourceKind = "logs" | "metrics" | "database" | "http" | "custom";

/** One piece of evidence: what was found, where, and when it happened. */
export interface Evidence {
  /** The connector it came from. */
  source: string;
  /** When it happened, ISO 8601, if the source knows. */
  at: string | null;
  /** One line a person can read. */
  summary: string;
  /** The raw record (a log line, a row, a data point), kept for the case file. */
  data: unknown;
}

/** A search over one source: free text, an optional time window, a cap. */
export interface SearchInput {
  /** What to look for: an order number, an error code, a user id. */
  query: string;
  /** Start of the window, ISO 8601 (inclusive). */
  from?: string;
  /** End of the window, ISO 8601 (inclusive). */
  to?: string;
  /** At most this many pieces of evidence (default 50). */
  limit?: number;
}

/** A source of evidence. Read-only by contract: search must not change the system. */
export interface Connector {
  id: string;
  kind: SourceKind;
  /** What it covers, in a sentence the model reads to choose sources. */
  description: string;
  search(input: SearchInput): Promise<Evidence[]>;
}

/** What a connector module exports, for sources written by the people who run the system. */
export type ConnectorFactory = (options: { id: string; description: string } & Record<string, unknown>) => Connector;

export const DEFAULT_LIMIT = 50;
