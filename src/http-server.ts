// The MCP server over HTTP for a team (ADR 0015): one process holds the
// credentials of the workspace, people hold a token. Streamable HTTP of the MCP
// SDK underneath; around it, what a server on a URL needs and a stdio one does
// not: authentication, a Host and Origin check, size and session limits, and an
// audit line per tool call.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { isIP } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer } from "./mcp-server.ts";
import type { Toolbox } from "./tools/index.ts";

export interface HttpOptions {
  host: string;
  /** 0 asks the system for a free port (tests). */
  port: number;
  path: string;
  /** The people who may connect, by the name that identifies their sessions. Empty with `noAuth`. */
  tokens: {
    name: string;
    /** SHA-256 of the token, in hex: the server never needs the token itself. */ hash: string;
  }[];
  /** Serve without a token: only on a loopback address, and only when asked for in so many words. */
  noAuth: boolean;
  /** Names the server is reached by, behind a proxy (`mcp.company.example`); the Host header must be one of them. */
  publicHosts: string[];
  tls?: { cert: string; key: string };
  maxSessions: number;
  idleMs: number;
  maxBodyBytes: number;
  /** One JSON line per event: sessions opening and closing, tool calls. */
  log: (event: Record<string, unknown>) => void;
}

export const HTTP_DEFAULTS = {
  host: "127.0.0.1",
  port: 8808,
  path: "/mcp",
  maxSessions: 100,
  idleMs: 30 * 60_000,
  maxBodyBytes: 1_000_000,
} as const;

export interface Running {
  /** Where to point a client, e.g. http://127.0.0.1:8808/mcp */
  url: string;
  sessions(): number;
  close(): Promise<void>;
}

const NAME = /^[a-z][a-z0-9_-]{0,31}$/;

/** A token that cannot be guessed: 256 random bits. */
export const newToken = () => randomBytes(32).toString("base64url");

/**
 * What the server keeps of a token. The token is 256 random bits, so a plain SHA-256 is enough (a password
 * needs a slow, salted hash because people choose it; nobody chooses this): a leaked file of hashes opens nothing.
 */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * `alice:sha256:<hex>` (what `ops token` prints for the server) or `alice:<token>` (the token itself, which
 * works and leaves it readable in the file), comma-separated. A short or repeated token, a bad name, or a
 * hash that is not 64 hex digits is an error.
 */
export function parseTokens(text: string | undefined): { name: string; hash: string; plain: boolean }[] {
  const tokens = (text ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const at = part.indexOf(":");
      const name = at > 0 ? part.slice(0, at) : "";
      const value = at > 0 ? part.slice(at + 1) : "";
      if (!NAME.test(name))
        throw new Error(`OPS_MCP_TOKENS: "${name}" is not a name (lowercase letters, digits, _ and -, up to 32).`);
      if (value.startsWith("sha256:")) {
        const hex = value.slice("sha256:".length).toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(hex))
          throw new Error(
            `OPS_MCP_TOKENS: the hash of "${name}" is not 64 hexadecimal digits; make one with: npm run ops -- token ${name}`,
          );
        return { name, hash: hex, plain: false };
      }
      if (value.length < 24) {
        throw new Error(
          `OPS_MCP_TOKENS: the token of "${name}" is too short to be safe; make one with: npm run ops -- token ${name}`,
        );
      }
      return { name, hash: hashToken(value), plain: true };
    });
  const names = tokens.map((t) => t.name);
  const twice = names.find((n, i) => names.indexOf(n) !== i);
  if (twice) throw new Error(`OPS_MCP_TOKENS: "${twice}" appears twice.`);
  return tokens;
}

/**
 * The options of the HTTP server from the command line and the environment, flags first:
 * `--host`/OPS_MCP_HOST, `--port`/OPS_MCP_PORT, `--path`/OPS_MCP_PATH, `--public-host`/OPS_MCP_PUBLIC_HOSTS
 * (comma-separated), the tokens in OPS_MCP_TOKENS and/or a file named by OPS_MCP_TOKENS_FILE (a container
 * secret: `name:token` entries separated by commas or new lines), `--tls-cert` and `--tls-key`, `--no-auth`.
 */
