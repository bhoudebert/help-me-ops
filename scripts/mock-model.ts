// A stand-in for a model server, to try `ops chat` and `ops ask` with no model,
// no GPU and no key: it speaks the OpenAI-compatible chat API and replays the
// investigation of a scenario (the calls of its `steps`, then its `conclusion`).
// It is not intelligent: it answers by counting the tool results already in the
// conversation, so any question gets the scenario's investigation.
//
//   node scripts/mock-model.ts [--port 8099] [--workspace examples/my-workspace] [--scenario stuck-order]
//   npm run ops -- ask "order 4512 is stuck" --base-url http://localhost:8099/v1 --model mock
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";

const arg = (name: string, fallback: string) => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1]! : fallback;
};
const workspace = resolve(arg("--workspace", "examples/my-workspace"));
const scenario = JSON.parse(
  readFileSync(join(workspace, "scenarios", `${arg("--scenario", "stuck-order")}.json`), "utf8"),
) as {
  steps: { tool: string; input: object }[];
  conclusion: object;
};
const wire = (tool: string) => tool.replaceAll(".", "_");

const server = createServer((req, res) => {
  let text = "";
  req.on("data", (chunk) => (text += chunk));
  req.on("end", () => {
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res
        .writeHead(404, { "content-type": "application/json" })
        .end(JSON.stringify({ error: { message: "not found" } }));
      return;
    }
    const messages = (JSON.parse(text) as { messages: { role: string }[] }).messages;
    // The last user message starts the question: the tool results after it say how far we are.
    const lastUser = messages.map((m) => m.role).lastIndexOf("user");
    const done = messages.slice(lastUser).filter((m) => m.role === "tool").length;
    const step = scenario.steps[done];
    const call = step
      ? { name: wire(step.tool), arguments: JSON.stringify(step.input) }
      : { name: "checkConclusion", arguments: JSON.stringify(scenario.conclusion) };
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{ id: `call_${done}`, type: "function", function: call }],
            },
          },
        ],
        usage: { total_tokens: 10 },
      }),
    );
  });
});

server.listen(Number(arg("--port", "8099")), "127.0.0.1", () => {
  const { port } = server.address() as { port: number };
  process.stderr.write(`mock model on http://127.0.0.1:${port}/v1 (scenario: ${arg("--scenario", "stuck-order")})\n`);
});
