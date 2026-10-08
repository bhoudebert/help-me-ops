# Tasks

- [x] Review of ADR 0014 and this proposal; open questions answered
- [x] Move the method text of `src/mcp.ts` to a shared module; both doors use it
- [x] `src/agent/`: OpenAI-compatible client (fetch, zod), the loop, limits (steps, tokens, timeout), repeated-call guard, malformed-call handling
- [x] A conversation over several turns: the session ledger carries on, old tool results are trimmed when the context fills, `/reset` and `/exit`
- [x] The scripted fake chat server and the tests: a good run, malformed calls, a loop that never ends, a refused conclusion then a fixed one, an unreachable endpoint, a limit hit, a multi-turn chat that outgrows the context
- [x] `npm run eval:local` (a script around `ops eval` for a local Ollama). The compose file and the smoke workflow were dropped: bring your own server.
- [x] `ops chat`, and `ops ask` (steps on stderr, report on stdout, `--json`, exit code); `model` block in the config, flags and environment (flags win)
- [x] `privacy.modelHosts` (`local` and named hosts), checked before any call
- [x] `doctor` prints the model endpoint and where it is
- [x] `ops eval` and the `expect` of scenarios
- [x] Guide ("Without an AI client: your own model"), README, ROADMAP; the implemented requirements folded into `openspec/specs/api-mode`
- [x] Site: a line on the model path
- [x] Measure named models on named hardware; publish only what was measured (one setup, in the guide)
