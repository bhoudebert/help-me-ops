// A mock of three Prometheus HTTP API endpoints for the demo (not Prometheus, and
// no Prometheus code or data): their documented request and response shapes,
// answered from the recorded metrics of one environment. Mounted under
// /prometheus, as Prometheus can be behind a path prefix.
//
//   GET /prometheus/api/v1/query_range   a PromQL range query
//   GET /prometheus/api/v1/query         a PromQL instant query
//   GET /prometheus/api/v1/alerts        the alerts being evaluated
//
// It understands only a metric name with an optional env label (a subset of
// PromQL) and refuses the rest in Prometheus' own error shape. Bearer token.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const PROMETHEUS_AUTH = "Bearer demo-prom-token";

const series = (workspace, env) =>
  JSON.parse(readFileSync(join(workspace, "data", env, "metrics.json"), "utf8")).series;

function selector(query, env, known) {
  const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)\s*(?:\{([^}]*)\})?$/.exec(query.trim());
  if (!m) {
    throw Object.assign(
      new Error(`the demo's mock of Prometheus only understands a metric name with optional labels, not: ${query}`),
      { type: "bad_data" },
    );
  }
  for (const matcher of (m[2] ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)) {
    const l = /^(\w+)\s*=\s*"([^"]*)"$/.exec(matcher);
    if (!l || (l[1] !== "env" && l[1] !== "job")) {
      throw Object.assign(
        new Error(
          `the demo's mock of Prometheus only understands env="..." and job="..." label matchers, not: ${matcher}`,
        ),
        { type: "bad_data" },
      );
    }
    if (l[1] === "env" && l[2] !== env) return { name: m[1], points: [] };
  }
  const found = known[m[1]];
  return { name: m[1], points: found ? found.points.map(([at, v]) => [Date.parse(at) / 1000, String(v)]) : [] };
}

const labels = (name, env) => ({ __name__: name, env, job: "shop-worker", instance: "shop-worker-1:9100" });

const ALERTS = {
  prod: [
    {
      alertname: "PaymentQueueBackingUp",
      severity: "page",
      activeAt: "2026-10-07T10:00:00Z",
      summary: "payment-confirm queue above 1000 jobs",
      value: "1.012e+03",
    },
    {
      alertname: "WorkerMemoryNearLimit",
      severity: "warning",
      activeAt: "2026-10-07T09:55:00Z",
      summary: "shop-worker memory above 480MB",
      value: "4.98e+02",
    },
  ],
  staging: [],
};

/** Handles a /prometheus/... request of one environment; returns true when it answered. */
export function prometheusApi(workspace, env, request, response, url) {
  if (!url.pathname.startsWith("/prometheus/")) return false;
  const send = (status, body) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  const fail = (status, errorType, error) => send(status, { status: "error", errorType, error });
  if (request.headers.authorization !== PROMETHEUS_AUTH) {
    fail(401, "unauthorized", "a Bearer token is needed");
    return true;
  }
  if (request.method !== "GET") {
    fail(405, "bad_data", "the demo's mock of Prometheus is read-only: only GET");
    return true;
  }
  const route = url.pathname.slice("/prometheus".length);
  const q = url.searchParams;
  try {
    if (route === "/api/v1/query_range") {
      const [start, end] = [Number(q.get("start")), Number(q.get("end"))];
      if (!(start < end))
        throw Object.assign(new Error("end timestamp must not be before start time"), { type: "bad_data" });
      const { name, points } = selector(q.get("query") ?? "", env, series(workspace, env));
      const values = points.filter(([t]) => t >= start && t <= end);
      send(200, {
        status: "success",
        data: { resultType: "matrix", result: values.length ? [{ metric: labels(name, env), values }] : [] },
      });
    } else if (route === "/api/v1/query") {
      const at = q.get("time") ? Number(q.get("time")) : Date.now() / 1000;
      const { name, points } = selector(q.get("query") ?? "", env, series(workspace, env));
      const last = points.filter(([t]) => t <= at).at(-1);
      send(200, {
        status: "success",
        data: { resultType: "vector", result: last ? [{ metric: labels(name, env), value: last }] : [] },
      });
    } else if (route === "/api/v1/alerts") {
      send(200, {
        status: "success",
        data: {
          alerts: (ALERTS[env] ?? []).map((a) => ({
            labels: { alertname: a.alertname, severity: a.severity, env },
            annotations: { summary: a.summary },
            state: "firing",
            activeAt: a.activeAt,
            value: a.value,
          })),
        },
      });
    } else fail(404, "not_found", `the demo's mock of Prometheus has only: query_range, query, alerts (not ${route})`);
  } catch (error) {
    fail(400, error.type ?? "bad_data", error.message);
  }
  return true;
}
