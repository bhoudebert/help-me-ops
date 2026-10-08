// The datadog addon: read logs, metrics and monitors from Datadog's HTTP API.
//
// Read-only by construction: three fixed endpoints, built here, nothing taken
// from the question but the query and the time range. The logs search is a POST
// because that is how Datadog takes a search body; it changes nothing. Redirects
// are not followed, answers are capped, calls time out, and the two keys are
// secret settings that never appear in an error.
//
//   logs     POST /api/v2/logs/events/search
//   metrics  GET  /api/v1/query
//   monitors GET  /api/v1/monitor
interface Settings {
  apiKey: string;
  appKey: string;
  site: string;
  baseUrl?: string;
}
interface Context {
  settings: Settings;
  fetch: typeof fetch;
}

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2_000_000;
const MAX_LOGS = 100;
const MAX_POINTS = 50;
const UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

function origin({ site, baseUrl }: Settings): string {
  if (baseUrl) return baseUrl.replace(/\/$/, "");
  if (!/^[a-z0-9]+(\.[a-z0-9-]+)+$/i.test(site))
    throw new Error(`site "${site}" is not a Datadog site (datadoghq.com, datadoghq.eu ...)`);
  return `https://api.${site}`;
}

/** ISO 8601, or `now`, or `now-15m` (s, m, h, d), as epoch milliseconds. */
function instant(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const relative = /^now(?:-(\d+)([smhd]))?$/.exec(value);
  if (relative) return Date.now() - (relative[1] ? Number(relative[1]) * UNITS[relative[2]!]! : 0);
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw new Error(`time "${value}" must be ISO 8601 or relative like now-15m`);
  return time;
}

async function call(
  { settings, fetch }: Context,
  method: "GET" | "POST",
  path: string,
  options: { query?: Record<string, string>; body?: unknown } = {},
): Promise<Record<string, unknown>> {
  const url = new URL(`${origin(settings)}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
  const headers: Record<string, string> = {
    accept: "application/json",
    "DD-API-KEY": settings.apiKey,
    "DD-APPLICATION-KEY": settings.appKey,
  };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(url, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status >= 300 && response.status < 400)
    throw new Error(`Datadog redirected ${path} (${response.status}); check the site or baseUrl`);
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      `Datadog refused the keys (${response.status}) on ${path}: check the API key, the application key and its read scopes, and the site (${settings.site})`,
    );
  }
  if (response.status === 429) throw new Error("Datadog rate limit reached (429): wait a moment and narrow the query");
  const text = await response.text();
  if (!response.ok) throw new Error(`Datadog answered ${response.status} on ${path}: ${text.slice(0, 300)}`);
  if (text.length > MAX_BYTES)
    throw new Error(`Datadog's answer on ${path} is larger than ${MAX_BYTES} bytes; narrow the query`);
  return JSON.parse(text) as Record<string, unknown>;
}

interface LogEvent {
  id?: string;
  attributes?: {
    timestamp?: string;
    status?: string;
    service?: string;
    host?: string;
    message?: string;
    tags?: string[];
    attributes?: Record<string, unknown>;
  };
}

export async function searchLogs(
  params: { query: string; from?: string; to?: string; limit: number; newest: boolean },
  context: Context,
) {
  const now = Date.now();
  const body = {
    filter: {
      query: params.query,
      from: new Date(instant(params.from, now - UNITS.h!)).toISOString(),
      to: new Date(instant(params.to, now)).toISOString(),
    },
    sort: params.newest ? "-timestamp" : "timestamp",
    page: { limit: Math.min(Math.max(params.limit, 1), MAX_LOGS) },
  };
  const answer = await call(context, "POST", "/api/v2/logs/events/search", { body });
  return ((answer.data as LogEvent[] | undefined) ?? []).map((event) => {
    const a = event.attributes ?? {};
    return {
      at: a.timestamp,
      status: a.status,
      service: a.service,
      host: a.host,
      message: a.message,
      attributes: a.attributes,
      id: event.id,
      summary: `${a.status ?? "log"} ${a.service ?? ""}: ${a.message ?? ""}`.replace(/\s+/g, " ").trim(),
    };
  });
}

interface Series {
  metric?: string;
  display_name?: string;
  scope?: string;
  pointlist?: [number, number | null][];
}

export async function queryMetric(params: { query: string; from?: string; to?: string }, context: Context) {
  const now = Date.now();
  const answer = await call(context, "GET", "/api/v1/query", {
    query: {
      query: params.query,
      from: String(Math.floor(instant(params.from, now - UNITS.h!) / 1000)),
      to: String(Math.floor(instant(params.to, now) / 1000)),
    },
  });
  if (answer.status !== undefined && answer.status !== "ok")
    throw new Error(`Datadog could not run the query: ${String(answer.error ?? answer.message ?? answer.status)}`);
  return ((answer.series as Series[] | undefined) ?? []).flatMap((series) => {
    const points = (series.pointlist ?? []).filter((p): p is [number, number] => p[1] !== null);
    const step = Math.ceil(points.length / MAX_POINTS) || 1;
    const name = series.display_name ?? series.metric ?? params.query;
    return points
      .filter((_, index) => index % step === 0 || index === points.length - 1)
      .map(([time, value]) => ({
        at: new Date(time).toISOString(),
        metric: name,
        scope: series.scope,
        value,
        summary: `${name}{${series.scope ?? "*"}} = ${value}`,
      }));
  });
}

interface Monitor {
  id?: number;
  name?: string;
  type?: string;
  query?: string;
  tags?: string[];
  overall_state?: string;
  overall_state_modified?: string;
}

export async function monitors(params: { name?: string; tag?: string }, context: Context) {
  const query: Record<string, string> = {};
  if (params.name) query.name = params.name;
  if (params.tag) query.monitor_tags = params.tag;
  const answer = (await call(context, "GET", "/api/v1/monitor", { query })) as unknown as Monitor[];
  return (Array.isArray(answer) ? answer : []).map((m) => ({
    at: m.overall_state_modified,
    id: m.id,
    name: m.name,
    type: m.type,
    state: m.overall_state,
    query: m.query,
    tags: m.tags,
    summary: `monitor "${m.name ?? m.id}": ${m.overall_state ?? "unknown"}`,
  }));
}
