# Getting started

help-me-ops gives an AI assistant (Claude Code, Codex or GitHub Copilot) the
tools and the method to investigate your system: it searches your logs,
metrics and databases through **connectors**, follows your team's
**playbooks**, and concludes with the likely cause and the evidence for it. It
never changes anything.

## Install

```bash
git clone https://github.com/bhoudebert/help-me-ops.git
cd help-me-ops
nvm use        # Node 24
npm install
```

The demo **workspace** in `examples/workspace` is one app, `shop`, in `prod` and
`staging`, with its logs, orders, metrics and health checks recorded as files,
around an order that got stuck: [the story](/demo). A workspace is a folder:
`ops.config.json` (apps, environments, sources) and `playbooks/`.

## Try it

The fastest way is [the demo](/demo): open the folder in your AI client and ask
"client u-881 paid but cannot find order 4512". From the terminal, to see what
the assistant sees:

```bash
npm run ops -- --workspace examples/workspace scope "order 4512 is stuck"
npm run ops -- --workspace examples/workspace sources --env prod
npm run ops -- --workspace examples/workspace search app-logs order=4512 --env prod
npm run ops -- --workspace examples/workspace investigate "client u-881 paid but cannot find order 4512"

```

Set `OPS_WORKSPACE=examples/workspace` to leave `--workspace` out. With one
app and one environment they need no `--app` or `--env`; with several, the
`scope` command shows which fits a question.

`investigate` shows the matching playbook and where to look. The investigation
itself runs in an AI client, which brings its own model:
[Claude Code, Codex and Copilot](/clients).

## Make it yours

1. Copy `examples/workspace` to a folder of your own (in your app's repository, for example) and point to it with `--workspace` or `OPS_WORKSPACE`.
2. [Connect your sources](/connectors): describe them in `ops.config.json`, per app and environment, write a module for any that is not a log file.
3. [Write a playbook](/playbooks) for the problem you investigate most often.
4. [Write an addon](/addons) for a domain of your own: tools with their own settings, more source types.
5. Ask: "order 4512 is stuck, why?"
