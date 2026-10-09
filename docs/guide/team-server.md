# One server for the team (MCP over HTTP)

By default the MCP server runs **on each person's machine**: the AI client starts it, and it needs a clone, Node and the credentials of every system the workspace reads. For a team there is a second way: **run it once, on a server, and give people a URL and a token**. The credentials live on that server only; a laptop holds a token that you can revoke by removing it.

```
 laptop: Claude Code, Codex, Copilot ──HTTPS + token──▶  help-me-ops (mcp:http)  ──▶ logs, databases, APIs
 holds: a URL and a token                                holds: the workspace and the credentials
```

The tools are the same, read-only like everywhere, with the same mask, strict mode and checked conclusion. What is new is that **the server is on a URL, so it needs the protections a stdio server never needed**: a token, TLS, a limit on who it answers. Read [what it does and does not do](#what-it-does-and-does-not-do) before you put one near production.

## Try it on your machine

```bash
# a token for yourself
npm run ops -- token alice
#   alice:Xk3...   <- the line to give the server; the part after "alice:" is the secret

OPS_MCP_TOKENS="alice:Xk3..." npm run mcp:http -- --workspace examples/my-workspace
# help-me-ops MCP server on http://127.0.0.1:8808/mcp: workspace …
```

It listens on `127.0.0.1:8808`, path `/mcp`. Point a client at it:

::: code-group

```bash [Claude Code]
claude mcp add --transport http help-me-ops http://127.0.0.1:8808/mcp \
  --header "Authorization: Bearer Xk3..."
```

```json [.mcp.json]
{
  "mcpServers": {
    "help-me-ops": {
      "type": "http",
      "url": "http://127.0.0.1:8808/mcp",
      "headers": { "Authorization": "Bearer ${HELP_ME_OPS_TOKEN}" }
    }
  }
}
```

```json [.vscode/mcp.json (Copilot)]
{
  "servers": {
    "help-me-ops": {
      "type": "http",
      "url": "http://127.0.0.1:8808/mcp",
      "headers": { "Authorization": "Bearer ${input:help-me-ops-token}" }
    }
  },
  "inputs": [
    { "id": "help-me-ops-token", "type": "promptString", "password": true, "description": "help-me-ops token" }
  ]
}
```

:::

How a client sends a header, and whether it can reach a remote server at all, depends on the client and its version: check its documentation. A client that only speaks OAuth for remote servers cannot connect yet (see the limits below).

For a quick look **on this machine only**, `--no-auth` serves without a token, and refuses to when the address is not a loopback one.

## Put it on a server

1. **The workspace and the credentials on the server**, like for a local run: the folder (in its own repository), and the variables the addons read (`SHOPDB_PROD_URL`, `DD_API_KEY`...) in a `.env` the server can read and nobody else. Read-only accounts, as ever.
2. **A token per person**: `npm run ops -- token <name>` for each, joined with commas in `OPS_MCP_TOKENS`. The name is the person's identity in the logs. To revoke someone, remove their entry and restart.
3. **Start it behind TLS.** The server speaks plain HTTP on the address you give it; put a reverse proxy in front for HTTPS, and tell the server the name people use:

```bash
OPS_MCP_TOKENS="alice:…,bob:…" npm run mcp:http -- --workspace /srv/ops \
  --host 127.0.0.1 --port 8808 --public-host mcp.company.example
```

```
# Caddy: automatic certificates
mcp.company.example {
  reverse_proxy 127.0.0.1:8808
}
```

`--public-host` is the name in the `Host` header the proxy forwards (add the port if the proxy uses a non-standard one). Without it, a server that listens beyond loopback **refuses to start**. The server can also serve TLS itself (`--tls-cert`, `--tls-key`), when there is no proxy.

4. **Keep it running** with your usual service manager, for example a systemd unit:

```ini
[Service]
User=helpmeops
WorkingDirectory=/opt/help-me-ops
EnvironmentFile=/etc/help-me-ops.env       # OPS_MCP_TOKENS=…, the credentials
ExecStart=/usr/bin/node src/mcp-http.ts --workspace /srv/ops --public-host mcp.company.example
Restart=on-failure
```

5. **People connect** with the URL (`https://mcp.company.example/mcp`) and their token, as above.

`GET /healthz` answers `{"ok":true}` with no token, for a load balancer's check.

## What it does and does not do

**It does:**

- refuse any request without a valid token (`401`), compared in constant time; a session belongs to the person who opened it, and another token cannot use its id;
- **refuse to start** without tokens (except `--no-auth` on loopback), and refuse to listen beyond loopback without a `--public-host`;
- check the `Host` and refuse any request that carries an `Origin`, against a web page reaching a local server through a name of its own (DNS rebinding);
- give **each session its own ledger**: a conclusion can only cite what that session read;
- cap a request at 1 MB, sessions at 100 and close idle ones after 30 minutes;
- write **one JSON line per event** on the error output: sessions opening and closing, and each tool call with the time, the identity, the session, the tool, the app, the environment, the source, the duration and whether it worked. **Not** the question and **not** the evidence, which can hold personal data.

**It does not (yet):**

- **Per-person permissions.** A token reads everything the workspace reads. What a person may see is decided by who gets a token, and by the read-only accounts behind the sources.
- **OAuth.** Clients that only connect to remote servers through OAuth cannot use it; put an authenticating proxy in front, or wait.
- **Rate limits** beyond the caps above, or **token rotation** (remove, add, restart).
- **Hide anything from the AI provider.** What a tool returns still goes to the provider of the client the person uses: the [personal-data page](/privacy) applies as ever, and the mask and strict mode are enforced here, once, for everybody.

A leaked token reads production until it is removed: treat tokens like passwords, and keep the server patched. Design and alternatives: [ADR 0015](https://github.com/bhoudebert/help-me-ops/blob/main/docs/adr/0015-one-mcp-server-over-http-for-a-team.md).
