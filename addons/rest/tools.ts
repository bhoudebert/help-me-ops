// The rest addon: GET one path of a team's own REST API, nothing else.
//
// Read-only by construction, not by trust: the method is GET, the path must sit
// under a prefix the settings list, the host cannot change, redirects are not
// followed (they could leave the allowed paths), the answer is capped, and the
// request times out. The token is a secret setting: it never appears in errors.
interface Context {
  settings: { baseUrl: string; allow: string; token?: string; tokenHeader: string };
  fetch: typeof fetch;
}

const MAX_BYTES = 1_000_000;
const TIMEOUT_MS = 10_000;
const STAMPS = ["at", "time", "timestamp", "updated_at", "created_at", "date"];

function allowed(path: string, allow: string): boolean {
  return allow
    .split(",")
    .map((prefix) => prefix.trim().replace(/\/$/, ""))
    .filter(Boolean)
    .some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

function target(path: string, query: string | undefined, { baseUrl, allow }: Context["settings"]): URL {
  if (!path.startsWith("/") || path.startsWith("//") || /[?#\\]/.test(path)) {
    throw new Error(`path must start with a single / and hold no ?, # or \\ (put the query in "query"): ${path}`);
  }
  const decoded = decodeURIComponent(path);
  if (decoded.split("/").some((part) => part === "..")) throw new Error(`path may not go up with "..": ${path}`);
  if (!allowed(path, allow)) throw new Error(`path ${path} is not under an allowed prefix (${allow})`);
  const base = new URL(baseUrl);
  const url = new URL(`${base.href.replace(/\/$/, "")}${path}`);
  if (url.origin !== base.origin) throw new Error(`path ${path} leaves ${base.origin}`);
  if (query) url.search = new URLSearchParams(query).toString();
  return url;
}

const withTime = (record: Record<string, unknown>) => {
  const stamp = STAMPS.map((key) => record[key]).find((v) => typeof v === "string" && !Number.isNaN(Date.parse(v)));
  return stamp ? { at: stamp, ...record } : record;
};

export async function get({ path, query }: { path: string; query?: string }, { settings, fetch }: Context) {
  const url = target(path, query, settings);
  const headers: Record<string, string> = { accept: "application/json" };
  if (settings.token) {
    const header = settings.tokenHeader.toLowerCase();
    headers[header] = header === "authorization" ? `Bearer ${settings.token}` : settings.token;
  }
  const response = await fetch(url, {
    method: "GET",
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`GET ${path} was redirected (${response.status}); redirects are not followed`);
  }
  if (!response.ok) throw new Error(`GET ${path} answered ${response.status}`);
  const text = await response.text();
  if (text.length > MAX_BYTES)
    throw new Error(`GET ${path}: the answer is larger than ${MAX_BYTES} bytes; narrow the query`);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return text.slice(0, 2000);
  }
  const records = Array.isArray(body) ? body : [body];
  return records.map((item) =>
    typeof item === "object" && item !== null ? withTime(item as Record<string, unknown>) : { value: item },
  );
}
