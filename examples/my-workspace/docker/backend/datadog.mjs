// A mock of three Datadog HTTP APIs for the demo (not Datadog, and no Datadog
// code or data): their documented request and response shapes,
// answered from the recorded logs and metrics of one environment of the workspace.
//
//   POST /api/v2/logs/events/search   Logs Search (v2)
//   GET  /api/v1/query                Metrics query (v1)
//   GET  /api/v1/monitor              List monitors (v1)
//
// It follows Datadog's request and response shapes, and the way it
// authenticates (DD-API-KEY and DD-APPLICATION-KEY headers, 403 when wrong), so
// the datadog addon runs against it unchanged. It is NOT Datadog: only a subset
// of the query syntax is understood (see parseQuery), and its clock stands still
// at NOW, the demo's "now", so relative times like now-15m work on the old data.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const DD_API_KEY = "demo-api-key";
export const DD_APP_KEY = "demo-app-key";
/** The demo's "now": relative times (now-15m) are counted from here. */
export const NOW = Date.parse("2026-10-07T10:30:00Z");

const UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** Datadog accepts ISO 8601, epoch milliseconds, and `now-15m`. */
function when(value) {
  if (typeof value === "number") return value;
  if (/^\d{10,}$/.test(String(value))) return Number(value);
  const relative = /^now(?:-(\d+)([smhd]))?$/.exec(String(value));
  if (relative) return NOW - (relative[1] ? Number(relative[1]) * UNITS[relative[2]] : 0);
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw new Error(`cannot parse the time "${value}"`);
  return time;
}

const LINE = /^(\S+Z)\s+(INFO|WARN|ERROR|DEBUG)\s+(\S+)\s+(.*)$/;

/** The logs of the environment as Datadog log events: status, service, message, and key=value pairs as attributes. */
function logEvents(workspace, env) {
  const lines = readFileSync(join(workspace, "logs", `${env}.log`), "utf8").split("\n");
  return lines.flatMap((line, index) => {
    const m = LINE.exec(line);
    if (!m) return [];
    const [, timestamp, level, service, message] = m;
    const attributes = Object.fromEntries([...message.matchAll(/\b(\w+)=([\w./-]+)/g)].map((p) => [p[1], p[2]]));
    return [
      {
        id: `AQAAA-${env}-${String(index).padStart(4, "0")}`,
        type: "log",
        attributes: {
          timestamp,
          status: level.toLowerCase(),
          service,
          host: `shop-${env}-1`,
          message,
          tags: [`env:${env}`, `service:${service}`],
          attributes,
        },
        _ms: Date.parse(timestamp),
      },
    ];
  });
}

/**
 * The part of Datadog's log query syntax the fake understands: terms separated
 * by spaces, all of which must match (implicit AND): `service:payments`,
 * `status:error`, `host:x`, `env:prod`, `@order:4512` (an attribute), a bare
 * word (in the message), `-term` (not), and `*` (everything). OR, parentheses
 * and wildcards inside a term are refused, so a query is never silently wrong.
 */
