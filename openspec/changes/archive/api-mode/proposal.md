# API mode and local models

Status: built (chat, ask, eval); archived. The requirements are in `openspec/specs/api-mode`. Decision record: [ADR 0014](../../../../docs/adr/0014-api-mode-and-local-models.md).

## Why

Today help-me-ops is a toolbox that an AI client calls over MCP, and the client's
model does the reasoning. Three things that cannot be done that way:

- keep every byte on your own network, with a model you run;
- investigate with no person at a chat (an alert, a cron job, CI);
- find out whether a given model, hosted or local, is good enough for _your_
  systems, instead of guessing.

## The ways to run, side by side

|                                                        | Who talks to the model                                         | Model                                    | What we add                                           | Status                             |
| ------------------------------------------------------ | -------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------- | ---------------------------------- |
| **A. MCP client, hosted model**                        | Claude Code, Codex, Copilot                                    | theirs, on your subscription             | nothing: this is today                                | works                              |
| **B. MCP client, local model**                         | another MCP client that can use Ollama, LM Studio and the like | yours, local                             | nothing from us; we cannot test or support the client | possible today, unverified here    |
| **C. `ops chat` / `ops ask`, a model on your network** | help-me-ops itself, over HTTP                                  | yours: this machine or a company server  | the loop, limits, tests, `doctor`, docs               | **this proposal**                  |
| **D. `ops chat` / `ops ask`, any other URL**           | help-me-ops itself                                             | a gateway or a provider's, with your key | same loop, different `baseUrl`                        | **this proposal** (same code as C) |

A is still the richest experience (the client's own polish). C and D give the
same conversation without a client, for a closed network, for scripts, and for
measuring. D costs nothing once C exists, since only the URL differs, and its data
goes to whoever runs that URL exactly as in A. There is no built-in provider and no
free tier we depend on: the endpoint is any URL the person writes.

## How it works (`ops chat`, and `ops ask` for one question)

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

`ops chat` is a conversation, like the prompt of an AI client:

```
$ ops chat --env prod
you ▸ order 4512 is stuck
  step 1  scope                      → shop / prod
  step 2  getPlaybook order-stuck
  step 3  order.getOrder 4512        → awaiting_payment since 09:12
  step 4  searchSource app-logs      → 3 lines (payment-webhook 503)
  step 5  checkConclusion            → accepted
assistant ▸ Cause: …   Certainty: likely   Evidence: …   Next step: …
you ▸ and did it happen to other orders?
  step 6  searchSource app-logs      → 41 lines
assistant ▸ …
you ▸ /exit
```

The session (the evidence seen, the ledger) carries on across turns, so a later
conclusion can cite an earlier result. `/reset` starts over, `/exit` leaves. The
conversation is in memory and gone at the end.

`ops ask` is the same loop for one question, with no person to answer:

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

It prints the checked report on stdout and exits 0 only when the check accepted the
conclusion, so a script or a scheduled job can use it.

## Terminal chat, one-shot, or a client's prompt?

- **`ops chat`** is the conversation in the terminal, with a model you configure.
- **`ops ask`** is one question and one checked answer, for scripts.
- **The prompt in an AI client** (A and B) stays as it is.

A conversation has a cost the one-shot does not: it must fit the model's context
over many turns. When it fills, the loop drops the oldest tool results first (keeping
the questions, the answers and the conclusions), and says so. This matters most
for small local models, and is what `ops eval` has to exercise (a scenario can have
follow-up questions).

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
  "maxSteps": 20,
  "temperature": 0
}
```

Flags and environment variables do the same per person and win over the file
(`--model`, `--base-url`, `OPS_MODEL_URL`, `OPS_MODEL_KEY`).

No default model and no default endpoint: nothing happens until a person writes
this. A key is named by `${VAR}`, never stored, like every credential.

Examples of `baseUrl`, to be verified when built: Ollama `http://localhost:11434/v1`;
llama.cpp's server `http://localhost:8080/v1`; LM Studio `http://localhost:1234/v1`;
a hosted provider or gateway with its own URL and a key. Whether a given model
supports tool calls is the model's property, not ours: Ollama lists the models
that do under a "tools" filter on its model page, and `ops eval` shows how well.

## Developing and testing without spending money

Nobody pays for this project, so no part of building or checking it needs a paid
API. Three layers, each free:

| Layer                                    | What it runs                                                                                                                                        | Cost                                 | In CI?                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------- |
| **1. Scripted fake server**              | A small server that speaks the chat wire format and replays a script: good runs, malformed tool calls, endless loops, refused conclusions, timeouts | nothing, milliseconds, deterministic | **yes, gates every PR** (rule 5: tests never call a model) |
| **2. A real model on your machine**      | `ops eval` against Ollama (or llama.cpp, LM Studio) on `localhost`, via a script `npm run eval:local`                                               | electricity                          | no: slow, and the answer varies run to run                 |
| **3. A tiny model in a manual workflow** | A GitHub-hosted runner (free for a public repository, CPU only) with a very small model, to check the wire format against a real server             | nothing                              | optional `workflow_dispatch`, never gating                 |

