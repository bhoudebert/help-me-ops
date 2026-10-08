// What a request to an OpenAI-compatible chat endpoint must look like, written
// from the API reference and checked against a real Ollama (see
// test/fixtures/chat). The scripted server applies it to every request, so each
// test of the loop is also a test that we stay compliant.
import { z } from "zod";

const name = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/, "a function name is letters, digits, _ and -, up to 64");

const toolCall = z.object({
  id: z.string().min(1),
  type: z.literal("function"),
  function: z.object({ name, arguments: z.string() }),
});

const message = z.discriminatedUnion("role", [
  z.object({ role: z.literal("system"), content: z.string() }),
  z.object({ role: z.literal("user"), content: z.string() }),
  z.object({
    role: z.literal("assistant"),
    content: z.string().nullable(),
    tool_calls: z.array(toolCall).min(1).optional(),
  }),
  z.object({ role: z.literal("tool"), tool_call_id: z.string().min(1), content: z.string() }),
]);

const Request = z.object({
  model: z.string().min(1),
  temperature: z.number().optional(),
  reasoning_effort: z.enum(["none", "low", "medium", "high"]).optional(),
  messages: z.array(message).min(1),
  tools: z
    .array(
      z.object({
        type: z.literal("function"),
        function: z.object({
          name,
          description: z.string(),
          parameters: z.object({ type: z.literal("object") }).loose(),
        }),
      }),
    )
    .optional(),
});

/** The problems of a request body, none when it is valid. */
export function contractProblems(body: unknown): string[] {
  const parsed = Request.safeParse(body);
  if (!parsed.success) return parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  const problems: string[] = [];
  // A tool message answers a tool call the assistant made just before, by id, once.
  const open = new Set<string>();
  const messages = parsed.data.messages;
  if (messages[0]!.role !== "system" && messages[0]!.role !== "user")
    problems.push("the conversation starts with a system or user message");
  for (const [i, m] of messages.entries()) {
    if (m.role === "assistant") {
      open.clear();
      for (const call of m.tool_calls ?? []) open.add(call.id);
    } else if (m.role === "tool") {
      if (!open.delete(m.tool_call_id))
        problems.push(`messages.${i}: a tool message answers no open tool call (${m.tool_call_id})`);
    } else if (open.size) {
      problems.push(`messages.${i}: a ${m.role} message arrives while tool calls are unanswered`);
      open.clear();
    }
  }
  return problems;
}
