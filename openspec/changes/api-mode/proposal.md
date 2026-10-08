# API mode and local models

Status: proposal, for review. Decision record: [ADR 0014](../../../docs/adr/0014-api-mode-and-local-models.md).
Nothing here is built yet.

## Why

Today help-me-ops is a toolbox that an AI client calls over MCP, and the client's
model does the reasoning. Three things that cannot be done that way:

- keep every byte on your own network, with a model you run;
- investigate with no person at a chat (an alert, a cron job, CI);
- find out whether a given model, hosted or local, is good enough for _your_
  systems, instead of guessing.

## The ways to run, side by side

|                                 | Who talks to the model                                         | Model                        | What we add                                           | Status                             |
| ------------------------------- | -------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------- | ---------------------------------- |
| **A. MCP client, hosted model** | Claude Code, Codex, Copilot                                    | theirs, on your subscription | nothing: this is today                                | works                              |
| **B. MCP client, local model**  | another MCP client that can use Ollama, LM Studio and the like | yours, local                 | nothing from us; we cannot test or support the client | possible today, unverified here    |
| **C. `ops ask`, local model**   | help-me-ops itself, over HTTP                                  | yours, local                 | the loop, limits, tests, `doctor`, docs               | **this proposal**                  |
| **D. `ops ask`, hosted API**    | help-me-ops itself                                             | a provider's, with your key  | same loop, different `baseUrl`                        | **this proposal** (same code as C) |

A stays the best experience for a person: a conversation, follow-up questions, the
client's own polish. C and D are for a closed network, for scripts, and for
measuring. D is free once C exists, since only the URL differs, and its data goes
to that provider exactly as in A.

## How `ops ask` works

```
ops ask "order 4512 is stuck"
   │
   ├─ builds the conversation
   │    system : the method (the same text the MCP server gives), the workspace,
   │             the privacy rules (what a placeholder is, strict mode)
   │    user   : the problem
   │
   └─ loop, at most maxSteps times
        ├─ POST {baseUrl}/chat/completions  { model, messages, tools }
        │     tools = the toolbox: scope, listSources, searchSource, addon tools,
        │             searchKnowledge, getPlaybook, checkConclusion (as JSON Schema)
        ├─ the model answers with tool calls, or with text
        ├─ each tool call runs through the real toolbox
        │     (read-only, masked, strict mode, recorded in the ledger)
        ├─ the results are appended to the conversation
        └─ stop when checkConclusion accepts, or a limit is hit
   │
   └─ prints the checked report (stdout), the steps (stderr); exit 0 only if accepted
```

There is no hidden intelligence in the loop: it sends the conversation, runs the
tools the model asks for, and stops. Everything that makes an answer trustworthy
is the same code as with an MCP client: the tools, the mask, the ledger, and the
conclusion check, which refuses a quote no tool returned.

### What the person types and sees

```
$ ops ask "order 4512 is stuck" --env prod
step 1  scope                      → shop / prod
step 2  listPlaybooks              → order-stuck
step 3  getPlaybook order-stuck
step 4  order.getOrder 4512        → awaiting_payment since 09:12
step 5  searchSource app-logs      → 3 lines (payment-webhook 503)
step 6  checkConclusion            → accepted
─────────────────────────────────────────────
Cause: …   Certainty: likely   Evidence: …   Next step: …
```

It is one question, one answer. A conversation is what clients are for; a REPL can
come later if it is wanted.

## Is a CLI enough, or a prompt too?

- **`ops ask` is a CLI command, non-interactive.** That is the whole of the first
  version, on purpose: it covers scripts and a quick question in a terminal, and
  an interactive loop doubles the work (history, context trimming, display).
- **The prompt in an AI client** (A and B) stays as it is.
- **A REPL (`ops chat`)** is possible later on the same loop. It is not promised.

## Will the performance be poor?

Honest answer: **it depends on the model, and we have not measured any.** What can
be said from how these models generally behave, to be confirmed by `ops eval`:

| Likely problem with a small local model           | Why it matters here                                                          | What the design does about it                                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Malformed or missing tool calls                   | the loop depends on `tool_calls`                                             | validate each call against the tool's schema, feed the error back, count it as a step; stop after a few in a row              |
| Calls the same tool in a circle                   | wastes the budget                                                            | refuse an identical repeated call with "already answered, here is the result", then stop                                      |
| Forgets the method, skips `scope` or the playbook | worse investigations                                                         | the loop can do the first steps itself (see _guided mode_)                                                                    |
| Long evidence overflows the context               | small contexts (often 4k–32k tokens)                                         | cap results, drop bulky `data` for the model and keep the `summary` lines it quotes, trim old tool results                    |
| Invents a cause or a quote                        | the worst failure                                                            | `checkConclusion` refuses a quote no tool returned; the refusal says what is missing and the loop gives the model a few tries |
| Slow                                              | CPU inference can be a few tokens per second, and the prompt grows each step | keep the conversation append-only so a server's prompt cache can reuse it; `maxSteps`; report time and tokens per run         |

