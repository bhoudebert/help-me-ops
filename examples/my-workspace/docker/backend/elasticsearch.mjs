// A mock of the search endpoint of Elasticsearch for the demo (not Elasticsearch,
// and no Elastic code or data): the documented request and response shapes,
// answered from the recorded logs of one environment, in an index called
// shop-logs-<env>.
//
//   POST /<index>/_search      a search with a bool query: a time range and a query string
//
// The query string is a subset of Lucene syntax: words (all must be in the message),
// field:value (service, level, host, or an attribute such as order), "a phrase", AND,
// and NOT or -term. OR, parentheses and wildcards are refused the way Elasticsearch
// refuses a bad query (400 parse_exception) rather than answered wrongly.
// Authorization: ApiKey demo-es-key.
import { logEvents } from "./datadog.mjs";

export const ES_AUTH = "ApiKey demo-es-key";

const glob = (pattern) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
const NOW = Date.parse("2026-10-07T10:30:00Z");
const UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

function when(value) {
  const relative = /^now(?:-(\d+)([smhd]))?$/.exec(String(value));
  if (relative) return NOW - (relative[1] ? Number(relative[1]) * UNITS[relative[2]] : 0);
  const t = Date.parse(value);
  if (Number.isNaN(t))
    throw Object.assign(new Error(`failed to parse date field [${value}]`), { type: "parse_exception" });
  return t;
}

function parseQueryString(query) {
  const tokens = [...String(query).matchAll(/(-?)(?:"([^"]*)"|(\S+))/g)].map((m) => ({
    negate: m[1] === "-",
    text: m[2] ?? m[3],
    phrase: m[2] !== undefined,
  }));
  const terms = [];
  let negate = false;
  for (const token of tokens) {
    if (!token.phrase && token.text === "AND") continue;
    if (!token.phrase && token.text === "NOT") {
      negate = true;
      continue;
    }
    if (!token.phrase && (token.text === "OR" || /[()]/.test(token.text) || /[?*]/.test(token.text))) {
      throw Object.assign(
        new Error(
          `the demo's mock of Elasticsearch does not understand "${token.text}": use words, field:value, "phrases", AND, NOT`,
        ),
        { type: "parse_exception" },
      );
    }
    terms.push({ ...token, negate: token.negate || negate });
    negate = false;
  }
  return (doc) =>
    terms.every((term) => {
      const field = !term.phrase && /^([\w.@-]+):(.+)$/.exec(term.text);
      const hit = field
        ? String(doc.flat[field[1]] ?? "").toLowerCase() === field[2].toLowerCase()
        : doc.message.toLowerCase().includes(term.text.toLowerCase());
      return term.negate ? !hit : hit;
    });
}

function documents(workspace, env) {
  return logEvents(workspace, env).map((e) => {
    const a = e.attributes;
    const source = {
      "@timestamp": a.timestamp,
      message: a.message,
      level: a.status,
      service: { name: a.service },
      host: { name: a.host },
      ...a.attributes,
    };
    return {
      _index: `shop-logs-${env}`,
      _id: e.id,
      _source: source,
      _ms: e._ms,
      message: a.message,
      flat: {
        level: a.status,
        service: a.service,
        "service.name": a.service,
        host: a.host,
        "host.name": a.host,
        ...a.attributes,
      },
    };
  });
}

/** Handles a /<index>/_search request of one environment; returns true when it answered. */
export async function elasticsearchApi(workspace, env, request, response, url) {
  const m = /^\/([^/_][^/]*)\/_search$/.exec(url.pathname);
  if (!m) return false;
  const send = (status, body) => {
    response.writeHead(status, { "content-type": "application/json; charset=UTF-8" });
    response.end(JSON.stringify(body));
  };
  const fail = (status, type, reason) =>
    send(status, { error: { root_cause: [{ type, reason }], type, reason }, status });
  if (request.headers.authorization !== ES_AUTH) {
    fail(401, "security_exception", "missing authentication credentials for REST request");
    return true;
  }
  if (request.method !== "POST" && request.method !== "GET") {
    fail(405, "illegal_argument_exception", "the demo's mock of Elasticsearch is read-only: only a search");
    return true;
  }
  const index = `shop-logs-${env}`;
  if (
    !decodeURIComponent(m[1])
      .split(",")
      .some((part) => glob(part.trim()).test(index))
  ) {
    fail(404, "index_not_found_exception", `no such index [${m[1]}]`);
    return true;
  }
  try {
    let text = "";
    for await (const chunk of request) text += chunk;
    const body = JSON.parse(text || "{}");
    const range = body.query?.bool?.filter?.find((f) => f.range)?.range ?? {};
    const rangeSpec = range["@timestamp"] ?? {};
    const from = rangeSpec.gte ? when(rangeSpec.gte) : -Infinity;
    const to = rangeSpec.lte ? when(rangeSpec.lte) : Infinity;
    const matches = parseQueryString(body.query?.bool?.must?.find((x) => x.query_string)?.query_string?.query ?? "");
    const order = body.sort?.[0]?.["@timestamp"]?.order === "desc" ? -1 : 1;
    const size = Math.min(Number(body.size ?? 10), 10_000);
    const hits = documents(workspace, env)
      .filter((d) => d._ms >= from && d._ms <= to && matches(d))
      .sort((a, b) => order * (a._ms - b._ms))
      .slice(0, size)
      .map(({ _index, _id, _source, _ms }) => ({ _index, _id, _score: null, _source, sort: [_ms] }));
    send(200, {
      took: 3,
      timed_out: false,
      _shards: { total: 1, successful: 1, skipped: 0, failed: 0 },
      hits: { max_score: null, hits },
    });
  } catch (error) {
    fail(
      400,
      error.type ?? "parse_exception",
      error instanceof SyntaxError ? "the request body is not valid JSON" : error.message,
    );
  }
  return true;
}
