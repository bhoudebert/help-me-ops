# Investigate a problem

Describe the problem as it was reported, with the identifiers you have: an
order number, a user, an error code, a time.

## What the assistant does

1. **Finds your playbook** for that kind of problem and follows its steps.
2. **Searches your sources** for the identifiers, narrowing the time window as
   it learns.
3. **Builds a timeline**, oldest first, each line quoting its source and time.
4. **Concludes, and has the conclusion checked**: the most likely cause, how
   sure it is, the evidence it rests on, what is still unknown, and the next
   step for a person. Every quote is checked against what the tools returned
   ([below](#a-conclusion-that-is-checked)).

It never changes your system: a fix ("replay the payment webhook") is
proposed for you to make.

## Example

In the [demo](/demo), "client u-881 paid but cannot find order 4512" leads to
the order (`awaiting_payment` since 09:58), the payment webhook refused with a
503 at 10:00 while the provider answered 200, a queue past 1000 jobs, and the
confirmation worker OOMKilled at 10:01, after release 2.14.0. The same release
is fine in staging. Which environment a question is about is the first thing
the assistant settles (`scope`); when you do not say, it asks.

## A conclusion that is checked

An assistant can be fluent and wrong. So before it answers, it gives its
conclusion to a tool, `checkConclusion`, which holds everything the tools
returned in this session and **refuses a conclusion that quotes anything else**.
It asks for:

| Field        | What                                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `cause`      | the most likely cause, in a sentence or two                                                                                            |
| `certainty`  | `confirmed`, `likely` or `unknown`                                                                                                     |
| `evidence`   | for each: its `source` (`app-logs`, `order`, `metrics` ...), its `at` time (or null), and a `quote` copied from what the tool returned |
| `unknowns`   | what the evidence does not settle                                                                                                      |
| `next`       | the next step, **for a person**: the assistant changes nothing                                                                         |
| `app`, `env` | what the conclusion is about                                                                                                           |

What it refuses, and says so naming the quote:

- a **quote no tool returned**: `quote not found in anything a tool returned this session: "the database was down for ten minutes"`;
- a quote attributed to the **wrong source** (`comes from app-logs, not from metrics`) or the **wrong time**;
- a conclusion about **prod standing on staging evidence** (`comes from staging, and the conclusion is about prod`), or one that does not say which environment when the session read two;
- `confirmed` on **a single source** (it needs two that agree), and any conclusion but a confirmed one with **no unknowns**;
- a quote too short to prove anything (under 8 characters).

When it accepts, it returns **one report layout for every client** (Claude Code,
Codex, Copilot), and the assistant gives you that report as it is:

```
## Conclusion: likely (shop / prod)

**Cause.** The payment webhook for order 4512 was refused with a 503 because the
payment-confirm queue was full; the shop-worker, slowed by growing memory since
release 2.14.0, was then OOMKilled.

**Evidence**, oldest first:
- 2026-10-07T09:50:14Z · app-logs · 41 jobs/min (190 jobs/min before 2.14.0)
- 2026-10-07T10:00:02Z · app-logs · webhook endpoint /hooks/acme-pay returned 503 ...
- 2026-10-07T10:01:04Z · app-logs · container shop-worker-1 OOMKilled (exit 137), restart 1

**Still unknown**
- Whether release 2.14.0 introduced a memory leak or only exposed a limit too low.

**Next step, for a person.** Restart or scale shop-worker, then replay the webhooks.
```

This does not make the assistant right: it makes it **unable to cite what it
did not see**, and visible when it is unsure. The reasoning is still the model's.
The check is part of the toolbox, so it works the same from any client; the
[demo](/demo) conclusion is replayed through it in the tests.
