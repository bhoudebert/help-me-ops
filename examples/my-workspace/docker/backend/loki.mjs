// A mock of three Loki HTTP API endpoints for the demo (not Loki, and no Loki code
// or data): their documented request and response shapes, answered from the
// recorded logs of one environment, as streams labelled by service and level.
//
//   GET /loki/api/v1/query_range         a LogQL query over a range
//   GET /loki/api/v1/labels              the label names
//   GET /loki/api/v1/label/<name>/values the values of a label
//
// It understands a stream selector ({service="payments", level="error"}) and the
// line filters |= "text" and != "text", and refuses the rest of LogQL the way Loki
// refuses a bad query: 400 with a plain text reason. A Bearer token and X-Scope-OrgID.
import { logEvents } from "./datadog.mjs";

export const LOKI_AUTH = "Bearer demo-loki-token";
export const LOKI_ORG = "shop";

const UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const NOW = Date.parse("2026-10-07T10:30:00Z");

/** Loki takes RFC 3339, unix seconds, or nanoseconds. */
function time(value, fallback) {
  if (!value) return fallback;
  if (/^\d{16,}$/.test(value)) return Number(BigInt(value) / 1_000_000n);
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value) * 1000;
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw new Error(`invalid start or end: ${value}`);
  return t;
}

/** A stream selector, then |= "text" and != "text" filters. Read by hand, one step at a time: no pattern to backtrack on. */
export function parseLogQL(query) {
  const syntax = (what) =>
    new Error(
      `parse error: the demo's mock of Loki only understands a stream selector {label="value"} with |= "text" or != "text" filters (${what}), not: ${query}`,
    );
  const text = String(query).trim();
  const close = text.indexOf("}");
  if (!text.startsWith("{") || close < 0) throw syntax("no stream selector");
  const matchers = text
    .slice(1, close)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const l = /^(\w+)\s*(=|!=)\s*"([^"]*)"$/.exec(x);
      if (!l)
        throw new Error(
          `parse error: the demo's mock of Loki only understands label="value" and label!="value", not: ${x}`,
        );
      return { key: l[1], negate: l[2] === "!=", value: l[3] };
    });
  if (!matchers.length)
    throw new Error(
      "queries require at least one regexp or equality matcher that does not have an empty-compatible value",
    );
  const filters = [];
  let rest = text.slice(close + 1).trimStart();
  while (rest) {
    const operator = rest.slice(0, 2);
    if (operator !== "|=" && operator !== "!=") throw syntax("a filter");
    rest = rest.slice(2).trimStart();
    const end = rest.startsWith('"') ? rest.indexOf('"', 1) : -1;
    if (end < 0) throw syntax("a filter text in quotes");
    filters.push({ negate: operator === "!=", text: rest.slice(1, end) });
    rest = rest.slice(end + 1).trimStart();
  }
  return { matchers, filters };
}

const labelsOf = (event, env) => ({
  app: "shop",
  env,
  service: event.attributes.service,
  level: event.attributes.status,
  detected_level: event.attributes.status,
});

/** Handles a /loki/... request of one environment; returns true when it answered. */
export function lokiApi(workspace, env, request, response, url) {
  if (!url.pathname.startsWith("/loki/")) return false;
  const send = (status, body) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  const text = (status, body) => {
    response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
    response.end(body);
  };
  if (request.headers.authorization !== LOKI_AUTH || request.headers["x-scope-orgid"] !== LOKI_ORG) {
    text(401, "no org id or the credentials are wrong");
    return true;
  }
  if (request.method !== "GET") {
    text(405, "the demo's mock of Loki is read-only: only GET");
    return true;
  }
  const q = url.searchParams;
  try {
    const events = logEvents(workspace, env).map((e) => ({ ...e, labels: labelsOf(e, env) }));
    if (url.pathname === "/loki/api/v1/query_range") {
      const { matchers, filters } = parseLogQL(q.get("query") ?? "");
      const end = time(q.get("end"), NOW);
      const start = time(q.get("start"), end - UNITS.h);
      const limit = Math.min(Number(q.get("limit") ?? 100), 5000);
      const backward = q.get("direction") === "backward";
      const selected = events
        .filter((e) => e._ms >= start && e._ms <= end)
        .filter((e) => matchers.every((m) => (e.labels[m.key] === m.value) !== m.negate))
        .filter((e) => filters.every((f) => e.attributes.message.includes(f.text) !== f.negate))
        .sort((a, b) => (backward ? b._ms - a._ms : a._ms - b._ms))
        .slice(0, limit);
      const streams = new Map();
      for (const e of selected) {
        const key = JSON.stringify(e.labels);
        if (!streams.has(key)) streams.set(key, { stream: e.labels, values: [] });
        streams.get(key).values.push([String(BigInt(e._ms) * 1_000_000n), e.attributes.message]);
      }
      send(200, { status: "success", data: { resultType: "streams", result: [...streams.values()], stats: {} } });
    } else if (url.pathname === "/loki/api/v1/labels") {
      send(200, { status: "success", data: ["app", "detected_level", "env", "level", "service"] });
    } else {
      const m = /^\/loki\/api\/v1\/label\/(\w+)\/values$/.exec(url.pathname);
      if (!m)
        return (
          text(404, `the demo's mock of Loki has only: query_range, labels, label/<name>/values (not ${url.pathname})`),
          true
        );
      send(200, { status: "success", data: [...new Set(events.map((e) => e.labels[m[1]]).filter(Boolean))].sort() });
    }
  } catch (error) {
    text(400, error.message);
  }
  return true;
}
