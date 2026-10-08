# Claude Code, Codex and Copilot

The same MCP server (`npm run mcp`) serves all three. The method (playbook
first, quote the evidence, conclude with certainty and unknowns) is in the
server's instructions, so each client investigates the same way.

## Connect

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

The shipped client files point at the demo workspace (`examples/my-workspace`);
change `--workspace` / `OPS_WORKSPACE` to yours. Paths in `ops.config.json`
(log files, connector modules, playbooks) are read relative to the workspace,
so the server works from any folder.

With several apps or environments, the model first calls `scope` and asks you
which one when your question does not say.
