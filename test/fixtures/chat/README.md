# Recorded chat responses

Responses (`*.body`, with the HTTP status in `*.status`) recorded on 2026-10-08
from a real Ollama 0.32.14 through its OpenAI-compatible endpoint
(`/v1/chat/completions`), with `qwen3:0.6b` and `deepseek-r1:7b`:

- `ollama-answer`: a plain answer (`reasoning_effort: none`).
- `ollama-tool-call`: a tool call, with the model's `reasoning` next to an empty `content`.
- `ollama-after-tool`: the answer after a tool result; `ollama-after-tool.request.json` is
  the request that a real server accepted (assistant `content: null` with `tool_calls`, then a `tool` message).
- `ollama-model-missing`: the 404 for a model that is not pulled.
- `ollama-no-tools-model`: a model that ignores tools and answers in words.

They are what `test/chat-contract.test.ts` replays, so the client is tested against what a real
server says, not only against what we think it says. Re-record them with `curl` against your own
Ollama when its format changes; keep them small.
