# Without an AI client: a model of your own

`ops chat` and `ops ask` run the investigation from the terminal, with a model **you** choose: one on your machine (Ollama, llama.cpp, LM Studio, vLLM), one in your company, or any provider that speaks the OpenAI-compatible chat API. The tools, the playbooks, the mask and the checked conclusion are the same ones Claude Code, Codex and Copilot use; only who talks to the model changes.

::: tip When to use which
In an AI client you get the best conversation. Here you get **a model that never leaves your network** (when it is a local one), **scripts and scheduled jobs**, and a way to **measure** a model. Nothing here is needed to use help-me-ops: no model is called unless you configure one and run one of these commands.
:::

## Set it up

Start your model server. With [Ollama](https://ollama.com):

```bash
ollama pull qwen3:8b          # a model that supports tools
ollama serve                  # if it is not already running
```

Tell help-me-ops where it is, in `ops.config.json` (shared by the team):

```json
"model": {
  "baseUrl": "http://localhost:11434/v1",
  "model": "qwen3:8b"
}
```

or per person, with flags and environment variables, which win over the file:

```bash
npm run ops -- chat --base-url http://localhost:11434/v1 --model qwen3:8b
OPS_MODEL_URL=http://localhost:11434/v1 OPS_MODEL=qwen3:8b npm run ops -- chat
```

| Setting           | What                                                                                                                                                                                                                                                                                                                               | Default  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `baseUrl`         | The chat endpoint, up to and including `/v1`. Any URL: this machine, a company server, a provider.                                                                                                                                                                                                                                 | none     |
| `model`           | The model's name on that server.                                                                                                                                                                                                                                                                                                   | none     |
| `apiKey`          | Name it as `${VAR}`; `OPS_MODEL_KEY` also works. Never written in the file.                                                                                                                                                                                                                                                        | none     |
| `reasoningEffort` | `none`, `low`, `medium` or `high`, sent as `reasoning_effort`. Also `--reasoning` and `OPS_MODEL_REASONING`. `none` turns off the long thinking of models like Qwen 3 on Ollama and makes each step much faster; leave it out for servers that do not accept it. Whether the investigation stays as good is for `ops eval` to say. | not sent |
| `maxSteps`        | Most rounds of tool calls for one question (`--max-steps`).                                                                                                                                                                                                                                                                        | 20       |
| `temperature`     | 0 is the most repeatable.                                                                                                                                                                                                                                                                                                          | 0        |
| `contextTokens`   | The model's context. When a conversation outgrows 80% of it, the oldest tool results are dropped (and you are told). Set it to what your server really gives the model.                                                                                                                                                            | 16000    |
| `budgetTokens`    | Most tokens one question may use, all requests together.                                                                                                                                                                                                                                                                           | none     |
| `timeoutMs`       | Per request. A big model on a CPU can be slow.                                                                                                                                                                                                                                                                                     | 300000   |
| `retries`         | After a `429` (rate limit) or a `502`, `503`, `504`, ask again this many times, waiting longer each time, or as long as the `Retry-After` header says (up to 30 s). A hosted provider will send these; a local server hardly ever does. `0` turns it off.                                                                          | 2        |
| `retryDelayMs`    | The first wait before a retry, in milliseconds; it doubles each time.                                                                                                                                                                                                                                                              | 1000     |

There is no default model and no default address: nothing happens until you write them.

## Chat

```
$ npm run ops -- chat --env prod
help-me-ops chat: qwen3:8b at http://localhost:11434/v1, workspace …/my-workspace. Describe the problem. /reset starts a new conversation, /exit leaves.
you ▸ order 4512 is stuck
  step 1  scope {"question":"order 4512 is stuck"} → …
  step 2  order.getOrder {"env":"prod","id":"4512"} → 1 evidence
  …
  step 6  checkConclusion {…} → accepted
assistant ▸ Cause: …
you ▸ did it happen to other orders?
```

- The conversation and **the evidence read so far carry on** across your questions, so a later conclusion can cite an earlier result. `/reset` starts a new conversation (the evidence already read still counts for the check). `/exit` leaves.
- The steps go to the error output, the answers to the standard output.
- Nothing is saved: the conversation is in memory and gone when the command ends.
- A request that fails (the server is down) leaves the conversation as it was, so you can ask again.

## Ask: one question, for scripts

```bash
npm run ops -- ask "order 4512 is stuck" --env prod
npm run ops -- ask "the API is slow since 10:00" --json
```

The checked report goes to the standard output, the steps to the error output. The **exit code is 0 only if the conclusion check accepted a conclusion**; a step cap, a budget or a refusal gives 1, so a script can tell. `--json` prints `status` (`concluded`, `answered`, `limit`), the text, the steps and the tokens.

## What keeps it honest

The loop is a few hundred lines with no intelligence of its own. It sends the conversation to your model, runs the tools the model asks for **through the same toolbox as the MCP server**, and stops. So everything that applies elsewhere applies here:

- every tool is [read-only](/connectors), and the loop has no other tool;
- the [mask and the stable placeholders](/privacy), and the [strict mode](/privacy#strict-mode-serve-only-what-is-declared-free-of-it), hide what you said to hide **before the model sees it**;
- the [checked conclusion](/investigate#a-conclusion-that-is-checked) refuses a quote no tool returned. When the check accepts, the run ends and prints the report as the check made it, not as the model paraphrased it;
- a bad tool call (unknown tool, invalid arguments) is answered with the error and counted as a step; an identical call is not run twice; a model that says nothing is asked again twice;
- a run ends at the step cap, the token budget or the request timeout, and says which.

## Where the model is: say it, and restrict it

`npm run ops -- doctor` prints the model line:

```
Model: http://localhost:11434/v1 (this machine: nothing leaves your network), qwen3:8b
Model: https://llm.example.net/v1 (llm.example.net: a named host; the evidence goes to whoever runs it), …
```

With a model that is not yours, the evidence goes to whoever runs it, exactly as with an AI client: the [personal-data page](/privacy) applies unchanged. A workspace can **forbid** it:

```json
"privacy": { "modelHosts": ["local", "llm.company.internal"] }
```

`local` is this machine and private-network IP addresses (`127.0.0.1`, `10.x`, `172.16–31.x`, `192.168.x`, `169.254.x`, `::1`); any other entry is a host name, compared as written (names are not resolved). A model outside the list is refused **before any request**, and the message names the list. Without `modelHosts`, any host is accepted.

## Will it be good enough?

It depends on the model, and a small one will investigate worse than a large hosted one. What to expect from small local models, and what the loop does about it:

| Problem                                                            | What happens                                                                                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| It writes malformed tool calls or calls a tool that does not exist | the error goes back to it; it can correct itself within the step cap                                                                 |
| It calls the same tool in a circle                                 | the repeat is not run; it hits the step cap and the run says so                                                                      |
| It thinks and then says nothing                                    | it is asked again, twice, then the run reports no answer                                                                             |
| The evidence is bigger than its context                            | big results are cut, old ones dropped when the conversation grows, and you are told                                                  |
| It invents a cause or a quote                                      | `checkConclusion` refuses a quote no tool returned, and says what is missing                                                         |
| It is slow (a reasoning model thinks for minutes)                  | you see `asking …` and how long each answer took; set `reasoningEffort` to `none`, narrow the question, use a smaller model or a GPU |

**Ollama's context.** Ollama gives a model a limited context unless you raise it, and silently cuts what does not fit. The method and the tool descriptions take about 2,400 tokens before your question, so give the model at least 8,000 (`OLLAMA_CONTEXT_LENGTH=16384 ollama serve`), and keep `contextTokens` equal to it.

**Is it on the GPU?** `ollama ps` shows the processor and the context in use. A model that says `100% CPU` on a machine with a graphics card means that build of Ollama has no GPU support (on NixOS, a CUDA build of the package is needed): it works, and an 8-billion-parameter model is then very slow.

**Does the model support tools?** Not every model does; Ollama lists those that do under a "tools" filter on [its model page](https://ollama.com/search?c=tools). A model that does not will answer in words and never call a tool.

## Measure it: `ops eval`

Instead of judging from one run, count. `ops eval` asks the scenario's question of your model several times, each in a fresh conversation, and reports what happened:

```bash
npm run ops -- eval --runs 5 --model qwen3:8b --reasoning none,default
npm run ops -- eval --model qwen3:8b,llama3.1:8b --runs 5      # compare models
npm run eval:local                                              # the same on a local Ollama, 3 runs
```

`--model` and `--reasoning` take a comma-separated list, and every combination is run. The columns:

| Column                    | Meaning                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `accepted`                | runs where the conclusion check accepted a conclusion (the model called `checkConclusion` and every quote was real) |
| `cause`                   | runs whose answer names every **required** fact of the scenario's `expect`                                          |
| `facts`                   | how many of the expected facts an answer names, on average                                                          |
| `steps`, `tokens`, `time` | the median over the runs                                                                                            |

Below the table it lists what a setting **never** named, and why runs did not conclude.

A scenario says what a good answer contains in an `expect` block of its JSON file (the demo's `stuck-order.json` has one):

```json
"expect": { "facts": [
  { "name": "the webhook was refused (503)", "any": ["503"], "required": true },
  { "name": "the worker was OOMKilled", "any": ["OOMKilled", "OOM"] }
] }
```

A fact counts when **any** of its words appears in the answer, case ignored. It is a **keyword check, not a judge of reasoning**: an answer can name the right words for the wrong reason, or the right cause in other words. Use it to compare settings, not as a verdict. A scenario without `expect` only counts the conclusion check.

Writing your own scenario: copy `examples/my-workspace/scenarios/stuck-order.json` (a question, the steps of a good investigation for `ops demo`, a conclusion, an `expect`).

Bring your own model server: help-me-ops only needs its URL. Nothing here costs money and nothing is part of the test suite: the tests use a scripted fake server.

**No model at hand?** `npm run mock:model` starts a stand-in that speaks the same API and replays the demo's investigation, so you can try `chat`, `ask` and `eval` with no model, no GPU and no key:

```bash
npm run mock:model &                      # http://127.0.0.1:8099/v1
npm run ops -- ask "order 4512 is stuck" --base-url http://127.0.0.1:8099/v1 --model mock
```

It is not intelligent (any question gets the scenario's investigation); it shows the loop, the check and the report working.

### What one setup measured

The only numbers this project has, from the maintainer's machine on 2026-10-08: an RTX 5080 with 16 GB, Ollama 0.32.14 (CUDA), the demo's `stuck-order` scenario (the question, then "It is the shop app, in the prod environment", since nobody is there to answer when the model asks), 5 runs per setting, temperature 0:

```
setting                          accepted  cause  facts  steps  tokens  time
qwen3:8b · reasoning none        5/5       0/5    1.0/5  13     54,064  8 s
qwen3:8b · reasoning default     5/5       0/5    0.0/5  5      17,838  18 s
qwen3:14b · reasoning none       5/5       5/5    2.0/5  11     51,595  16 s
qwen3:14b · reasoning default    5/5       0/5    0.0/5  6      21,239  40 s
llama3.1:8b · reasoning none     0/5       0/5    0.0/5  1      3,410   1 s
llama3.1:8b · reasoning default  0/5       0/5    0.0/5  1      3,410   1 s
gpt-oss:20b · reasoning low      5/5       0/5    1.0/5  16     74,962  58 s
gpt-oss:20b · reasoning default  1/5       1/5    0.4/5  0      0       56 s
deepseek-r1:7b · either          0/5       0/5    0.0/5  0      1,248   5 s
deepseek-r1:14b · either         0/5       0/5    0.0/5  0      1,377   20 s
```

What to read in it, and what not to:

- **The conclusion check passed far more often than the cause was found.** Four of the six settings were accepted 5 times out of 5, and in three of them no run named the refused webhook or the full queue: they quoted the order row and concluded it was awaiting payment. The check proves a quote is real, not that the cause is right. This is why `cause` and `facts` exist.
- **The best setting here is the larger model with thinking off**: `qwen3:14b` found the direct cause (the 503 refusal and the full queue) in 5 of 5 runs in 16 s. It never found the deeper one (the worker killed for lack of memory after release 2.14.0, and the two other orders).
- **Thinking was slower and no better**: with it on, both Qwen models were accepted but named none of the expected facts, in two to five times the time. A guess is that the thinking makes them settle on the first plausible reading of the order row; this was not tested.
- **`llama3.1:8b` called one tool and then answered in words**, never reaching a conclusion. It supports tools in Ollama; it did not follow this method.
- **`gpt-oss:20b`** was accepted 5 of 5 with reasoning `low` but did not name the refused webhook; with its default reasoning, four of five runs ended in an error because the server could not parse the JSON of a tool call the model wrote (the loop asks the model to try again three times, then gives up). It is a 13 GB model on a 16 GB card shared with a desktop, so part of it ran on the CPU (`ollama ps` showed 19% CPU), which is why it was slow.
- **`deepseek-r1:7b` and `:14b` never called a tool**, though Ollama lists the 7b with the `tools` capability: they answer in words. Whatever the cause (these are distilled, text-only reasoning models), they are of no use for this loop in the Ollama builds tested.
- **Kimi** was not tested: Ollama offers it only as a cloud model (the prompts go to Moonshot's servers), and the open weights are far too large for a normal machine.
- Five runs per setting of six models on one scenario with temperature 0: a snapshot of one setup, not a ranking. Run `ops eval` on yours.
