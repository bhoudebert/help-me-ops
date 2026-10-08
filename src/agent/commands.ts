// `ops chat` and `ops ask`: the loop in the terminal (ADR 0014).
import type { Toolbox } from "../tools/index.ts";
import { Session, type TurnResult } from "./loop.ts";
import { assertModelAllowed, resolveModel } from "./endpoint.ts";

export interface AgentFlags {
  baseUrl?: string;
  model?: string;
  maxSteps?: number;
}

export interface Io {
  /** The answer the person reads. */
  write(line: string): void;
  /** What happens on the way: steps and notices. */
  step(line: string): void;
}

/** The model of the workspace with the flags and variables applied, checked against `privacy.modelHosts` before any request. */
function modelFor(toolbox: Toolbox, flags: AgentFlags, env: NodeJS.ProcessEnv) {
  const model = resolveModel(toolbox.model, flags, env);
  assertModelAllowed(model.baseUrl, toolbox.privacy?.modelHosts);
  return model;
}

/** One question, one checked answer: for scripts and scheduled jobs. */
export async function runAsk(
  toolbox: Toolbox,
  question: string,
  io: Io,
  flags: AgentFlags = {},
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<TurnResult> {
  if (!question.trim()) throw new Error('Usage: ask "<question>" [--model <name>] [--base-url <url>] [--max-steps N]');
  const session = new Session(toolbox, modelFor(toolbox, flags, env), fetchImpl);
  const result = await session.turn(question, { step: io.step, notice: io.step });
  io.write(result.text);
  return result;
}

const HELP = "Describe the problem. /reset starts a new conversation, /exit leaves.";

/** A conversation in the terminal; `read` returns null at the end of the input. */
export async function runChat(
  toolbox: Toolbox,
  io: Io & { read(prompt: string): Promise<string | null> },
  flags: AgentFlags = {},
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<void> {
  const model = modelFor(toolbox, flags, env);
  const session = new Session(toolbox, model, fetchImpl);
  io.step(`help-me-ops chat: ${model.model} at ${model.baseUrl}, workspace ${toolbox.workspace ?? "unknown"}. ${HELP}`);
  for (;;) {
    const line = await io.read("you ▸ ");
    if (line === null) return;
    const text = line.trim();
    if (!text) continue;
    if (text === "/exit" || text === "/quit") return;
    if (text === "/help") {
      io.step(HELP);
      continue;
    }
    if (text === "/reset") {
      session.reset();
      io.step("New conversation. The evidence already read still counts for the conclusion check.");
      continue;
    }
    try {
      const result = await session.turn(text, { step: (l) => io.step(`  ${l}`), notice: io.step });
      io.write(`assistant ▸ ${result.text}`);
    } catch (error) {
      // The conversation is as it was before this question: the person may ask again.
      io.step(error instanceof Error ? error.message : String(error));
    }
  }
}
