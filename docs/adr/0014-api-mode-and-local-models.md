# 0014. An optional API mode: the toolbox driven by a model you choose, local or hosted

- Status: proposed
- Date: 2026-10-08

## Context

ADR 0007 says the project makes no model calls: Claude Code, Codex and Copilot
bring a model, on the user's own subscription, and help-me-ops is the toolbox
they call over MCP. That keeps the project free of keys, cost limits and provider
choices, and it is still the best way to investigate: a person talks to the
assistant, and the assistant uses the tools.

Three needs that choice does not meet:

1. **Data that must not leave the network.** The personal-data guide ends on
   "use a model that stays with you". Today that means finding an MCP client that
   can run against a local model, and trusting it with the tools. We cannot test,
   document or support that path, because we do not control it.
2. **No client at all.** A scheduled job that triages an alert, a script in CI, a
   terminal on a server: nobody to type into an assistant.
3. **Not knowing if a model is good enough.** A team deciding between a hosted
   model and a local one has no way to measure, on its own scenarios, which
   one reaches a checked conclusion.

## Decision

Add an **optional second door onto the same toolbox**: a command, `ops ask`, that
runs the investigation itself by calling a chat model over HTTP, in a loop. The
MCP server and every client path stay exactly as they are.

- **The core stays model-free.** The loop lives in `src/agent/`, which the MCP
  server and the other commands never import. A workspace that configures no
  model never makes a model call. This revises "the project makes no model calls"
  (ADR 0007) to: **it makes none unless the person configures a model and runs
  `ops ask` or `ops eval`.**
- **One wire format first: an OpenAI-compatible chat API with tools**
  (`POST {baseUrl}/chat/completions`, `tools`, `tool_calls`). Ollama, llama.cpp's
  server, LM Studio and vLLM speak it, and so do many hosted providers and
  gateways. It is plain `fetch` with `zod` validation: **no new dependency**.
  Other wire formats (Anthropic Messages) are adapters behind the same small
  interface, added when someone needs one.
- **The model is configured, not chosen for you.** An optional `model` block in
  `ops.config.json` (or flags and environment variables): `baseUrl`, `model`,
  `apiKey` as `${VAR}` like every credential, `maxSteps`, `temperature` (default
  0). No default model, no default endpoint.
- **Same toolbox, same guards.** The loop calls `createToolDefinitions`, so
  everything that applies to a tool applies here: read-only (ADR 0002), the mask
  and the stable placeholders (ADR 0010, 0013), strict mode (ADR 0012), the
  ledger and the checked conclusion. Nothing is re-implemented, and nothing can
  be skipped by choosing this door.
- **The same method, from one source.** The instructions the MCP server gives
  (`GUIDE` in `src/mcp.ts`) move to a shared module and are the system prompt of
  the loop, so the two doors cannot drift apart.
- **Bounded by design.** A step cap, a total token budget, a per-call timeout, and
  a refusal to repeat the same call forever. When the checked conclusion is
  accepted, the run ends and prints its report; when a limit is hit it says which
  and prints what it has, and exits non-zero.
- **One question, one answer.** `ops ask "<problem>"` is non-interactive: steps on
  stderr as they happen, the checked report on stdout (or `--json`), exit code 0
  only when the conclusion was accepted. A chat is what the MCP clients are for;
  a REPL can come later if it is wanted.
- **`ops eval` measures instead of guessing.** It runs the scenarios of a
  workspace (the demo has one, with its expected cause) against the configured
  model, a number of times, and reports per run whether it reached a conclusion,
  whether the check accepted it, whether the cause matches, how many steps and
  tokens, and how long it took. The result for _your_ model on _your_ hardware is
  what decides whether to rely on it. We publish no benchmark we did not run.
- **Tests never call a model** (rule 5 stands). The loop is tested against a
  scripted fake server that speaks the wire format, like the mocks of the
  observability addons, including malformed tool calls, a loop that never ends and
  an unreachable endpoint.
- **`doctor` says where the model is.** It prints the endpoint, and whether it is
  this machine, a private network address or an outside host, so the personal-data
  warning for hosted providers is visible where the choice is made.

## Consequences

- A team can run a fully local investigation, auditable and with nothing leaving
  its network, and can use the same scenarios to compare models.
- Scripts and scheduled jobs can investigate, with the same checks as a person.
- We take on a loop to maintain, and with it the failure modes of models we do
  not control. The checker bounds the harm (a quote no tool returned is refused),
  not the quality.
- A **small local model will investigate worse** than a large hosted one:
  see the proposal for the expected failures and the levers. That is stated in the
  guide next to the feature, with `ops eval` as the way to find out.
- Pointing the loop at a hosted provider sends the evidence to that provider
  exactly as an MCP client does. The personal-data guide applies unchanged, and
  `doctor` shows it.
- The surface for prompt injection is the same as with an MCP client (a log line
  can contain instructions), and the blast radius is smaller than in most agents:
  every tool is read-only, and the loop has no tool but these.

## Alternatives considered

**Stay MCP-only and document local clients.** Costs nothing and we would never
break. But we could not test it, could not offer a command-line or scheduled use,
and could not measure a model. Rejected as the only answer; it remains a valid way
to run (nothing here removes it).

**Depend on an SDK (OpenAI's, Anthropic's, the Vercel AI SDK).** Less code to
write, but a dependency per provider and a dependency tree to keep safe, for a
loop of a few hundred lines. The wire format is stable and small; an SDK can be an
adapter later.

**Anthropic Messages API first.** It is the format of the models we know best, but
it would make the first version hosted-only. The OpenAI-compatible format reaches
local servers and many hosted ones with one client.

**An interactive REPL in the first version.** It doubles the surface (history,
context trimming, display) for what MCP clients already do well.

**A framework for agents (LangChain and the like).** Far more than a bounded loop
over our own tools needs, and a large dependency to audit.

**Fine-tuning or shipping a model.** Out of scope: we ship the method and the
plumbing, never a model.
