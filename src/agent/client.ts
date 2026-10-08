// One request to the model, over the OpenAI-compatible chat wire format: plain
// fetch, no SDK (ADR 0014).
import { z } from "zod";
import type { Model } from "./endpoint.ts";

// ---- the wire format ----

export interface ToolCall {
  id: string;
  name: string;
  /** The arguments as the model wrote them: JSON text, checked by the loop. */
  arguments: string;
}

export type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface Reply {
  content: string;
  toolCalls: ToolCall[];
  /** Tokens used by this request, if the server says. */
  tokens: number;
}

const ChatResponse = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullish(),
          tool_calls: z
            .array(
              z.object({
                id: z.string().optional(),
                function: z.object({
                  name: z.string(),
                  arguments: z.union([z.string(), z.record(z.string(), z.unknown())]),
                }),
              }),
            )
            .nullish(),
        }),
      }),
    )
    .min(1),
  usage: z.object({ total_tokens: z.number().optional() }).nullish(),
});

/** One request to the model. Errors say what happened and what to check. */
export async function ask(
  model: Model,
  messages: Message[],
  tools: ToolSpec[],
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<Reply> {
  const body = {
    model: model.model,
    temperature: model.temperature,
    ...(model.reasoningEffort ? { reasoning_effort: model.reasoningEffort } : {}),
    messages: messages.map((m) =>
      m.role === "assistant" && m.tool_calls
        ? {
            role: "assistant",
            content: m.content,
            tool_calls: m.tool_calls.map((c) => ({
              id: c.id,
              type: "function",
              function: { name: c.name, arguments: c.arguments },
            })),
          }
        : m,
    ),
    tools: tools.map((t) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    })),
  };
  let response: globalThis.Response;
  try {
    response = await fetchImpl(`${model.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(model.apiKey ? { authorization: `Bearer ${model.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(model.timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new Error(
      timedOut
        ? `The model at ${model.baseUrl} did not answer within ${Math.round(model.timeoutMs / 1000)} s (timeoutMs). A large model on a CPU can be that slow.`
        : `Cannot reach the model at ${model.baseUrl}: ${error instanceof Error ? error.message : String(error)}. Is the server running (for Ollama: ollama serve)?`,
      { cause: error },
    );
  }
  if (!response.ok) {
    const text = (await response.text().catch(() => "")).trim().slice(0, 300);
    const hint =
      response.status === 401 || response.status === 403
        ? " Check the key (OPS_MODEL_KEY)."
        : response.status === 404
          ? ` Is "${model.model}" pulled/loaded, and the address right?`
          : "";
    throw new Error(`The model server answered ${response.status}: ${text}.${hint}`);
  }
  const parsed = ChatResponse.safeParse(await response.json().catch(() => null));
  if (!parsed.success) {
    throw new Error(`${model.baseUrl} did not answer like an OpenAI-compatible chat endpoint (choices[].message).`);
  }
  const message = parsed.data.choices[0]!.message;
  return {
    content: message.content ?? "",
    toolCalls: (message.tool_calls ?? []).map((call, i) => ({
      id: call.id ?? `call_${i}`,
      name: call.function.name,
      arguments:
        typeof call.function.arguments === "string" ? call.function.arguments : JSON.stringify(call.function.arguments),
    })),
    tokens: parsed.data.usage?.total_tokens ?? 0,
  };
}
