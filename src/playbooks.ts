// Playbooks: how your team investigates a kind of problem, written in Markdown
// so anyone can fill them in. The model follows them; it does not invent steps.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export interface Playbook {
  /** File name without .md, e.g. order-stuck. */
  id: string;
  name: string;
  /** When it applies, in the words people use to report the problem. */
  when: string;
  /** The steps, as written. */
  body: string;
}

/** Read "--- name: … / when: … ---" then the body. */
export function parsePlaybook(id: string, text: string): Playbook {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  const fields = Object.fromEntries(
    (match?.[1] ?? "")
      .split("\n")
      .map((line) => /^(\w+):\s*(.*)$/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1]!, m[2]!.trim()]),
  );
  return { id, name: fields.name ?? id, when: fields.when ?? "", body: (match?.[2] ?? text).trim() };
}

export async function loadPlaybooks(dir: string): Promise<Playbook[]> {
  let files: string[];
  try {
    // README.md explains the folder; it is not a playbook.
    files = (await readdir(dir)).filter((f) => f.endsWith(".md") && f !== "README.md").sort();
  } catch {
    return [];
  }
  return Promise.all(files.map(async (f) => parsePlaybook(f.slice(0, -3), await readFile(join(dir, f), "utf8"))));
}

const words = (text: string) => new Set(text.toLowerCase().match(/\p{L}{3,}/gu) ?? []);

/** Playbooks whose "when" shares words with the question, best first. */
export function matchPlaybooks(playbooks: Playbook[], question: string): Playbook[] {
  const asked = words(question);
  const score = (p: Playbook) => [...words(`${p.name} ${p.when}`)].filter((w) => asked.has(w)).length;
  return playbooks
    .map((p) => ({ p, s: score(p) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.p);
}