Cost and speed, in a word: a hosted model is fast and good and sends the evidence
away; a local one keeps it and is slower and, for small sizes, less reliable at
multi-step tool use. Which side of that a team lands on is a measurement:

### `ops eval`: measure, do not guess

```
ops eval --runs 5
scenario stuck-order · model qwen2.5:14b @ http://localhost:11434/v1
  reached a conclusion      5/5
  accepted by the check     4/5
  cause matches expected    3/5
  median steps / tokens     7 / 9,400
  median time               48 s
```

It reuses the scenarios the demo already has (a question and the cause it should
reach) and any a team adds. The numbers are those of the team's own model and
hardware. This is how "is it good enough?" gets answered, and how we tune the
levers below without arguing.

### Guided mode, if the numbers call for it

If small models turn out to skip the method, the loop can do the deterministic
part itself and leave the model the judgement: run `scope`, pick the playbook with
`matchPlaybooks`, put its steps in the first message, and let the model choose
search terms and write the conclusion. It is a flag, not the default, and it is
built only if `ops eval` shows it helps.

## Configuration

An optional block in `ops.config.json`, or flags and environment variables:

```json
"model": {
  "baseUrl": "http://localhost:11434/v1",
  "model": "qwen2.5:14b",
  "apiKey": "${OPS_MODEL_KEY}",
  "maxSteps": 12,
  "temperature": 0
}
```

No default model and no default endpoint: nothing happens until a person writes
this. A key is named by `${VAR}`, never stored, like every credential.

Examples of `baseUrl`, to be verified when built: Ollama `http://localhost:11434/v1`;
llama.cpp's server `http://localhost:8080/v1`; LM Studio `http://localhost:1234/v1`;
a hosted provider or gateway with its own URL and a key. Whether a given model
supports tool calls is the model's property, not ours: Ollama lists the models
that do under a "tools" filter on its model page, and `ops eval` shows how well.

## Privacy and safety

- **Hosted endpoint = same warning as any client.** The evidence goes to that
  provider. `doctor` prints the endpoint and whether it is this machine, a private
  address or an outside host.
- **Local endpoint = nothing leaves the network**, which is the point. The mask and
  strict mode still apply, and are a good habit even then (logs of the model server,
  shared machines).
- **Read-only holds.** The loop has no tool but the toolbox's, and none writes
  (ADR 0002). The call to the model is not a call to the system under
  investigation.
- **Prompt injection is real and bounded.** A log line can contain "ignore your
  instructions". The system prompt says evidence is data, and the harm is limited
  to reading more of what the tools can already read, and to a worse conclusion
  that the check still holds to the evidence of the session.
- **Limits on cost**: `maxSteps`, a token budget and a timeout, all with defaults.
- **Stable placeholders and the mask** apply in the loop through the same wrapper:
  the model sees `user-3f2a`, and a placeholder it gives back is restored for the
  tool.

## What changes

- `src/agent/` (new): the loop, the OpenAI-compatible client (fetch, zod), limits,
  the repeated-call guard, the report. Imported by `ops ask` and `ops eval` only.
- The method text moves from `src/mcp.ts` to a shared module used by both doors.
- `ops ask`, `ops eval`; a `model` block in the config; `doctor` prints the
  endpoint.
- A scripted fake chat server for tests, in the same style as the mocks.
- Scenarios get an `expect` (the words the cause must contain) so `ops eval` can
  tell a match from a miss.
- Guide: "Run it without an AI client" and "Use a local model", with the
  performance caveats above. README, site, ROADMAP.

Out of scope: shipping or fine-tuning a model, a REPL, streaming output of the
model's text, native Anthropic or Google wire formats (adapters later), embeddings.

## Phases

1. **Loop and `ops ask`** with the fake server tests, shared method text, `doctor`.
2. **`ops eval`** and scenario expectations. First real numbers, measured by the
   maintainer on named models and hardware, go in the guide with the date and
   setup, or not at all.
3. **Tuning from the numbers**: guided mode, context trimming, an Anthropic
   Messages adapter, a REPL, only the ones the numbers or the users justify.

## Open questions for review

1. Is one-shot `ops ask` the right first step, or is a REPL wanted from day one?
2. Support hosted endpoints in the first version (it costs nothing extra), or
   document local only and add hosted later?
3. Where does the model belong, `ops.config.json` (shared with the team) or only
   flags and environment (per person)? Proposal: both, flags win.
4. Should a workspace be able to **forbid** a non-local model (`privacy.requireLocalModel`)
   so a team's rule is enforced, not just printed? Not in this proposal; easy to add.
5. Default `maxSteps` and token budget: proposal 12 steps and a budget set from the
   model's context size; to be tuned by `ops eval`.
