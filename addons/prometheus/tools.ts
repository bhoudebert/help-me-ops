// The prometheus addon: read metrics and alerts from Prometheus' HTTP API.
//
// Read-only by construction: three fixed GET endpoints, built here. A PromQL
// query cannot change anything, the query length and the number of points are
// capped, redirects are not followed, calls time out, and the authorization
// header is a secret setting that never appears in an error.
//
//   metrics over a range  GET /api/v1/query_range
//   metrics at an instant GET /api/v1/query
//   alerts                GET /api/v1/alerts
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
const MAX_POINTS = 50;
/** Prometheus refuses a range query that would return more than 11,000 points per series. */
const MAX_STEPS = 11_000;
const UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/** ISO 8601, or `now`, or `now-15m` (s, m, h, d), as epoch milliseconds. */
function instant(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const relative = /^now(?:-(\d+)([smhdw]))?$/.exec(value);
  if (relative) return Date.now() - (relative[1] ? Number(relative[1]) * UNITS[relative[2]!]! : 0);
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw new Error(`time "${value}" must be ISO 8601 or relative like now-15m`);
  return time;
}

/** A step like 30s, 5m, 1h, as seconds. */
function seconds(step: string): number {
  const match = /^(\d+)([smhdw])$/.exec(step);
  if (!match) throw new Error(`step "${step}" must be a number and a unit: 30s, 1m, 5m, 1h`);
  return (Number(match[1]) * UNITS[match[2]!]!) / 1000;
}

function checked(query: string): string {
  if (!query.trim()) throw new Error("query must not be empty");
  if (query.length > MAX_QUERY) throw new Error(`query is longer than ${MAX_QUERY} characters`);
  return query;
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
    throw new Error(`Prometheus redirected ${path} (${response.status}); check the URL`);
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `Prometheus refused the credentials (${response.status}) on ${path}: check the authorization header, and the tenant if there is one`,
    );
  }
  const text = await response.text();
  if (text.length > MAX_BYTES)
    throw new Error(`Prometheus' answer on ${path} is larger than ${MAX_BYTES} bytes; narrow the query`);
  let body: Json;
  try {
    body = JSON.parse(text) as Json;
  } catch {
    throw new Error(
      `Prometheus answered ${response.status} on ${path} with something that is not JSON: is the URL the one of Prometheus?`,
    );
  }
  // A bad query is a 400 or 422 with the reason in the body: say it.
  if (body.status === "error")
    throw new Error(
      `Prometheus could not run the query: ${String(body.errorType ?? "error")}: ${String(body.error ?? "")}`.trim(),
    );
  if (response.status === 429)
    throw new Error("Prometheus rate limit reached (429): wait a moment and narrow the query");
  if (response.status === 503)
    throw new Error("Prometheus is overloaded or the query timed out (503): narrow the range or the query");
  if (!response.ok) throw new Error(`Prometheus answered ${response.status} on ${path}`);
  return body;
}

interface Sample {
  metric?: Record<string, string>;
  values?: [number, string][];
  value?: [number, string];
}

const label = (metric: Record<string, string> = {}) => {
  const { __name__: name = "", ...labels } = metric;
  const pairs = Object.entries(labels).map(([k, v]) => `${k}="${v}"`);
  return `${name}${pairs.length ? `{${pairs.join(",")}}` : ""}` || "(expression)";
};

const point = (series: string, time: number, value: string, metric?: Record<string, string>) => ({
  at: new Date(time * 1000).toISOString(),
  series,
  value: Number(value),
  labels: metric,
  summary: `${series} = ${value}`,
});

export async function queryRange(
  params: { query: string; from?: string; to?: string; step?: string },
  context: Context,
) {
  const now = Date.now();
  const end = instant(params.to, now);
  const start = instant(params.from, end - UNITS.h!);
  if (start >= end) throw new Error("from must be before to");
  const step = params.step ? seconds(params.step) : Math.max(15, Math.ceil((end - start) / 1000 / 120));
  if ((end - start) / 1000 / step > MAX_STEPS)
    throw new Error(`that is more than ${MAX_STEPS} points: use a bigger step or a shorter range`);
  const body = await get(context, "/api/v1/query_range", {
    query: checked(params.query),
    start: String(start / 1000),
    end: String(end / 1000),
    step: String(step),
  });
  const result = ((body.data as { result?: Sample[] } | undefined)?.result ?? []) as Sample[];
  return result.flatMap((series) => {
    const values = (series.values ?? []).filter(([, v]) => v !== "NaN");
    const every = Math.ceil(values.length / MAX_POINTS) || 1;
    const name = label(series.metric);
    return values
      .filter((_, i) => i % every === 0 || i === values.length - 1)
      .map(([t, v]) => point(name, t, v, series.metric));
  });
}

export async function query(params: { query: string; at?: string }, context: Context) {
  const body = await get(context, "/api/v1/query", {
    query: checked(params.query),
    time: String(instant(params.at, Date.now()) / 1000),
  });
  const data = body.data as { resultType?: string; result?: Sample[] | [number, string] } | undefined;
  if (data?.resultType === "scalar" || data?.resultType === "string") {
    const [t, v] = data.result as [number, string];
    return [point("(scalar)", t, v)];
  }
  return ((data?.result ?? []) as Sample[]).flatMap((s) =>
    s.value ? [point(label(s.metric), s.value[0], s.value[1], s.metric)] : [],
  );
}

interface Alert {
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  state?: string;
  activeAt?: string;
  value?: string;
}

export async function alerts(params: { state?: string }, context: Context) {
  const body = await get(context, "/api/v1/alerts");
  const list = ((body.data as { alerts?: Alert[] } | undefined)?.alerts ?? []) as Alert[];
  return list
    .filter((a) => !params.state || a.state === params.state)
    .map((a) => ({
      at: a.activeAt,
      name: a.labels?.alertname,
      state: a.state,
      severity: a.labels?.severity,
      labels: a.labels,
      annotations: a.annotations,
      value: a.value,
      summary: `alert ${a.labels?.alertname ?? "?"}${a.labels?.severity ? ` (${a.labels.severity})` : ""} ${a.state ?? ""}${a.annotations?.summary ? `: ${a.annotations.summary}` : ""}`,
    }));
}