export function optionsFromArgs(argv: string[], env: NodeJS.ProcessEnv, log: HttpOptions["log"]): HttpOptions {
  const all = (name: string) => argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]!] : []));
  const one = (name: string) => all(name).at(-1);
  const cert = one("--tls-cert");
  const key = one("--tls-key");
  if (Boolean(cert) !== Boolean(key)) throw new Error("--tls-cert and --tls-key go together.");
  const port = Number(one("--port") ?? env.OPS_MCP_PORT ?? HTTP_DEFAULTS.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error(`The port "${one("--port") ?? env.OPS_MCP_PORT}" is not a port number.`);
  const fromFile = env.OPS_MCP_TOKENS_FILE ? readTokensFile(env.OPS_MCP_TOKENS_FILE) : "";
  const tokens = parseTokens([env.OPS_MCP_TOKENS, fromFile].filter(Boolean).join(","));
  for (const t of tokens.filter((x) => x.plain)) {
    log({
      at: new Date().toISOString(),
      event: "warning",
      message: `the token of ${t.name} is readable in the configuration: keep its hash instead (npm run ops -- token ${t.name} prints it)`,
    });
  }
  const publicHosts = all("--public-host");
  return {
    host: one("--host") ?? env.OPS_MCP_HOST ?? HTTP_DEFAULTS.host,
    port,
    path: one("--path") ?? env.OPS_MCP_PATH ?? HTTP_DEFAULTS.path,
    tokens: tokens.map(({ name, hash }) => ({ name, hash })),
    noAuth: argv.includes("--no-auth"),
    publicHosts: publicHosts.length
      ? publicHosts
      : (env.OPS_MCP_PUBLIC_HOSTS ?? "")
          .split(",")
          .map((h) => h.trim())
          .filter(Boolean),
    tls: cert && key ? { cert: readFileSync(cert, "utf8"), key: readFileSync(key, "utf8") } : undefined,
    maxSessions: HTTP_DEFAULTS.maxSessions,
    idleMs: HTTP_DEFAULTS.idleMs,
    maxBodyBytes: HTTP_DEFAULTS.maxBodyBytes,
    log,
  };
}

