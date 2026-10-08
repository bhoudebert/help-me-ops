// A live backend for the demo: the shop's own REST API, serving the recorded
// data of the workspace over HTTP, one port per environment. It lets the `rest`
// addon (and later the fake Datadog) be tried against a real server, with no
// account and nothing to install: Node only.
//
//   docker compose -f docker/compose.yml up -d backend     # from examples/my-workspace
//   node docker/backend/server.mjs                         # or without Docker
//
// It only reads: anything but GET is answered 405.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DEMO_TOKEN = "demo-token";

const read = (workspace, env, file) => JSON.parse(readFileSync(join(workspace, "data", env, file), "utf8"));

/** The shop API of one environment: a request handler. */
export function shopApi(workspace, env) {
  return (request, response) => {
    const send = (status, body) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (request.method !== "GET") return send(405, { error: "read-only: only GET" });
    if (request.headers.authorization !== `Bearer ${DEMO_TOKEN}`)
      return send(401, { error: "a Bearer token is needed" });

    const url = new URL(request.url ?? "/", "http://backend");
    const orders = () => read(workspace, env, "orders.json").orders;
    if (url.pathname === "/orders") {
      const status = url.searchParams.get("status");
      const since = url.searchParams.get("since");
      return send(
        200,
        orders().filter(
          (o) => (!status || o.status === status) && (!since || Date.parse(o.updated_at) >= Date.parse(since)),
        ),
      );
    }
    const one = /^\/orders\/([\w-]+)$/.exec(url.pathname);
    if (one) {
      const order = orders().find((o) => o.id === one[1]);
      return order ? send(200, order) : send(404, { error: `no order ${one[1]}` });
    }
    if (url.pathname === "/health") return send(200, read(workspace, env, "health.json").checks);
    return send(404, { error: `no route ${url.pathname}` });
  };
}

/** One server per environment, on the given ports (0 picks free ones). Resolves with the listening servers. */
export async function start(workspace, ports) {
  const servers = {};
  for (const [env, port] of Object.entries(ports)) {
    servers[env] = createServer(shopApi(workspace, env));
    await new Promise((done) => servers[env].listen(port, process.env.BACKEND_HOST ?? "127.0.0.1", done));
  }
  return servers;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const workspace = resolve(process.env.WORKSPACE ?? join(import.meta.dirname, "../.."));
  const servers = await start(workspace, {
    prod: Number(process.env.PROD_PORT ?? 8088),
    staging: Number(process.env.STAGING_PORT ?? 8089),
  });
  for (const [env, server] of Object.entries(servers))
    console.log(`${env}: http://${server.address().address}:${server.address().port}`);
}
