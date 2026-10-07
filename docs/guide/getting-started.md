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

The demo **workspace** in `examples/workspace` has one app, `shop`, with an
environment `prod` and two sources that ship with the project: a log file and
a small orders table, around an order that got stuck. A workspace is a folder:
`ops.config.json` (apps, environments, sources) and `playbooks/`.

## Try it from the terminal

```bash
npm run ops -- --workspace examples/workspace scope "order 4512 is stuck"
npm run ops -- --workspace examples/workspace sources
npm run ops -- --workspace examples/workspace search app-logs order=4512
npm run ops -- --workspace examples/workspace investigate "client u-881 paid but cannot find order 4512"

```

Set `OPS_WORKSPACE=examples/workspace` to leave `--workspace` out. With one
app and one environment they need no `--app` or `--env`; with several, the
`scope` command shows which fits a question.

`investigate` shows the matching playbook and where to look. The investigation
itself runs in an AI client, which brings its own model:
[Claude Code, Codex and Copilot](/clients).

## Make it yours

0. Copy `examples/workspace` to a folder of your own (in your app's repository, for example) and point to it with `--workspace` or `OPS_WORKSPACE`.
1. [Connect your sources](/connectors): describe them in `ops.config.json`, per app and environment, write a module for any that is not a log file.
2. [Write a playbook](/playbooks) for the problem you investigate most often.
3. Ask: "order 4512 is stuck, why?"
