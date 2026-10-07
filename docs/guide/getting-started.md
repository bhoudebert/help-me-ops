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
cp ops.config.example.json ops.config.json
```

The example config connects two sources that ship with the project: a log
file and a small orders table, around an order that got stuck.

## Try it from the terminal

```bash
npm run ops -- sources
npm run ops -- search app-logs order=4512
npm run ops -- investigate "client u-881 paid but cannot find order 4512"
```

`investigate` shows the matching playbook and where to look; the automated
investigation in the terminal is the next step of the project. Today, run the
investigation itself from an AI client: [Claude Code, Codex and Copilot](/clients).

## Make it yours

1. [Connect your sources](/connectors): describe them in `ops.config.json`, write a module for any that is not a log file.
2. [Write a playbook](/playbooks) for the problem you investigate most often.
3. Ask: "order 4512 is stuck, why?"
