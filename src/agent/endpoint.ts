// Where the model of API mode is, and whether the workspace allows it (ADR 0014).
// Pure: no request is made here, so `doctor` and the config can use it without the
// loop. A chat model reached over HTTP with the OpenAI-compatible wire format,
// which Ollama, llama.cpp, LM Studio, vLLM and many hosted providers speak.
import { isIP } from "node:net";
import { z } from "zod";

export const ModelConfig = z.object({
  /** e.g. http://localhost:11434/v1 (Ollama); any OpenAI-compatible chat endpoint. */
  baseUrl: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  /** Sent as `Authorization: Bearer <key>`, what most providers expect. Name it as ${VAR}: a key is never stored in the file. */
  apiKey: z.string().min(1).optional(),
  /**
   * Other headers to send, for a provider or a gateway that wants its own
   * (`api-key`, `x-api-key`, a tenant). A value may use ${VAR}. A header named
   * `authorization` replaces the one `apiKey` would send.
   */
  headers: z
    .record(z.string().regex(/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/, "not a valid header name"), z.string())
    .default({}),
  /** Sent as `reasoning_effort` when set (`none` turns thinking off on servers that support it, such as Ollama, and is much faster). Left out when absent: not every server accepts it. */
  reasoningEffort: z.enum(["none", "low", "medium", "high"]).optional(),
  /** Most rounds of tool calls for one question. */
  maxSteps: z.number().int().min(1).max(100).default(20),
  temperature: z.number().min(0).max(2).default(0),
  /** The model's context in tokens, to know when to drop old tool results. */
  contextTokens: z.number().int().min(1000).default(16000),
  /** Most tokens one question may use, all requests together. */
  budgetTokens: z.number().int().min(1000).optional(),
  /** Per request, in milliseconds. A local model can be slow: the default is generous. */
  timeoutMs: z.number().int().min(1000).default(300000),
  /** Tries again after a 429 (rate limit) or a 502, 503, 504 from the server, this many times, waiting longer each time (or as long as `Retry-After` says, up to 30 s). */
  retries: z.number().int().min(0).max(5).default(2),
  /** The first wait before a retry, in milliseconds; it doubles each time. */
  retryDelayMs: z.number().int().min(0).default(1000),
});
export type ModelConfig = z.infer<typeof ModelConfig>;

/** A model ready to be asked: the address and the name are both known. */
export interface Model extends Omit<ModelConfig, "baseUrl" | "model"> {
  baseUrl: string;
  model: string;
}

/** `${NAME}` in a configured text is the environment variable NAME: credentials stay out of the file. */
function fill(text: string, env: NodeJS.ProcessEnv, what: string): string {
  return text.replace(/\$\{(\w+)\}/g, (_, name: string) => {
    const found = env[name];
    if (found === undefined)
      throw new Error(`${what} uses ${"$"}{${name}}, and the environment variable ${name} is not set.`);
    return found;
  });
}

/** An address as it is shown: without the query string or a login, which can carry a key. */
export function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}${u.search ? "?…" : ""}`;
  } catch {
    return url;
  }
}

/** The chat endpoint of an address, keeping any query string (Azure's api-version, for one). */
export function chatUrl(baseUrl: string): string {
  const u = new URL(baseUrl);
  u.pathname = `${u.pathname.replace(/\/+$/, "")}/chat/completions`;
  return u.toString();
}

/** The model from the flags, the environment and the config, in that order of strength. */
export function resolveModel(
  config: ModelConfig | undefined,
  flags: { baseUrl?: string; model?: string; maxSteps?: number; reasoningEffort?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
): Model {
  const base = ModelConfig.parse(config ?? {});
  const baseUrl = flags.baseUrl ?? env.OPS_MODEL_URL ?? base.baseUrl;
  const model = flags.model ?? env.OPS_MODEL ?? base.model;
  if (!baseUrl || !model) {
    throw new Error(
      'No model configured. Add "model": { "baseUrl": "http://localhost:11434/v1", "model": "<name>" } to ops.config.json, or pass --base-url and --model (or OPS_MODEL_URL and OPS_MODEL). Ollama, llama.cpp, LM Studio and vLLM all serve this API.',
    );
  }
  try {
    new URL(baseUrl);
  } catch {
    throw new Error(`The model address "${baseUrl}" is not a URL (e.g. http://localhost:11434/v1).`);
  }
  return {
    ...base,
    baseUrl: fill(baseUrl, env, "the model address").replace(/\/+$/, ""),
    headers: Object.fromEntries(Object.entries(base.headers).map(([k, v]) => [k, fill(v, env, `the header ${k}`)])),
    model,
    maxSteps: flags.maxSteps ?? base.maxSteps,
    reasoningEffort: ModelConfig.shape.reasoningEffort.parse(
      flags.reasoningEffort ?? env.OPS_MODEL_REASONING ?? base.reasoningEffort,
    ),
    apiKey: env.OPS_MODEL_KEY ?? (base.apiKey === undefined ? undefined : fill(base.apiKey, env, "the apiKey")),
  };
}

// ---- where the model is ----

const hostOf = (baseUrl: string) => new URL(baseUrl).hostname.replace(/^\[|\]$/g, "").toLowerCase();

/** Loopback or a private-network address, as written: a name is never resolved. */
function placeOf(host: string): "this machine" | "a private network address" | "a named host" {
  if (host === "localhost" || host.endsWith(".localhost")) return "this machine";
  const kind = isIP(host);
  if (kind === 4) {
    const [a = 0, b = 0] = host.split(".").map(Number);
    if (a === 127) return "this machine";
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254))
      return "a private network address";
  }
  if (kind === 6) {
    if (host === "::1") return "this machine";
    if (/^f[cd]/.test(host) || /^fe80/.test(host)) return "a private network address";
  }
  return "a named host";
}

/** For `doctor`: where the evidence goes when the model is asked. */
export function describeEndpoint(baseUrl: string): string {
  const host = hostOf(baseUrl);
  const place = placeOf(host);
  return place === "a named host"
    ? `${displayUrl(baseUrl)} (${host}: a named host; the evidence goes to whoever runs it)`
    : `${displayUrl(baseUrl)} (${place}: nothing leaves your network)`;
}

/** Refuses a model outside `privacy.modelHosts`, before any request. No list: anything goes. */
export function assertModelAllowed(baseUrl: string, allowed: string[] | undefined): void {
  if (!allowed) return;
  const host = hostOf(baseUrl);
  const place = placeOf(host);
  const ok = allowed.some((entry) => entry.toLowerCase() === host || (entry === "local" && place !== "a named host"));
  if (!ok) {
    throw new Error(
      `privacy.modelHosts allows only ${allowed.join(", ")}, and the model is at ${host} (${place}). Nothing was sent.`,
    );
  }
}
