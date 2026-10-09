# Claude Code, Codex and Copilot

The same MCP server (`npm run mcp`) serves all three. The method (playbook
first, quote the evidence, conclude with certainty and unknowns) is in the
server's instructions, so each client investigates the same way.

## Connect

One command prints the configuration for your clients, **with your real paths**, after
checking that it works:

```bash
npm run ops -- setup                 # all three
npm run ops -- setup claude          # or codex, copilot
npm run ops -- setup --workspace ../my-app/ops     # your own workspace
```

It checks that Node is 24 or more, that the workspace loads, and **starts the server
exactly as the client will and asks it for its tools over MCP**: if it says `ok`, the
client will connect. Then it prints what to paste: the `claude mcp add` command and
the `.mcp.json` for Claude Code, the block of `~/.codex/config.toml` for Codex, the
`.vscode/mcp.json` for Copilot in VS Code. A problem is a `FAIL` line with the reason,
and a non-zero exit code.

To write the files of a project for you (Claude Code and Copilot):

```bash
npm run ops -- setup claude --into ../my-app --write
```

It adds the server to that project's `.mcp.json` (and `.vscode/mcp.json` for
Copilot), **keeps everything else in the file, and never replaces an existing
`help-me-ops` entry**. It does not write your Codex configuration: that file is
yours, paste the block.

The snippets by hand, if you prefer:

::: code-group

```bash [Claude Code]
cd help-me-ops
claude          # the project ships .mcp.json (demo workspace): approve the "help-me-ops" server
```

```toml [Codex]
# ~/.codex/config.toml
[mcp_servers.help-me-ops]
command = "node"
args = ["--env-file-if-exists=/abs/path/help-me-ops/.env", "/abs/path/help-me-ops/src/mcp.ts"]
env = { OPS_WORKSPACE = "/abs/path/to/your/workspace" }
```

```text [Copilot (VS Code)]
Open the folder in VS Code: .vscode/mcp.json declares the server
(with OPS_WORKSPACE and your .env). Start it from the MCP view, then use
Copilot Chat in agent mode.
```

:::

## One server for a team

The server above runs on each person's machine and needs the credentials there.
To keep them on one server instead, run it over HTTP and give people a URL and a
token: [one server for the team](/team-server).

## Ask

```text
client u-881 paid but cannot find order 4512, what happened?
the payment queue is backing up since 10:00, why?
is the payment worker healthy on staging?
```

The first one is the [demo](/demo): the answer is in the files of
`examples/my-workspace`.

In Claude Code, `/mcp__help-me-ops__investigate <problem>` sends the method
and the problem in one go.

The shipped client files (`.mcp.json`, `.vscode/mcp.json`) point at the **demo
workspace** (`examples/my-workspace`), so a client started in this repository
investigates the demo; change `--workspace` / `OPS_WORKSPACE` to yours. Without
either, the server reads the current folder.

**Which workspace is loaded?** The server prints it on start-up
(`workspace /path/…`), the model is told it, and the `scope` answer starts with
it. Ask "which workspace are you reading?" any time. From the terminal,
`npm run ops -- doctor` prints it first. Paths in `ops.config.json`
(log files, connector modules, playbooks) are read relative to the workspace,
so the server works from any folder.

With several apps or environments, the model first calls `scope` and asks you
which one when your question does not say.
