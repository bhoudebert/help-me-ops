# Try the demo

No system of your own needed. The repository ships a small world to
investigate: **shop**, an online shop with a `prod` and a `staging`
environment, its logs, its orders, its metrics and its health checks, all
recorded as files. It is also the template for your own workspace.

## The story

At 09:58 on 7 October, customer **u-881** pays for order **4512**. The payment
provider confirms, but the order never leaves `awaiting_payment`. At 10:16 the
customer opens a support ticket: _paid but no order in my account_.

Behind it, spread across four sources:

- the release **2.14.0** of the confirmation worker went out at 09:31;
- the worker slowed down, its memory climbed to the container limit, and the
  `payment-confirm` queue backed up past 1000 jobs;
- at 10:00 the shop's webhook endpoint started refusing the provider's
  `payment.succeeded` with a **503** (queue full), while the provider itself
  answered `200`;
- at 10:01 the worker was **OOMKilled**, and kept restarting;
- orders 4513 and 4514 are stuck the same way. **Staging runs the same release
  and is fine.**

Nobody tells the assistant any of it. It has to find it.

## Run it

Pick a client. Each one is already pointed at the demo workspace.

::: code-group

```bash [Claude Code]
cd help-me-ops && claude      # approve the "help-me-ops" MCP server
```

```text [Copilot (VS Code)]
Open the folder; start the server from the MCP view; use Copilot Chat in agent mode.
```

```toml [Codex]
# see "Claude Code, Codex and Copilot" for the config.toml entry,
# with OPS_WORKSPACE = "/abs/path/help-me-ops/examples/my-workspace"
```

:::

Then ask, in plain words:

```text
Client u-881 paid but cannot find order 4512. What happened?
```

## What you should see

The assistant follows the shop's [playbook](/playbooks), step by step:

1. **`scope`**: the shop, and which environment? Your question names none, so it
   asks, or it takes `prod` if you said "in production".
2. **`order.getOrder`**: order 4512 is `awaiting_payment` since 09:58:13.
3. **`searchSource`** on `app-logs`: the payment session, the redirect back, and
   the webhook that never arrived; then the 503 at 10:00:02.
4. **`health.checkHealth`**: the provider answers `200`, the shop's
   `/hooks/acme-pay` answers `503`. The refusal is ours.
5. **`metrics.queryMetric`**: queue depth 12 → 620 → 1240, worker memory 212 MB →
   512 MB, the container limit.
6. **`searchSource`** again for `worker` and `deploy`: release 2.14.0 at 09:31,
   the backlog warning at 09:50, `OOMKilled` at 10:01.
7. **`order.listOrders`**: orders 4512, 4513 and 4514 are all `awaiting_payment`.
8. **Staging**, for contrast: same release, memory flat at about 200 MB.

And it concludes, quoting each line with its source and time:

> **Likely cause**: the payment webhook was refused (503) because the
> confirmation queue was full; the worker, slowed by growing memory since
> 2.14.0, was then OOMKilled. **Unknown**: whether 2.14.0 leaks memory or the
> limit is too low for the load, since staging has no pressure. **Next step**
> (for a person): restart or scale the worker, replay the webhook for 4512,
> 4513 and 4514, tell u-881.

Its conclusion is **checked** before you see it: every quote must be a line a tool
returned in this session ([how](/investigate#a-conclusion-that-is-checked)). It does
not replay anything itself: nothing in help-me-ops can change a system.

## With a real database

The same story runs on a real PostgreSQL in Docker, where the assistant finds that
the three customers **paid** (165.20 EUR) and have no order:
[same investigation, with a real database](/database).

## Watch it first: `ops demo`

No client, no model, nothing to set up:

```bash
npm run ops -- demo
```

It takes a scenario of the demo workspace (by default `scenarios/stuck-order.json`: the
question, the calls an investigation makes, the conclusion; `--scenario` picks another) and replays it through
the **real tools**: each step is printed with what the tool answered (the first
four pieces of evidence, with their time), and it ends with the conclusion passed
through the **same check** an assistant's conclusion goes through. If a quote were
not returned by a tool, it prints `REFUSED` with the problems and exits with a
non-zero code, so it also serves as a smoke test of an install.

| Option              | What                                                                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `--scenario <id>`   | which scenario, when `scenarios/` has several                                                                                      |
| `--pace <ms>`       | pause between steps (350 in a terminal, none when piped); `--pace 0` prints at once                                                |
| `--workspace <dir>` | replay a scenario of another workspace. Without it the demo always uses the shipped one, even when `OPS_WORKSPACE` points at yours |

Colours appear in a terminal and not when the output is piped or `NO_COLOR` is set.
If you add a `privacy.mask` to the demo configuration, the demo shows the stars:
and its conclusion, which quotes the unmasked line, is refused, as it should be.

## Three incidents in one world

The demo shop holds three different incidents, each a scenario you can replay with `ops demo --scenario <id>`, and the assistant can investigate any of them by asking:

| Scenario                    | The question                                                                            | The cause is, in short                                                                                   |
| --------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `stuck-order` (the default) | "Client u-881 paid but cannot find order 4512"                                          | a refused webhook, a full queue, a worker killed for memory since release 2.14.0                         |
| `slow-checkout`             | "Checkout has been very slow since this afternoon and some customers get timeouts"      | release 2.15.0 added a search with no index; a dashboard polls it; the database connection pool fills up |
| `missing-emails`            | "Customers say they stopped receiving their order confirmation emails since last night" | the mail provider's TLS certificate expired at midnight; nothing of ours changed                         |

They differ on purpose (a deploy and a resource limit, a missing index under load, an expiry), so a model is measured on [causes it has not been tuned to](/local-models#measure-it-ops-eval). Only the first has a playbook and runbooks: the other two have to be found from the evidence.

## Without a model

The same tools work from the terminal, to see what the assistant sees:

```bash
export OPS_WORKSPACE=examples/my-workspace
npm run ops -- scope "orders are stuck in production"
npm run ops -- search app-logs order=4512 --env prod
npm run ops -- doctor     # first line: which workspace is loaded
```

## Things to try

- Ask about **staging**: "is the payment worker healthy on staging?"
- Ask something **vague**: "the shop is slow". It should ask which environment.
- **Break the fault**: edit `examples/my-workspace/data/prod/metrics.json`, and see
  the conclusion lose its evidence.
- **Break an addon**: set `"apiVersion": 2` in `addons/health/addon.json`, restart,
  and run `doctor`. The addon is skipped with its reason, and the rest works.

## Make it yours

The demo is a workspace: `ops.config.json` (apps, environments, sources),
`playbooks/`, `addons/`. Copy `examples/my-workspace` to your own repository, and
replace the fixtures one source at a time:

- [Connect your sources](/connectors): logs first, they need no code.
- [What is in a workspace](/workspace): each folder of the demo, and which
  ones you can delete.
- [Write an addon](/addons): `order`, `metrics` and `health` in the demo are
  templates; each says in its `tools.ts` what to swap for the real client.
- [Write a playbook](/playbooks) for the problem you investigate most often.
