# Local or remote: how a client connects

An AI client (Claude Code, Codex, Copilot) talks to help-me-ops through **MCP**, a protocol that lets it list and call tools. The client never reads your logs or databases itself: it asks an **MCP server** to run a tool, and the server does the reading. What differs between "local" and "remote" is **where that server runs and how the client reaches it**.

```
LOCAL (stdio): everything on your machine

  ┌─────────────────────── your laptop ───────────────────────┐
  │  AI client ──starts──▶ help-me-ops ──▶ logs, DBs, APIs    │
  │            ◀─pipes───  (+ workspace + credentials)        │
  └───────────────────────────────────────────────────────────┘

REMOTE (HTTP): the server is somewhere else

  ┌──── your laptop ────┐   HTTPS + token   ┌─────────────── a server ───────────────┐
  │  AI client          │ ────────────────▶ │  help-me-ops (mcp:http)                │
  │  holds a URL, a     │ ◀──────────────── │  + workspace + credentials ──▶ logs,   │
  │  token              │                   │                                 DBs,   │
  └─────────────────────┘                   │                                 APIs   │
                                            └────────────────────────────────────────┘
```

|                                | Local (stdio)                              | Remote (HTTP)                                                     |
| ------------------------------ | ------------------------------------------ | ----------------------------------------------------------------- |
| Where the server runs          | on your machine, **started by the client** | on a server (or a container) that someone keeps running           |
| What you install               | a clone, Node 24, `npm install`            | nothing but the client                                            |
| Where the credentials are      | on your machine                            | **on the server only**                                            |
| How the client finds it        | a command to run                           | a URL and a token                                                 |
| Login                          | none: you started it                       | a token per person (the server refuses without one)               |
| Who sees what the tools return | you                                        | each person who has a token; every call is logged with their name |
| Best for                       | trying it, one person, the demo            | a team, credentials you do not want on laptops                    |

Both run **the same tools** with the same read-only guarantees, mask, strict mode and checked conclusion. The model is still the client's, and what a tool returns still goes to your AI provider ([personal data](/privacy)).

## Local: the client starts it

```bash
npm run ops -- setup                     # prints the configuration for each client, with your paths, after checking it
npm run ops -- setup claude --into ../my-app --write   # or writes the project's .mcp.json for you
```

This repository ships a `.mcp.json` for the demo workspace: open Claude Code in the repo, approve the `help-me-ops` server, ask. There is nothing to start yourself. See [Claude Code, Codex and Copilot](/clients) for each client.

## Remote: one server, a URL and a token

**1. On the server**, once:

```bash
npm run ops -- token alice          # prints the line for the server (a hash) and, once, the secret for alice
OPS_MCP_TOKENS="alice:sha256:<hash>" npm run mcp:http -- --workspace /srv/ops
# or with Docker: docker compose up -d      (see "One server for the team")
```

**2. On each laptop**, tell the client the URL and the token:

```bash
export HELP_ME_OPS_TOKEN=<secret>
claude mcp add --transport http ops-team https://mcp.company.example/mcp \
  --header "Authorization: Bearer $HELP_ME_OPS_TOKEN"
```

Try it **on one machine** first: the server on `http://127.0.0.1:8808/mcp` in one terminal, the client in another, in a folder that is not this repository (so the repository's own `.mcp.json` does not mix in). Then `/mcp` inside Claude shows `ops-team` connected, and the server's terminal prints one JSON line per call, with your name.

::: tip If a flag is swallowed
A `claude` that is a shell alias or a wrapper can take `--transport` or `--header` for its own. Put `--` before Claude's arguments (`claude -- mcp add --transport http …`), or call the real binary.
:::

How to run it for a team, behind TLS, with Docker: [one server for the team](/team-server).

## Where a client keeps the connection (scopes)

`claude mcp add` stores the connection in one of three places, and it uses the narrowest unless you ask:

| Scope               | Flag              | Who sees it                  | Stored in                                        |
| ------------------- | ----------------- | ---------------------------- | ------------------------------------------------ |
| **local** (default) | none              | you, **in this folder only** | your user config, under this folder's path       |
| **project**         | `--scope project` | everyone who uses the repo   | `.mcp.json` in the repo; each person approves it |
| **user**            | `--scope user`    | you, in every folder         | your user config                                 |

So the `ops-team` you added in `/tmp/try` is invisible from the repository, and the repository's stdio server is invisible from `/tmp/try`. Two servers with the **same name** in different scopes: the closest wins (local, then project, then user). For a team server you want on your machine everywhere, add it with `--scope user`; for one shared in a repo, `--scope project` with the token read from a variable (`"headers": { "Authorization": "Bearer ${HELP_ME_OPS_TOKEN}" }`), **never the token itself in the file**. `claude mcp list` shows what is active from the folder you are in, and `claude mcp get <name>` where it comes from.

Other clients have their own files and wording (Codex: `config.toml`; Copilot: `.vscode/mcp.json`); whether a client can reach a remote server, and how it sends a header, depends on the client and its version.

## Which one

- **You alone, or the demo:** local. Nothing to run.
- **A few people, credentials you want in one place:** remote, with Docker or a service. Nobody needs the database password; you remove a token to remove a person.
- **Neither, no client at all:** [`ops chat` and `ops ask`](/local-models) run on your machine against a model you choose.
