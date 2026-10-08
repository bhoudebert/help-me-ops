# Tasks

- [ ] Review of ADR 0014 and this proposal; answer the open questions
- [ ] Move the method text of `src/mcp.ts` to a shared module; both doors use it
- [ ] `src/agent/`: OpenAI-compatible client (fetch, zod), the loop, limits (steps, tokens, timeout), repeated-call guard, malformed-call handling
- [ ] The scripted fake chat server and the tests: a good run, malformed calls, a loop that never ends, a refused conclusion then a fixed one, an unreachable endpoint, a limit hit
- [ ] `ops ask` (steps on stderr, report on stdout, `--json`, exit code), `model` block in the config, flags and environment
- [ ] `doctor` prints the model endpoint and where it is
- [ ] `ops eval` and the `expect` of scenarios
- [ ] Guide ("Run it without an AI client", "Use a local model"), README, site, ROADMAP; fold the spec delta into `openspec/specs/api-mode`
- [ ] Measure named models on named hardware; publish only what was measured
