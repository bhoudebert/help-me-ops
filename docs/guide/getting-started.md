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

The demo [**workspace**](/workspace) in `examples/my-workspace` is one app, `shop`, in `prod` and
`staging`, with its logs, orders, metrics and health checks recorded as files,
around an order that got stuck: [the story](/demo). A workspace is a folder:
`ops.config.json` (apps, environments, sources) and `playbooks/`.

## Where do I run what

help-me-ops is not published: you use it from your **clone** (the folder above,
once `npm install` is done). Every command runs there, and the only thing that
may live somewhere else is your [workspace](/workspace). You say which one in
the clone's `.env` file, once:

```bash
cp .env.example .env     # git-ignored; read by npm run ops and npm run mcp
# then in .env:
OPS_WORKSPACE=/home/me/my-app/ops
```

Without `.env`, add `--workspace <folder>` to each command. Which workspace is
loaded is always printed first (`doctor`) and told to the assistant.

| You want to          | Run, from the clone                                                    |
| -------------------- | ---------------------------------------------------------------------- |
| See what it connects | `npm run ops -- sources`                                               |
| Start an addon       | `npm run ops -- init addon billing --template api`                     |
| Check your addons    | `npm run ops -- doctor`                                                |
| Serve an AI client   | `npm run mcp` (the client's config starts it, see [clients](/clients)) |

An addon that needs a package (a database driver such as `pg`) finds it from its
own folder upward, so install it **in your workspace**, not in the clone:
`cd <your workspace> && npm install pg`. Addons without packages need nothing.
`OPS_ADDONS` is optional: it adds shared addon folders, for a team that keeps
one set of addons for several workspaces.

## Try it

The fastest way is [the demo](/demo): open the folder in your AI client and ask
"client u-881 paid but cannot find order 4512". From the terminal, to see what
the assistant sees:

```bash
npm run ops -- --workspace examples/my-workspace scope "order 4512 is stuck"
npm run ops -- --workspace examples/my-workspace sources --env prod
npm run ops -- --workspace examples/my-workspace search app-logs order=4512 --env prod
npm run ops -- --workspace examples/my-workspace investigate "client u-881 paid but cannot find order 4512"

```

Set `OPS_WORKSPACE=examples/my-workspace` to leave `--workspace` out. With one
app and one environment they need no `--app` or `--env`; with several, the
`scope` command shows which fits a question.

`investigate` shows the matching playbook and where to look. The investigation
itself runs in an AI client, which brings its own model:
[Claude Code, Codex and Copilot](/clients).

## Before you connect a real system

::: danger Personal data
What the tools return is sent to the AI provider of your client, and help-me-ops hides only what you list ([mask](/privacy#mask-it-a-safeguard-in-ops-config-json)). Read [personal data](/privacy) before you point it at logs, a database or an API with real customers in them. The demo holds only invented data.
:::

## Make it yours

1. Create a workspace in your own repository, with `npm run ops -- init workspace ../my-app/ops --app my-app` (a configuration, a starter playbook and a README: it never overwrites), and point to it with `OPS_WORKSPACE` in `.env`. Or copy `examples/my-workspace` to start from the demo.
2. [Connect your sources](/connectors): describe them in `ops.config.json`, per app and environment, write a module for any that is not a log file.
3. [Write a playbook](/playbooks) for the problem you investigate most often.
4. [Write an addon](/addons) for a database, an API or metrics: an `addon.json` and a `tools.ts` of plain functions.
5. Ask: "order 4512 is stuck, why?"