- **Layer 1 proves the loop**: limits, malformed calls, trimming, the allowlist, the
  guards. It cannot say whether a model is _good_, and does not try.
- **Layer 2 answers "is it good enough?"**. A real model is not deterministic, so
  its results are numbers to read (`ops eval --runs 5`), not assertions to fail a
  build on. For people without Ollama, a `compose.llm.yml` starts one in a
  container with the models in a cached volume (a GPU needs the NVIDIA container
  toolkit; on CPU alone it works and is slow).
- **Layer 3 is a smoke test only**: a 1–3 billion parameter model is too weak to
  investigate, but enough to see that the request, the tool calls and the answer
  go through a real server. It downloads the model on each run, so it is manual.
- **Paid APIs are never required.** Anyone may point `baseUrl` at a hosted provider
  (DeepSeek and Kimi both sell APIs, which are cheap, not free); nothing in the
  repository's tests or workflows does.

### Which models to try first

Locally, on the maintainer's machine (an RTX 5080 with 16 GB of video memory, 60 GB
of RAM), models up to roughly 14 billion parameters at 4-bit quantisation fit in
the GPU and answer at a usable speed; larger ones spill to RAM and slow down a lot.
So:

- **DeepSeek and Kimi are open-weight, but their flagship models are far too large**
  for a normal machine (hundreds of billions to about a trillion parameters). What
  runs locally are the smaller models from the same labs, for example DeepSeek-R1
  distilled into 7B–14B, if the Ollama library lists them. These are _reasoning_
  models that write a long "thinking" before answering: slower, and their
  tool-call format sometimes differs. They are worth testing, not assuming.
- **Candidates to run through `ops eval` first**, because Ollama lists them with
  tool support: Qwen 2.5 and Qwen 3 (7B–14B), Llama 3.1 8B, Mistral 7B, plus one
  DeepSeek-R1 distill for comparison. Whether each handles our multi-step tool use
  is exactly what is unknown, and what the first measurement is for.
- **The first numbers are measured on this machine** and published with the model,
  quantisation, hardware and date, as a table in the guide: what one setup did, not
  a promise for yours.

## Privacy and safety

- **Any URL, so say where it is.** `doctor` prints the endpoint and whether it is
  this machine, a private address or an outside host; for an outside one, the
  evidence goes to whoever runs it, as with any client.
- **A team can forbid it.** `privacy.modelHosts` lists the hosts the model may be
  at: `"local"` (this machine and private-network addresses written as IP
  literals) and company hosts by name. A model outside the list is refused at
  start, with the list in the message. Absent, every host is accepted.

  ```json
  "privacy": { "modelHosts": ["local", "llm.company.internal"] }
  ```

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
- `ops chat`, `ops ask`, `ops eval`; a `model` block and `privacy.modelHosts` in the config; `doctor` prints the
  endpoint.
- A scripted fake chat server for tests, in the same style as the mocks.
- Scenarios get an `expect` (the words the cause must contain) so `ops eval` can
  tell a match from a miss.
- Guide: "Run it without an AI client" and "Use a local model", with the
  performance caveats above. README, site, ROADMAP.

Out of scope: shipping or fine-tuning a model, saving conversations (case files), streaming output of the
model's text, native Anthropic or Google wire formats (adapters later), embeddings.

## Phases

1. **Loop, `ops chat` and `ops ask`** with the fake server tests, context trimming over turns, `privacy.modelHosts`, shared method text, `doctor`.
2. **`ops eval`** and scenario expectations. First real numbers, measured by the
   maintainer on named models and hardware, go in the guide with the date and
   setup, or not at all.
3. **Tuning from the numbers**: guided mode, better context trimming, an Anthropic
   Messages adapter, only the ones the numbers or the users justify.

## Decided at review

1. **Chat first.** `ops chat` is the main experience, like the prompt of a client;
   `ops ask` is the one-shot form for scripts.
2. **Any URL.** The endpoint is whatever the person writes (local, company,
   public); no provider is built in and no free tier is relied on.
3. **Model settings** in `ops.config.json` for the team and in flags and
   environment variables per person, flags winning.
4. **A workspace can restrict where the model is** with `privacy.modelHosts`.
5. **Limits** (steps, token budget, context trimming) start with provisional
   defaults (20 steps; a budget from the model's context size) and are tuned with
   `ops eval` once there are numbers.
