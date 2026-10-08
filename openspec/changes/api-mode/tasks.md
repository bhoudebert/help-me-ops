# Tasks

- [x] Review of ADR 0014 and this proposal; open questions answered
- [ ] Move the method text of `src/mcp.ts` to a shared module; both doors use it
- [ ] `src/agent/`: OpenAI-compatible client (fetch, zod), the loop, limits (steps, tokens, timeout), repeated-call guard, malformed-call handling
- [ ] A conversation over several turns: the session ledger carries on, old tool results are trimmed when the context fills, `/reset` and `/exit`
- [ ] The scripted fake chat server and the tests: a good run, malformed calls, a loop that never ends, a refused conclusion then a fixed one, an unreachable endpoint, a limit hit, a multi-turn chat that outgrows the context
- [ ] `npm run eval:local` (a script around `ops eval` for a local Ollama) and `compose.llm.yml` (Ollama, models in a cached volume); optional manual workflow with a tiny model as a wire-format smoke test, never gating
- [ ] `ops chat`, and `ops ask` (steps on stderr, report on stdout, `--json`, exit code); `model` block in the config, flags and environment (flags win)
- [ ] `privacy.modelHosts` (`local` and named hosts), checked before any call
- [ ] `doctor` prints the model endpoint and where it is
- [ ] `ops eval` and the `expect` of scenarios
- [ ] Guide ("Run it without an AI client", "Use a local model"), README, site, ROADMAP; fold the spec delta into `openspec/specs/api-mode`
- [ ] Measure named models on named hardware; publish only what was measured