function readTokensFile(path: string): string {
  try {
    return readFileSync(path, "utf8")
      .split(/[\n,]/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
      .join(",");
  } catch (error) {
    throw new Error(
      `OPS_MCP_TOKENS_FILE: cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

const loopback = (host: string) =>
  host === "localhost" || host === "::1" || host === "[::1]" || (isIP(host) === 4 && host.startsWith("127."));
const digest = (text: string) => createHash("sha256").update(text).digest();

interface Session {
  identity: string;
  transport: StreamableHTTPServerTransport;
  lastSeen: number;
}

export async function startHttpServer(toolbox: Toolbox, options: HttpOptions): Promise<Running> {
  const { host, path, log } = options;
  if (options.noAuth && !loopback(host)) {
    throw new Error(
      `--no-auth is only for a loopback address, and the server would listen on ${host}. Give it tokens (OPS_MCP_TOKENS).`,
    );
  }
  if (!options.noAuth && !options.tokens.length) {
    throw new Error(
      "No token: a server on a URL reads your systems for whoever reaches it. Set OPS_MCP_TOKENS (make a token with: npm run ops -- token <name>), or, on this machine only, --no-auth.",
    );
  }
  if (!loopback(host) && !options.publicHosts.length) {
    throw new Error(
      `The server would listen on ${host}: say which name it is reached by (--public-host mcp.company.example) so the Host header can be checked.`,
    );
  }
  const accepted = options.tokens.map((t) => ({ name: t.name, hash: Buffer.from(t.hash, "hex") }));
  const sessions = new Map<string, Session>();

  const reply = (res: ServerResponse, status: number, body: object, headers: Record<string, string> = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(body));
  };

  /** The name of the person behind a request, or null. Compared in constant time. */
  const identify = (req: IncomingMessage): string | null => {
    if (options.noAuth) return "local";
    const given = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
    if (!given) return null;
    const hash = digest(given);
    let found: string | null = null;
    for (const t of accepted) if (timingSafeEqual(t.hash, hash)) found = t.name;
    return found;
  };

  const readBody = (req: IncomingMessage) =>
    new Promise<unknown>((done, fail) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > options.maxBodyBytes) {
          // Say so, then hang up: not before, or the client only sees a broken connection.
          if (size - chunk.length <= options.maxBodyBytes) fail(Object.assign(new Error("too big"), { status: 413 }));
          chunks.length = 0;
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        try {
          done(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined);
        } catch {
          fail(Object.assign(new Error("not JSON"), { status: 400 }));
        }
      });
      req.on("error", fail);
    });

  let allowedHosts: string[] = [];
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://placeholder");
    // A browser page reaching a local server by a name of its own (DNS rebinding) sends another Host, or an Origin.
    if (!allowedHosts.includes((req.headers.host ?? "").toLowerCase()))
      return reply(res, 403, { error: "Host not allowed" });
    if (req.headers.origin) return reply(res, 403, { error: "Origin not allowed" });
    if (url.pathname === "/healthz" && req.method === "GET") return reply(res, 200, { ok: true });
    if (url.pathname !== path) return reply(res, 404, { error: "Not found" });

    const identity = identify(req);
    if (!identity) {
      return reply(
        res,
        401,
        { error: "A token is needed: Authorization: Bearer <token>" },
        { "www-authenticate": 'Bearer realm="help-me-ops"' },
      );
    }
    try {
      const sessionId = req.headers["mcp-session-id"];
      const body = req.method === "POST" ? await readBody(req) : undefined;
      if (typeof sessionId === "string") {
        const session = sessions.get(sessionId);
        if (!session) return reply(res, 404, { error: "Unknown session: open a new one" });
        if (session.identity !== identity) return reply(res, 403, { error: "This session belongs to someone else" });
        session.lastSeen = Date.now();
        return await session.transport.handleRequest(req, res, body);
      }
      if (req.method !== "POST" || !isInitializeRequest(body)) {
        return reply(res, 400, { error: "No session: start with an initialize request" });
      }
      if (sessions.size >= options.maxSessions) {
        return reply(res, 503, { error: "Too many sessions" }, { "retry-after": "60" });
      }
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { identity, transport, lastSeen: Date.now() });
          log({ at: new Date().toISOString(), event: "session", action: "open", identity, session: id });
        },
      });
      transport.onclose = () => {
        const id = transport.sessionId;
        if (id && sessions.delete(id))
          log({ at: new Date().toISOString(), event: "session", action: "close", identity, session: id });
      };
      // Its own tools, so its own ledger: one session is one investigation.
      const server = createMcpServer(toolbox, {
        onCall: (call) =>
          log({ at: new Date().toISOString(), event: "tool", identity, session: transport.sessionId, ...call }),
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500;
      if (!res.headersSent) {
        reply(
          res,
          status,
          { error: status === 500 ? "Server error" : (error as Error).message },
          status === 413 ? { connection: "close" } : {},
        );
        if (status === 413) res.once("finish", () => req.socket.destroy());
      } else res.end();
      if (status === 500) log({ at: new Date().toISOString(), event: "error", message: (error as Error).message });
    }
  };

  const server: Server = options.tls
    ? createHttpsServer({ cert: options.tls.cert, key: options.tls.key }, handler)
    : createHttpServer(handler);
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(options.port, host, done);
  });
  const port = (server.address() as { port: number }).port;
  const shown = host.includes(":") ? `[${host}]` : host;
  allowedHosts = [
    ...new Set(
      [`${shown}:${port}`, `localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`, ...options.publicHosts].map((h) =>
        h.toLowerCase(),
      ),
    ),
  ];
  const sweep = setInterval(() => {
    for (const [id, s] of sessions)
      if (Date.now() - s.lastSeen > options.idleMs) void s.transport.close().finally(() => sessions.delete(id));
  }, 60_000);
  sweep.unref();

  return {
    url: `${options.tls ? "https" : "http"}://${shown}:${port}${path}`,
    sessions: () => sessions.size,
    close: async () => {
      clearInterval(sweep);
      for (const s of [...sessions.values()]) await s.transport.close().catch(() => undefined);
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