export function parseQuery(query) {
  const terms = [...String(query ?? "").matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
  for (const term of terms) {
    if (/^(OR|AND|NOT)$/.test(term) || /[()]/.test(term) || /[?*]/.test(term.replace(/^\*$/, ""))) {
      throw new Error(
        `the demo's fake Datadog does not understand "${term}": use service:, status:, host:, env:, @attribute:value, words, -term`,
      );
    }
  }
  return (event) =>
    terms.every((raw) => {
      const negate = raw.startsWith("-");
      const term = negate ? raw.slice(1) : raw;
      const a = event.attributes;
      let hit;
      if (term === "*") hit = true;
      else if (/^@[\w.]+:/.test(term)) {
        const [, key, value] = /^@([\w.]+):(.*)$/.exec(term);
        hit = String(a.attributes[key]) === value;
      } else if (/^(service|status|host):/.test(term)) {
        const [, key, value] = /^(\w+):(.*)$/.exec(term);
        hit = String(a[key]) === value;
      } else if (/^env:/.test(term)) hit = a.tags.includes(term);
      else hit = a.message.toLowerCase().includes(term.toLowerCase());
      return negate ? !hit : hit;
    });
}

function searchLogs(workspace, env, body) {
  const filter = body?.filter ?? {};
  const [from, to] = [when(filter.from ?? "now-15m"), when(filter.to ?? "now")];
  const match = parseQuery(filter.query);
  const sort = body?.sort === "-timestamp" ? -1 : 1;
  const limit = Math.min(Number(body?.page?.limit ?? 10), 1000);
  const offset = Number(body?.page?.cursor ?? 0);
  const all = logEvents(workspace, env)
    .filter((e) => e._ms >= from && e._ms <= to && match(e))
    .sort((a, b) => sort * (a._ms - b._ms));
  const page = all.slice(offset, offset + limit).map(({ _ms, ...event }) => event);
  const next = offset + limit < all.length ? String(offset + limit) : undefined;
  return {
    data: page,
    links: next ? { next: `/api/v2/logs/events?page[cursor]=${next}` } : {},
    meta: { elapsed: 3, page: next ? { after: next } : {}, request_id: `fake-${env}`, status: "done", warnings: [] },
  };
}

function queryMetric(workspace, env, params) {
  const query = params.get("query") ?? "";
  const m = /^(\w+):([\w.]+)\{([^}]*)\}/.exec(query);
  if (!m) throw new Error(`cannot parse the metric query "${query}": use aggregation:metric{scope}`);
  const [from, to] = [Number(params.get("from")) * 1000, Number(params.get("to")) * 1000];
  const known = JSON.parse(readFileSync(join(workspace, "data", env, "metrics.json"), "utf8")).series;
  const found = known[m[2]];
  const pointlist = (found?.points ?? [])
    .map(([at, value]) => [Date.parse(at), value])
    .filter(([ms]) => ms >= from && ms <= to);
  const series = found
    ? [
        {
          metric: m[2],
          display_name: m[2],
          aggr: m[1],
          scope: m[3] || "*",
          expression: query,
          query_index: 0,
          interval: 60,
          length: pointlist.length,
          start: pointlist[0]?.[0] ?? from,
          end: pointlist.at(-1)?.[0] ?? to,
          pointlist,
          tag_set: [],
          unit: [
            { family: "custom", name: found.unit, plural: found.unit, scale_factor: 1, short_name: found.unit },
            null,
          ],
        },
      ]
    : [];
  return {
    status: "ok",
    res_type: "time_series",
    series,
    from_date: from,
    to_date: to,
    query,
    message: "",
    group_by: [],
  };
}

function monitors(env) {
  const alerting = env === "prod";
  const monitor = (id, name, query, state, modified) => ({
    id,
    name,
    type: "metric alert",
    query,
    message: `${name} @pagerduty-shop`,
    tags: [`env:${env}`, "team:shop"],
    overall_state: state,
    overall_state_modified: modified,
    created: "2026-09-01T08:00:00Z",
    modified,
    multi: false,
    options: { notify_no_data: false },
  });
  return [
    monitor(
      1001,
      "Payment confirm queue is backing up",
      `avg(last_5m):avg:payment_confirm_queue_depth{env:${env}} > 1000`,
      alerting ? "Alert" : "OK",
      alerting ? "2026-10-07T10:00:00Z" : "2026-10-06T08:00:00Z",
    ),
    monitor(
      1002,
      "shop-worker memory near its limit",
      `avg(last_5m):avg:worker_memory_mb{env:${env}} > 480`,
      alerting ? "Alert" : "OK",
      alerting ? "2026-10-07T09:55:00Z" : "2026-10-06T08:00:00Z",
    ),
    monitor(
      1003,
      "Checkout error rate",
      `sum(last_10m):sum:checkout.errors{env:${env}}.as_count() > 50`,
      "OK",
      "2026-10-06T08:00:00Z",
    ),
  ];
}

/** Handles a /api/... request of one environment; resolves true when it answered. */
export async function datadogApi(workspace, env, request, response, url) {
  const send = (status, body) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  const route = `${request.method} ${url.pathname}`;
  const routes = ["POST /api/v2/logs/events/search", "GET /api/v1/query", "GET /api/v1/monitor"];
  if (!url.pathname.startsWith("/api/")) return false;
  if (request.headers["dd-api-key"] !== DD_API_KEY || request.headers["dd-application-key"] !== DD_APP_KEY) {
    send(403, { errors: ["Forbidden"] });
    return true;
  }
  if (!routes.includes(route)) {
    send(routes.some((r) => r.endsWith(` ${url.pathname}`)) ? 405 : 404, {
      errors: [`the demo's fake Datadog only has: ${routes.join(", ")}`],
    });
    return true;
  }
  try {
    if (route === routes[0]) {
      let text = "";
      for await (const chunk of request) text += chunk;
      send(200, searchLogs(workspace, env, JSON.parse(text || "{}")));
    } else if (route === routes[1]) send(200, queryMetric(workspace, env, url.searchParams));
    else {
      const name = url.searchParams.get("name")?.toLowerCase();
      const tags = url.searchParams.get("monitor_tags");
      send(
        200,
        monitors(env).filter((m) => (!name || m.name.toLowerCase().includes(name)) && (!tags || m.tags.includes(tags))),
      );
    }
  } catch (error) {
    send(400, { errors: [error instanceof Error ? error.message : String(error)] });
  }
  return true;
}
