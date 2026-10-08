// The elasticsearch addon: search the documents (logs) of the indices you list,
// through the search API of Elasticsearch and OpenSearch.
//
// Read-only by construction: one fixed endpoint, POST /<index>/_search (a POST
// because that is how a search body is sent; it changes nothing), with a body
// built here from the query string and the time range. Only the indices of the
// `indices` setting can be searched (no `_all`, no other pattern), the query
// string cannot start with a wildcard, the number of documents and the size of
// the answer are capped, redirects are not followed, calls time out, and the
// authorization header is a secret setting that never appears in an error.
interface Settings {
  baseUrl: string;
  indices: string;
  authorization?: string;
  timeField: string;
  messageField: string;
}
interface Context {
  settings: Settings;
  fetch: typeof fetch;
}

const TIMEOUT_MS = 15_000;
const MAX_BYTES = 4_000_000;
const MAX_QUERY = 1000;
const MAX_DOCS = 100;
const MAX_SOURCE = 2000;
const UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

function instant(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const relative = /^now(?:-(\d+)([smhdw]))?$/.exec(value);
  if (relative) return Date.now() - (relative[1] ? Number(relative[1]) * UNITS[relative[2]!]! : 0);
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw new Error(`time "${value}" must be ISO 8601 or relative like now-15m`);
  return time;
}

const glob = (pattern: string) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);

/** The indices to search: those asked for, each inside the list the settings allow. */
function target(settings: Settings, asked: string | undefined): string {
  const allowed = settings.indices
    .split(",")
    .map((i) => i.trim())
    .filter(Boolean);
  if (!allowed.length) throw new Error("the indices setting lists no index");
  for (const name of allowed) {
    if (name === "*" || name === "_all" || !/^[a-z0-9][a-z0-9._*-]*$/i.test(name)) {
      throw new Error(
        `"${name}" in the indices setting is not an index or pattern to allow: name the indices (logs-shop-*, app-logs)`,
      );
    }
  }
  if (!asked) return allowed.join(",");
  const parts = asked.split(",").map((p) => p.trim());
  for (const part of parts) {
    if (!/^[a-z0-9][a-z0-9._*-]*$/i.test(part) || !allowed.some((a) => glob(a).test(part))) {
      throw new Error(`index ${part} is not in the list this addon may search (${allowed.join(", ")})`);
    }
  }
  return parts.join(",");
}

// The cluster's JSON, read field by field: its shape is documented, not typed here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

/** A document can be large: keep it whole if small, else its scalar top-level fields. */
function shrink(source: Json): Json {
  if (JSON.stringify(source).length <= MAX_SOURCE) return source;
  const kept: Json = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string") kept[key] = value.slice(0, 300);
    else if (typeof value === "number" || typeof value === "boolean") kept[key] = value;
  }
  return kept;
}

const field = (source: Json, path: string): unknown =>
  path in source
    ? source[path]
    : path.split(".").reduce<unknown>((value, key) => (value as Json | undefined)?.[key], source);

export async function search(
  params: { query: string; index?: string; from?: string; to?: string; limit: number; newest: boolean },
  context: Context,
) {
  const { settings, fetch } = context;
  if (!params.query.trim()) throw new Error("query must not be empty");
  if (params.query.length > MAX_QUERY) throw new Error(`query is longer than ${MAX_QUERY} characters`);
  const now = Date.now();
  const end = instant(params.to, now);
  const start = instant(params.from, end - UNITS.h!);
  if (start >= end) throw new Error("from must be before to");
  const indices = target(settings, params.index);
  const size = Math.min(Math.max(params.limit, 1), MAX_DOCS);
  const body = {
    size,
    track_total_hits: false,
    sort: [{ [settings.timeField]: { order: params.newest ? "desc" : "asc" } }],
    query: {
      bool: {
        filter: [
          { range: { [settings.timeField]: { gte: new Date(start).toISOString(), lte: new Date(end).toISOString() } } },
        ],
        must: [
          {
            query_string: {
              query: params.query,
              default_operator: "AND",
              allow_leading_wildcard: false,
              analyze_wildcard: false,
            },
          },
        ],
      },
    },
  };
  const headers: Record<string, string> = { accept: "application/json", "content-type": "application/json" };
  if (settings.authorization) headers.authorization = settings.authorization;
  const url = new URL(
    `${settings.baseUrl.replace(/\/$/, "")}/${encodeURIComponent(indices).replaceAll("%2C", ",").replaceAll("%2A", "*")}/_search`,
  );
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status >= 300 && response.status < 400)
    throw new Error(`the cluster redirected the search (${response.status}); check the URL`);
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `the cluster refused the credentials (${response.status}): check the authorization header and that it can read ${indices}`,
    );
  }
  const text = await response.text();
  if (response.status === 429)
    throw new Error("the cluster is rejecting searches (429): wait a moment and narrow the query");
  let answer: Json;
  try {
    answer = JSON.parse(text) as Json;
  } catch {
    throw new Error(
      `the cluster answered ${response.status} with something that is not JSON: is the URL the one of Elasticsearch or OpenSearch?`,
    );
  }
  if (answer.error) {
    const reason = answer.error.root_cause?.[0]?.reason ?? answer.error.reason ?? answer.error.type ?? "error";
    const kind = answer.error.type === "index_not_found_exception" ? "no such index: " : "could not run the search: ";
    throw new Error(`the cluster ${kind}${String(reason).slice(0, 300)}`);
  }
  if (!response.ok) throw new Error(`the cluster answered ${response.status}`);
  if (text.length > MAX_BYTES) throw new Error(`the answer is larger than ${MAX_BYTES} bytes; narrow the query`);
  return ((answer.hits?.hits ?? []) as Json[]).map((hit) => {
    const source = shrink((hit._source ?? {}) as Json);
    const level = String(field(source, "level") ?? field(source, "log.level") ?? field(source, "severity") ?? "");
    const service = String(field(source, "service.name") ?? field(source, "service") ?? field(source, "app") ?? "");
    const message = String(field(source, settings.messageField) ?? "");
    return {
      at: field(source, settings.timeField),
      index: hit._index,
      id: hit._id,
      level: level || undefined,
      service: service || undefined,
      message,
      source,
      summary: `${[level, service].filter(Boolean).join(" ")}${level || service ? ": " : ""}${message}`
        .replace(/\s+/g, " ")
        .trim(),
    };
  });
}
