// A scripted server that speaks the OpenAI-compatible chat wire format, so the
// loop of API mode is tested without any model (rule 5: tests never call one,
// and need no key). Each request takes the next step of the script.
import { createServer, type Server } from "node:http";

export interface Call {
  name: string;
  arguments: object | string;
}
export interface Step {
  content?: string;
  calls?: Call[];
  tokens?: number;
  /** Answer with this HTTP status and body instead. */
  status?: number;
  body?: unknown;
  /** Never answer. */
  hang?: boolean;
}
export interface Request {
  model: string;
  messages: { role: string; content: string | null; tool_calls?: unknown[] }[];
  tools: { function: { name: string; parameters: unknown } }[];
  authorization?: string;
}

export async function fakeChat(script: (Step | ((request: Request) => Step))[]) {
  const requests: Request[] = [];
  let at = 0;
  const server: Server = createServer((req, res) => {
    let text = "";
    req.on("data", (chunk) => (text += chunk));
    req.on("end", () => {
      const request = { ...JSON.parse(text), authorization: req.headers.authorization } as Request;
      requests.push(request);
      const entry = script[at++];
      const step = typeof entry === "function" ? entry(request) : entry;
      if (!step) {
        res.writeHead(500).end("script exhausted");
        return;
      }
      if (step.hang) return;
      if (step.status) {
        res.writeHead(step.status, { "content-type": "application/json" }).end(JSON.stringify(step.body ?? {}));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: step.content ?? null,
                tool_calls: step.calls?.map((c, i) => ({
                  id: `call_${at}_${i}`,
                  type: "function",
                  function: {
                    name: c.name,
                    arguments: typeof c.arguments === "string" ? c.arguments : JSON.stringify(c.arguments),
                  },
                })),
              },
            },
          ],
          usage: { total_tokens: step.tokens ?? 100 },
        }),
      );
    });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise<void>((done) => (server.closeAllConnections(), server.close(() => done()))),
  };
}
