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
| `apiKey`          | Sent as `Authorization: Bearer <key>`, which most providers expect. Name it as `${VAR}` (read from the environment); `OPS_MODEL_KEY` also works. Never written in the file.                                                                                                                                                        | none     |
| `headers`         | Other headers to send, for a provider or gateway with its own (`api-key`, `x-api-key`, a tenant). A value may use `${VAR}`. A header named `authorization` replaces the one `apiKey` sends.                                                                                                                                        | none     |
| `reasoningEffort` | `none`, `low`, `medium` or `high`, sent as `reasoning_effort`. Also `--reasoning` and `OPS_MODEL_REASONING`. `none` turns off the long thinking of models like Qwen 3 on Ollama and makes each step much faster; leave it out for servers that do not accept it. Whether the investigation stays as good is for `ops eval` to say. | not sent |
| `maxSteps`        | Most rounds of tool calls for one question (`--max-steps`).                                                                                                                                                                                                                                                                        | 20       |
| `temperature`     | 0 is the most repeatable.                                                                                                                                                                                                                                                                                                          | 0        |
| `contextTokens`   | The model's context. When a conversation outgrows 80% of it, the oldest tool results are dropped (and you are told). Set it to what your server really gives the model.                                                                                                                                                            | 16000    |
| `budgetTokens`    | Most tokens one question may use, all requests together.                                                                                                                                                                                                                                                                           | none     |
| `timeoutMs`       | Per request. A big model on a CPU can be slow.                                                                                                                                                                                                                                                                                     | 300000   |
| `retries`         | After a `429` (rate limit) or a `502`, `503`, `504`, ask again this many times, waiting longer each time, or as long as the `Retry-After` header says (up to 30 s). A hosted provider will send these; a local server hardly ever does. `0` turns it off.                                                                          | 2        |
| `retryDelayMs`    | The first wait before a retry, in milliseconds; it doubles each time.                                                                                                                                                                                                                                                              | 1000     |

There is no default model and no default address: nothing happens until you write them.

## Another provider, or a company gateway

help-me-ops speaks the **OpenAI-compatible chat API** (`POST {baseUrl}/chat/completions` with `tools`) with plain HTTP, and authenticates with a **Bearer key** or with **headers you list**. So:

| Case                                                                                                                                                            | What to set                                                                                                                                                           | Status                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| A provider with an OpenAI-compatible endpoint and a Bearer key (OpenAI, DeepSeek's and Moonshot's APIs, OpenRouter, Groq, Together, a LiteLLM or other gateway) | `baseUrl`, `model`, `apiKey: "${THE_KEY}"`                                                                                                                            | The format is the same as Ollama's, which is what was tested. **No hosted provider has been called yet.** |
| A key in another header (`x-api-key`, a tenant id)                                                                                                              | `headers: { "x-api-key": "${THE_KEY}" }`                                                                                                                              | Supported, untested against a real one                                                                    |
| Azure OpenAI                                                                                                                                                    | `baseUrl: "https://<resource>.openai.azure.com/openai/deployments/<deployment>?api-version=<version>"`, `headers: { "api-key": "${AZURE_KEY}" }`, `model` as you like | The query string is kept on the request and never shown. Untested against Azure                           |
| Anthropic's, Google's or another **native** API that is not OpenAI-compatible                                                                                   | not supported                                                                                                                                                         | Use the OpenAI-compatible endpoint if the provider offers one; a native adapter is on the roadmap         |
| Tokens that expire and are minted by a command or OAuth, request signing (AWS Bedrock), client certificates                                                     | not supported                                                                                                                                                         | Put a gateway in front that accepts a plain key                                                           |

```json
"model": {
  "baseUrl": "https://api.example.com/v1",
  "model": "the-model-name",
  "apiKey": "${EXAMPLE_API_KEY}",
  "retries": 3
}
```

A hosted URL sends your evidence to that provider: see [where the model is](#where-the-model-is-say-it-and-restrict-it). Providers rate-limit; a 429 or a busy gateway is retried with a growing wait (see `retries`).

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

Instead of judging from one run, count. `ops eval` asks the question of each scenario (the demo has [three, with different causes](/demo#three-incidents-in-one-world)) of your model several times, each in a fresh conversation, and reports what happened:

```bash
npm run ops -- eval --runs 5 --model qwen3:8b --reasoning none,default
npm run ops -- eval --model qwen3:8b,llama3.1:8b --runs 5      # compare models
npm run ops -- eval --scenario missing-emails --runs 5          # one scenario (a list: a,b; the default is all)
npm run eval:local                                              # the same on a local Ollama, 3 runs
```

`--model`, `--reasoning` and `--scenario` take a comma-separated list, and every combination is run. With several scenarios you get one table each, then the settings added up over all of them (how many runs found the cause, scenario by scenario), so a model that only knows one incident shows. `--json` prints `reports`, one per scenario. The columns:

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

The numbers, the machine they come from and how to add yours are on [Which model? What was measured](/benchmarks). In short, on one RTX 5080 with eight runs per scenario at temperature 0.7, `qwen3:14b` found the stuck order's cause in 7 runs of 8 and an expired certificate's in 3, `gpt-oss:20b` the certificate in 6 of 8, and nobody the missing index of the third incident. A rough measure of one setup, not a ranking.
