# What is in a workspace

A **workspace** is one folder that describes your infrastructure: what to
investigate, where the evidence is, and how your team investigates. You keep it
in your own repository and point help-me-ops at it (`--workspace`, or
`OPS_WORKSPACE`). The demo is `examples/my-workspace`; copy it to start.

```
my-workspace/
  ops.config.json     which apps and environments, and their sources
  addons/             what can be read: databases, APIs, metrics … (see Write an addon)
  playbooks/          how your team investigates each kind of problem
  logs/, data/        the demo's fake system: sample logs and recorded data
  scenarios/          the demo's test script (not read by the assistant)
```

| Piece                         | What it is for                                                                                                                                                             | In real life                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **`ops.config.json`**         | The map. Apps (`shop`), their environments (`prod`, `staging`), the **sources** of each environment, and the **settings** each addon gets there.                           | You write it once per system.                            |
| **Sources**                   | Text-like evidence the assistant searches: log files today, more types through addons. Listed per environment under `sources`.                                             | A log file, or the logs of a service.                    |
| **`addons/`**                 | Adapters. Each one connects a place (a database, Datadog, GitHub, your API) and gives the assistant tools to read it (`order.getOrder`). [Write an addon](/addons).        | One folder per system you want read.                     |
| **`playbooks/`**              | A how-to for the assistant, and a runbook for a person on call: the order of investigation and what your names mean. [Write a playbook](/playbooks).                       | A few lines each, grown after each incident.             |
| **`logs/`, `data/`**          | The demo's fake backend: sample logs, recorded orders, metrics and health checks. The demo addons read them instead of a real system.                                      | Not needed. Your addons call the real thing.             |
| **`docker/`, `package.json`** | Optional, for the database demo: a PostgreSQL to start, and the driver (`pg`) the `_shopdb` addon needs. [Try it](/database).                                              | Your packages go in your workspace's own `package.json`. |
| **`scenarios/`**              | A test script for the demo: the question, the expected tool calls, the expected conclusion. **The assistant never reads it.** A test replays it so the demo stays correct. | Not needed.                                              |

## The words

- **App**: a system you investigate (`shop`). **Environment**: where it runs
  (`prod`, `staging`). Evidence belongs to an environment, so a question about prod is never answered from staging. When a question does not say, the assistant asks.
- **Source**: a place searched by text, listed in the configuration.
- **Addon**: a folder that adds tools for a place that needs more than a text
  search. It has settings, per environment.
- **Playbook**: how your team investigates a kind of problem.
- **Evidence**: one thing found, with its time and a readable line, which the
  assistant quotes in its conclusion.

## Start from nothing

```bash
# from the help-me-ops clone
npm run ops -- init workspace ../my-app/ops --app my-app --envs prod,staging
```

It creates the folder with an `ops.config.json` (your app and environments, no
sources yet), a starter playbook to copy, an `addons/` folder with a note, and a
README listing what each file is for. It never overwrites: if any of those files
exists, nothing is written. It ends by printing what to do next: point
`OPS_WORKSPACE` at the folder, add a log file or an addon, run `doctor`.

## Start from the demo

1. Copy `examples/my-workspace` to `ops/` in your app's repository.
2. In `ops.config.json`, rename the app and environments, and point `sources`
   at your logs.
3. Keep the `order`, `metrics` and `health` addons as templates: change what
   `tools.ts` reads from a recorded file to your real, read-only system, one at a
   time.
4. Edit the playbook to your system's words.
5. Delete `data/`, `logs/` and `scenarios/` when your addons no longer read them.
