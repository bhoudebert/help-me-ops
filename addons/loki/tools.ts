// The loki addon: search logs and list labels through Loki's HTTP API.
//
// Read-only by construction: three fixed GET endpoints, built here. A LogQL
// query cannot change anything; the query length, the number of lines and the
// size of the answer are capped, redirects are not followed, calls time out,
// and the authorization header is a secret setting that never appears in an error.
//
//   logs          GET /loki/api/v1/query_range
//   label names   GET /loki/api/v1/labels
//   label values  GET /loki/api/v1/label/<name>/values
interface Settings {
  baseUrl: string;
  authorization?: string;
  orgId?: string;
}
interface Context {
  settings: Settings;
  fetch: typeof fetch;
}

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 4_000_000;
const MAX_QUERY = 2000;
const MAX_LINES = 100;
const MAX_VALUES = 100;
const UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

function instant(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const relative = /^now(?:-(\d+)([smhdw]))?$/.exec(value);
  if (relative) return Date.now() - (relative[1] ? Number(relative[1]) * UNITS[relative[2]!]! : 0);
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw new Error(`time "${value}" must be ISO 8601 or relative like now-15m`);
  return time;
}

type Json = Record<string, unknown>;

async function get(context: Context, path: string, query: Record<string, string> = {}): Promise<Json> {
  const { settings, fetch } = context;
  const url = new URL(`${settings.baseUrl.replace(/\/$/, "")}${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const headers: Record<string, string> = { accept: "application/json" };
  if (settings.authorization) headers.authorization = settings.authorization;
  if (settings.orgId) headers["x-scope-orgid"] = settings.orgId;
  const response = await fetch(url, {
    method: "GET",
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status >= 300 && response.status < 400)
    throw new Error(`Loki redirected ${path} (${response.status}); check the URL`);
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `Loki refused the credentials (${response.status}) on ${path}: check the authorization header, and the tenant (orgId)`,
    );
  }
  const text = await response.text();
  if (response.status === 429) throw new Error("Loki rate limit reached (429): wait a moment and narrow the query");
  // A bad LogQL query is a 400 whose body is plain text: say what Loki said.
  if (response.status === 400) throw new Error(`Loki could not run the query: ${text.trim().slice(0, 300)}`);
  if (response.status === 404)
    throw new Error(`Loki answered 404 on ${path}: is the URL the one of Loki, and the tenant right?`);
  if (!response.ok) throw new Error(`Loki answered ${response.status} on ${path}: ${text.slice(0, 200)}`);
  if (text.length > MAX_BYTES)
    throw new Error(`Loki's answer on ${path} is larger than ${MAX_BYTES} bytes; narrow the query`);
  try {
    return JSON.parse(text) as Json;
  } catch {
    throw new Error(`Loki answered ${path} with something that is not JSON: is the URL the one of Loki?`);
  }
}

interface Stream {
  stream?: Record<string, string>;
  values?: [string, string][];
}

export async function searchLogs(
  params: { query: string; from?: string; to?: string; limit: number; newest: boolean },
  context: Context,
) {
  if (!params.query.trim()) throw new Error("query must not be empty");
  if (params.query.length > MAX_QUERY) throw new Error(`query is longer than ${MAX_QUERY} characters`);
  const now = Date.now();
  const end = instant(params.to, now);
  const start = instant(params.from, end - UNITS.h!);
  if (start >= end) throw new Error("from must be before to");
  const limit = Math.min(Math.max(params.limit, 1), MAX_LINES);
  const body = await get(context, "/loki/api/v1/query_range", {
    query: params.query,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    limit: String(limit),
    direction: params.newest ? "backward" : "forward",
  });
  const streams = ((body.data as { result?: Stream[] } | undefined)?.result ?? []) as Stream[];
  const lines = streams.flatMap((s) =>
    (s.values ?? []).map(([ns, line]) => ({ ms: Number(BigInt(ns) / 1_000_000n), line, labels: s.stream ?? {} })),
  );
  lines.sort((a, b) => (params.newest ? b.ms - a.ms : a.ms - b.ms));
  return lines.slice(0, limit).map(({ ms, line, labels }) => {
    const where = labels.service ?? labels.app ?? labels.job ?? labels.container ?? "";
    const level = labels.level ?? labels.detected_level ?? "";
    return {
      at: new Date(ms).toISOString(),
      level,
      service: where,
      labels,
      line,
      summary: `${[level, where].filter(Boolean).join(" ")}${level || where ? ": " : ""}${line}`
        .replace(/\s+/g, " ")
        .trim(),
    };
  });
}

export async function labels(params: { name?: string; from?: string; to?: string }, context: Context) {
  if (params.name !== undefined && !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(params.name)) {
    throw new Error(`label "${params.name}" is not a label name: letters, digits and underscores`);
  }
  const now = Date.now();
  const end = instant(params.to, now);
  const start = instant(params.from, end - UNITS.h!);
  const window = { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
  const path = params.name ? `/loki/api/v1/label/${params.name}/values` : "/loki/api/v1/labels";
  const body = await get(context, path, window);
  const values = ((body.data as string[] | undefined) ?? []).slice(0, MAX_VALUES);
  return [
    {
      name: params.name ?? null,
      values,
      summary: params.name
        ? `values of label ${params.name}: ${values.join(", ") || "none"}`
        : `labels: ${values.join(", ") || "none"}`,
    },
  ];
}
