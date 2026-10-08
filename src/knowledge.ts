// Written knowledge: the team's runbooks, past incidents and notes, in Markdown,
// searched by plain full-text and returned as evidence, so a conclusion can cite
// "runbook payment-webhook, section Replay" next to a log line. No embeddings, no
// service: the files are read when asked, so an edit is found at once.
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Evidence } from "./connectors/types.ts";

/** A folder of Markdown to search, and where it comes from. */
export interface KnowledgeSource {
  dir: string;
  /** "workspace" (knowledge/), "playbooks", or "addon:<name>". */
  origin: string;
}

export interface Passage {
  /** Path relative to the folder searched, with the origin: `workspace:payment-webhook.md`. */
  file: string;
  origin: string;
  /** The title of the file (its front matter name, or its first heading). */
  title: string;
  /** The headings above the passage: `Replay > Check first`. */
  heading: string;
  text: string;
  /** The apps it is about: none means all of them. */
  apps: string[];
}

const MAX_FILES = 500;
const MAX_FILE_BYTES = 256_000;
const MAX_PASSAGE = 1200;
const STOP = new Set("the and of to a in is it for on with as at by an be or this that are was from not".split(" "));

/** `---\nkey: value\n---` at the top: the keys and the rest. */
function frontMatter(text: string): { fields: Record<string, string>; body: string } {
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) return { fields: {}, body: text };
  const fields = Object.fromEntries(
    match[1]!
      .split("\n")
      .map((line) => /^(\w+):\s*(.*)$/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => [m[1]!, m[2]!.trim()]),
  );
  return { fields, body: match[2]! };
}

async function markdownFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (current: string, depth: number) => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (found.length >= MAX_FILES || entry.name.startsWith(".") || entry.name === "node_modules") continue;
      // A symbolic link could lead out of the folder: never followed.
      if (entry.isSymbolicLink()) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory() && depth < 6) await walk(path, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".md")) found.push(path);
    }
  };
  await walk(dir, 0);
  return found;
}

