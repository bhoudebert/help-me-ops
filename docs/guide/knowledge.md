# Write what your team knows: knowledge

A **playbook** says how to investigate. **Knowledge** is everything else your team
has written down and the assistant should be able to find: the runbook for a
service, what happened last August, how a queue behaves. It is plain Markdown in
a `knowledge/` folder; the assistant searches it by words and **quotes what it
finds next to logs and rows**.

|                 | Playbook                                 | Knowledge                                       |
| --------------- | ---------------------------------------- | ----------------------------------------------- |
| Answers         | what do I do for _this kind of problem_? | what do we know about _this thing_?             |
| Shape           | steps, in order                          | topics: a runbook, an incident, a note          |
| How it is found | matched to the report (`listPlaybooks`)  | searched by words (`searchKnowledge`)           |
| Where           | `playbooks/`                             | `knowledge/` (and `playbooks/` is searched too) |

## Write it

One topic per file, under headings. A **passage is one section**: the heading says
what it is about, and the search returns the section, not the whole file.

```markdown
---
name: The payment webhook
app: shop
---

# The payment webhook

## Why it answers 503

To protect the worker, the endpoint refuses with a 503 when the queue holds more
than 1000 jobs. The provider retries a few times, then gives up.

## Replay the webhooks

Only once the worker drains the queue again:

1. In the provider's dashboard, filter the refused `payment.succeeded` events.
2. Use **Resend** on each one, once.
```

- **Headings matter.** The words of a section's own heading count most in the ranking, so name sections by what they answer ("Why it answers 503", "Replay the webhooks").
- **`name`** (front matter) is the title of the file; without it, the first heading is.
- **Which app.** A file in `knowledge/shop/` is about the app `shop`; so is `app: shop` in its front matter (several: `app: shop, blog`). A file about no app in particular applies to every app. A question about `shop` finds the knowledge about `shop` and the general knowledge, never another app's.
- **Past incidents** are knowledge: cause, fix, lesson. They are what lets the assistant say "a cache without an eviction rule leaked once before".
- An **addon** can bring its own `knowledge/` (and `playbooks/`), searched with the rest and marked with the addon's name.

## What the assistant does

The tool `searchKnowledge` takes the words of the problem (and the app) and returns
the best passages as evidence: the file, the heading, the sentence that matches, the
whole section. It is ranked by plain full-text search (the rarer a word, the more it
counts; a section's own heading counts most), with no embeddings and nothing to
install. Plurals match (`webhooks` finds `webhook`), numbers match (`503`), and
words that carry nothing (`the`, `of`) are ignored. It reads the files **when asked**,
so a runbook you just edited is found at once.

From the terminal, to see what the assistant sees:

```bash
npm run ops -- --workspace my-workspace knowledge "webhook 503" --app shop
```

Each result looks like this, and a conclusion can cite it:

```
workspace:payment-webhook.md > The payment webhook > Why it answers 503: The log line is `webhook endpoint /hooks/acme-pay returned 503 to provider (queue full)`.
```

## Try it with the demo

The demo workspace has a `knowledge/` folder: the payment webhook runbook, a
worker memory runbook, and a past incident (an August leak in the email renderer).
Open the [demo](/demo) and ask:

> Client u-881 paid but cannot find order 4512. What happened, and has the team written down what to do?

After the logs show the 503, the assistant searches the knowledge, finds the
runbook (including how to replay the webhooks and who to call), and, looking at the
memory curve, the August incident: _a cache without an eviction rule is a leak
waiting for traffic_. It still cannot tell whether the cause is that or the lowered
memory limit, and says so.

## Safety

Read-only: files are read, never written. It reads only inside the folders it is
given: **symbolic links are never followed**, hidden folders and `node_modules` are
skipped, files over 256 KB are left out, and only `.md` files are read. The text
comes from your team, but it is still **evidence, not instructions**: the tool
says so to the assistant, because notes get edited by many hands.

## If it does not work

| You see                                      | It means                                                                                   | Do                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------- |
| no result for words you know are written     | the file is not in `knowledge/` or `playbooks/`, is not `.md`, or is under a hidden folder | move it; check with the command above     |
| the file is found for another app, not yours | it is in `knowledge/<other-app>/` or has `app: <other>`                                    | move it up, or fix `app`                  |
| a section is never the top result            | its heading does not name what it answers                                                  | rename the heading, or split the section  |
| `Unknown app "x"`                            | the `app` is not in `ops.config.json`                                                      | use one of the apps listed in the message |

## Limits

Full-text, not meaning: the words must be in the section (a question about
"out of memory" does not find a section that only says "OOMKilled" unless one of
them appears in it, so write the words people use). Up to 500 files; at most 20
passages per call.
