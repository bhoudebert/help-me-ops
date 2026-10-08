// The client against the OpenAI-compatible chat contract: what we send is valid,
// what servers answer (recorded from a real Ollama, or written from the API
// reference) is understood. No model is called.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ask } from "../src/agent/client.ts";
import type { Model } from "../src/agent/endpoint.ts";
import { contractProblems } from "./chat-contract.ts";
import { fakeChat } from "./fake-chat.ts";

const fixture = (name: string) => ({
  status: Number(readFileSync(join("test/fixtures/chat", `${name}.status`), "utf8")),
  body: readFileSync(join("test/fixtures/chat", `${name}.body`), "utf8"),
});
const weather = { name: "weather", description: "weather by city", parameters: { type: "object" } };
const user = [{ role: "user" as const, content: "hi" }];

async function answerWith(raw: { status: number; body: string }) {
  const server = await fakeChat([{ raw }]);
  try {
    const model: Model = {
      baseUrl: server.url,
      model: "m",
      maxSteps: 20,
      temperature: 0,
      contextTokens: 16000,
      timeoutMs: 5000,
      retries: 2,
      retryDelayMs: 1,
      headers: {},
    };
    return await ask(model, user, [weather]);
  } finally {
    await server.close();
  }
}

test("recorded from Ollama: a plain answer, a tool call, an answer after a tool result", async () => {
  const answer = await answerWith(fixture("ollama-answer"));
  assert.ok(answer.content.length > 0 && answer.toolCalls.length === 0 && answer.tokens > 0);

  const call = await answerWith(fixture("ollama-tool-call"));
  assert.equal(call.content, "", "the thinking is in `reasoning`, not in the content");
  assert.equal(call.toolCalls.length, 1);
  assert.equal(call.toolCalls[0]!.name, "weather");
  assert.deepEqual(JSON.parse(call.toolCalls[0]!.arguments), { city: "Paris" });
  assert.match(call.toolCalls[0]!.id, /^call_/);

  const after = await answerWith(fixture("ollama-after-tool"));
  assert.match(after.content, /Paris/);

  const words = await answerWith(fixture("ollama-no-tools-model"));
  assert.ok(words.content.trim().length > 0 && words.toolCalls.length === 0, "a model without tools answers in words");
});

test("recorded from Ollama: a model that is not pulled is a 404 that says what to check", async () => {
  await assert.rejects(
    answerWith(fixture("ollama-model-missing")),
    /answered 404: .*model 'no-such-model:1b' not found.*Is "m" pulled\/loaded/,
  );
});

test("written from the API reference: content null with tool calls, arguments as an object, no id, no usage", async () => {
  const reference = await answerWith({
    status: 200,
    body: JSON.stringify({
      id: "chatcmpl-1",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              { id: "call_abc", type: "function", function: { name: "weather", arguments: '{"city":"Paris"}' } },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 82, completion_tokens: 17, total_tokens: 99 },
    }),
  });
  assert.deepEqual(
    [reference.content, reference.toolCalls[0]!.id, reference.toolCalls[0]!.arguments, reference.tokens],
    ["", "call_abc", '{"city":"Paris"}', 99],
  );
  // some servers send the arguments as an object, omit the id, and omit usage
  const loose = await answerWith({
    status: 200,
    body: JSON.stringify({
      choices: [
        { message: { content: "", tool_calls: [{ function: { name: "weather", arguments: { city: "Paris" } } }] } },
      ],
    }),
  });
  assert.equal(loose.toolCalls[0]!.id, "call_0");
  assert.equal(loose.toolCalls[0]!.arguments, '{"city":"Paris"}');
  assert.equal(loose.tokens, 0);
});

test("what we send is the contract: the request a real Ollama accepted passes, and a broken one is named", () => {
  const accepted = JSON.parse(readFileSync("test/fixtures/chat/ollama-after-tool.request.json", "utf8"));
  assert.deepEqual(contractProblems(accepted), []);

  const wrong = (change: (r: any) => void) => {
    const copy = structuredClone(accepted);
    change(copy);
    return contractProblems(copy);
  };
  assert.match(wrong((r) => (r.messages[2].tool_call_id = "call_other"))[0]!, /answers no open tool call/);
  assert.match(
    wrong((r) =>
      r.messages.push({ role: "user", content: "x" }, { role: "tool", tool_call_id: "call_1", content: "late" }),
    )[0]!,
    /answers no open tool call/,
  );
  assert.match(wrong((r) => (r.messages[1].tool_calls[0].function.arguments = { city: "Paris" }))[0]!, /arguments/);
  assert.match(wrong((r) => (r.tools[0].function.name = "order.getOrder"))[0]!, /function name/);
  assert.match(wrong((r) => delete r.model)[0]!, /model/);
  assert.match(wrong((r) => (r.messages[0].role = "robot"))[0]!, /messages/);
});