/** Cuts one file into passages at its headings, each at most MAX_PASSAGE long. */
function passagesOf(
  file: string,
  origin: string,
  text: string,
  appNames: string[],
  folderApp: string | undefined,
): Passage[] {
  const { fields, body } = frontMatter(text);
  const apps = (fields.app ?? folderApp ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter((a) => appNames.includes(a));
  const stack: string[] = [];
  let title = fields.name ?? "";
  let block: string[] = [];
  const out: Passage[] = [];
  let fenced = false;

  const flush = () => {
    const paragraphs = block
      .join("\n")
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    let chunk = "";
    const push = () => {
      if (chunk.trim()) out.push({ file, origin, title, heading: stack.join(" > "), text: chunk.trim(), apps });
      chunk = "";
    };
    for (const paragraph of paragraphs) {
      if (chunk && chunk.length + paragraph.length > MAX_PASSAGE) push();
      chunk += `${chunk ? "\n\n" : ""}${paragraph.slice(0, MAX_PASSAGE)}`;
    }
    push();
    block = [];
  };

  for (const line of body.split("\n")) {
    if (/^```/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^(#{1,4})\s+(.*?)\s*#*$/.exec(line);
    if (heading) {
      flush();
      const level = heading[1]!.length;
      stack.length = level - 1;
      stack[level - 1] = heading[2]!;
      if (!title) title = heading[2]!;
    } else block.push(line);
  }
  flush();
  return out.map((p) => ({ ...p, title: title || file }));
}

export async function loadKnowledge(sources: KnowledgeSource[], appNames: string[]): Promise<Passage[]> {
  const passages: Passage[] = [];
  for (const { dir, origin } of sources) {
    for (const path of await markdownFiles(dir)) {
      const name = relative(dir, path);
      if (origin === "playbooks" && name === "README.md") continue;
      try {
        if ((await stat(path)).size > MAX_FILE_BYTES) continue;
        // knowledge/shop/runbook.md is about the app "shop", if there is one by that name.
        const first = name.split("/")[0]!;
        const folderApp = name.includes("/") && appNames.includes(first) ? first : undefined;
        passages.push(...passagesOf(`${origin}:${name}`, origin, await readFile(path, "utf8"), appNames, folderApp));
      } catch {
        // An unreadable file is left out; the others are still searched.
      }
    }
  }
  return passages;
}

const stem = (word: string) =>
  word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
const terms = (text: string) =>
  (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((w) => !STOP.has(w) && (w.length > 1 || /\d/.test(w)))
    .map(stem);

export interface Hit {
  passage: Passage;
  score: number;
  snippet: string;
}

/** The passages that answer a query, best first: BM25 over the text, with the headings and the title counting more. */
export function searchPassages(
  passages: Passage[],
  query: string,
  options: { app?: string; limit?: number } = {},
): Hit[] {
  const wanted = [...new Set(terms(query))];
  if (!wanted.length) return [];
  const pool = passages.filter((p) => !options.app || p.apps.length === 0 || p.apps.includes(options.app));
  if (!pool.length) return [];
  const indexed = pool.map((passage) => {
    const body = terms(passage.text);
    // The section's own heading counts most. The headings above it and the file's title help only a
    // word the section itself holds: a whole file about "the payment webhook" must not rank all of
    // its sections for the word "webhook".
    const parts = passage.heading.split(" > ");
    const own = terms(parts.at(-1) ?? "");
    const around = [...terms(parts.slice(0, -1).join(" ")), ...terms(passage.title)];
    const counts = new Map<string, number>();
    for (const [list, weight] of [
      [body, 1],
      [own, 3],
    ] as const) {
      for (const word of list) counts.set(word, (counts.get(word) ?? 0) + weight);
    }
    for (const word of around) if (counts.has(word)) counts.set(word, counts.get(word)! + 0.5);
    return { passage, counts, length: body.length + 1 };
  });
  const average = indexed.reduce((sum, d) => sum + d.length, 0) / indexed.length;
  const frequency = new Map(wanted.map((w) => [w, indexed.filter((d) => d.counts.has(w)).length]));
  const phrase = query.toLowerCase().trim();
  const hits: Hit[] = [];
  for (const d of indexed) {
    let score = 0;
    for (const word of wanted) {
      const tf = d.counts.get(word) ?? 0;
      if (!tf) continue;
      const n = frequency.get(word)!;
      const idf = Math.log(1 + (indexed.length - n + 0.5) / (n + 0.5));
      score += (idf * tf * 2.2) / (tf + 1.2 * (0.25 + (0.75 * d.length) / average));
    }
    if (score === 0) continue;
    if (wanted.length > 1 && d.passage.text.toLowerCase().includes(phrase)) score += 2;
    hits.push({ passage: d.passage, score, snippet: snippetOf(d.passage.text, wanted) });
  }
  return hits
    .sort((a, b) => b.score - a.score || a.passage.file.localeCompare(b.passage.file))
    .slice(0, Math.min(Math.max(options.limit ?? 8, 1), 20));
}

/** The sentence or list item of the passage that holds most of the query's words, cut to a readable length. */
function snippetOf(text: string, wanted: string[]): string {
  const units = text
    .split(/\n(?=\s*(?:[-*]|\d+\.)\s)|(?<=[.!?])\s+/)
    .map((unit) =>
      unit
        .replace(/\s+/g, " ")
        .replace(/\*\*|^[-*\d.\s>]+/g, "")
        .trim(),
    )
    .filter(Boolean);
  const best =
    units
      .map((unit) => ({ unit, hits: wanted.filter((w) => terms(unit).includes(w)).length }))
      .sort((x, y) => y.hits - x.hits)[0]?.unit ?? "";
  return best.length > 240 ? `${best.slice(0, 239)}…` : best;
}

export function toEvidence(hits: Hit[]): Evidence[] {
  return hits.map(({ passage, score, snippet }) => ({
    source: "knowledge",
    at: null,
    summary: `${passage.file}${passage.heading ? ` > ${passage.heading}` : ""}: ${snippet}`,
    data: {
      file: passage.file,
      origin: passage.origin,
      title: passage.title,
      heading: passage.heading,
      apps: passage.apps,
      score: Math.round(score * 100) / 100,
      text: passage.text,
    },
  }));
}
