// The git addon: what changed in a repository on disk, read through a fixed
// set of git commands.
//
// Read-only and hard to talk into anything else:
//  - git runs through execFile with an argument list, never a shell;
//  - only these subcommands exist in this file: log, show, diff, grep, tag,
//    cat-file, rev-parse (all of which only read);
//  - a value from the question is one argument, checked to not start with "-"
//    (so it can never be an option), and paths go after "--";
//  - no external diff driver, text conversion, pager or prompt, and the
//    repository's own configuration cannot add a command to run;
//  - files that usually hold secrets (.env, keys) are refused or left out, a
//    seat belt: secrets do not belong in a repository;
//  - answers are capped and the call times out.
import { execFile } from "node:child_process";
import { resolve } from "node:path";

interface Context {
  settings: { repo: string; ref: string };
  workspace: string;
}

const TIMEOUT_MS = 15_000;
const MAX_BUFFER = 4_000_000;
const MAX_COMMITS = 100;
const MAX_FILES = 25;
const MAX_PATCH = 6000;
const MAX_FILE_LINES = 400;
const SEP = "\x1f";
const REC = "\x1e";

/** Files that commonly hold secrets: never read through this addon. */
const SECRET_FILE =
  /(^|\/)(\.env(\..*)?|\.npmrc|\.netrc|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|credentials[^/]*|[^/]*\.(pem|key|p12|pfx|keystore|jks))$/i;
const EXCLUDE_SECRETS = [
  ":(exclude,glob)**/.env*",
  ":(exclude,glob)**/*.pem",
  ":(exclude,glob)**/*.key",
  ":(exclude,glob)**/*.p12",
  ":(exclude,glob)**/*.pfx",
  ":(exclude,glob)**/id_rsa*",
  ":(exclude,glob)**/id_ed25519*",
  ":(exclude,glob)**/.npmrc",
];

/** A branch, tag, commit or revision: letters, digits and . _ / @ ^ ~ - , never starting with "-". */
function revision(value: string, what: string): string {
  if (!/^\w[\w./@^~-]*$/.test(value) || value.includes("..")) {
    throw new Error(`${what} "${value}" is not a commit, tag or branch name`);
  }
  return value;
}

/** A path inside the repository: relative, no "..", no leading "-". */
function inside(path: string): string {
  if (path.startsWith("/") || path.startsWith("-") || path.split(/[\\/]/).includes("..") || /[\0\n]/.test(path)) {
    throw new Error(`path "${path}" must be inside the repository (relative, without "..")`);
  }
  return path;
}

const instant = (value: string, what: string): string => {
  if (Number.isNaN(Date.parse(value))) throw new Error(`${what} "${value}" must be a time in ISO 8601 form`);
  return new Date(value).toISOString();
};

const READ_ONLY = new Set(["log", "show", "diff", "grep", "tag", "cat-file", "rev-parse"]);

function git(context: Context, subcommand: string, args: string[]): Promise<string> {
  if (!READ_ONLY.has(subcommand)) throw new Error(`git ${subcommand} is not a read-only command of this addon`);
  const repo = resolve(context.workspace, context.settings.repo);
  return new Promise((done, fail) => {
    execFile(
      "git",
      [
        "--no-pager",
        "-C",
        repo,
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.pager=cat",
        "-c",
        "diff.external=",
        "-c",
        "protocol.ext.allow=never",
        subcommand,
        ...args,
      ],
      {
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        env: {
          PATH: process.env.PATH ?? "",
          HOME: process.env.HOME ?? "",
          LC_ALL: "C",
          GIT_TERMINAL_PROMPT: "0",
          GIT_OPTIONAL_LOCKS: "0",
          GIT_CONFIG_NOSYSTEM: "1",
        },
      },
      (error, stdout, stderr) => {
        if (!error) return done(stdout);
        // git grep exits 1, saying nothing, when nothing matches: that is an answer, not a failure.
        if (subcommand === "grep" && (error as { code?: unknown }).code === 1 && !stderr) return done("");
        const text =
          String(stderr || error.message)
            .trim()
            .split("\n")[0] ?? "";
        if ((error as { code?: string }).code === "ENOENT")
          return fail(new Error("git is not installed, or not on the PATH"));
        if (/not a git repository/i.test(text))
          return fail(new Error(`${repo} is not a git repository: set the repo setting (GIT_REPO) to a clone`));
        if (/dubious ownership/i.test(text))
          return fail(new Error(`git refuses ${repo}: it belongs to another user (safe.directory)`));
        if ((error as { killed?: boolean }).killed)
          return fail(new Error("git took too long and was stopped; narrow the question"));
        fail(new Error(`git ${subcommand} failed: ${text}`));
      },
    );
  });
}

const FORMAT = ["%H", "%an", "%aI", "%s"].join(SEP);

function commits(output: string) {
  return output
    .split(REC)
    .filter((chunk) => chunk.trim())
    .map((chunk) => {
      const [header = "", ...rest] = chunk.split("\n");
      const [sha = "", author = "", at = "", subject = ""] = header.split(SEP);
      const files = rest.map((line) => line.trim()).filter(Boolean);
      return {
        at,
        sha: sha.slice(0, 12),
        author,
        subject,
        files: files.slice(0, MAX_FILES),
        moreFiles: Math.max(0, files.length - MAX_FILES),
        summary: `${sha.slice(0, 8)} ${subject} (${author})`,
      };
    });
}

export async function log(
  params: { since?: string; until?: string; path?: string; author?: string; message?: string; limit: number },
  context: Context,
) {
  const args = [
    "--no-ext-diff",
    "--name-only",
    `--format=${REC}${FORMAT}`,
    `-n${Math.min(Math.max(params.limit, 1), MAX_COMMITS)}`,
  ];
  if (params.since) args.push(`--since=${instant(params.since, "since")}`);
  if (params.until) args.push(`--until=${instant(params.until, "until")}`);
  if (params.author) args.push(`--author=${params.author}`);
  if (params.message) args.push(`--grep=${params.message}`, "--fixed-strings", "--regexp-ignore-case");
  args.push(revision(context.settings.ref, "ref"), "--");
  args.push(...(params.path ? [inside(params.path)] : []), ...EXCLUDE_SECRETS);
  return commits(await git(context, "log", args));
}

export async function show({ commit }: { commit: string }, context: Context) {
  const out = await git(context, "show", [
    "--no-ext-diff",
    "--no-textconv",
    "--stat=100",
    `--format=${REC}${FORMAT}${SEP}%b${REC}`,
    revision(commit, "commit"),
    "--",
    ...EXCLUDE_SECRETS,
  ]);
  const [, record = "", stat = ""] = out.split(REC);
  const [sha = "", author = "", at = "", subject = "", body = ""] = record.split(SEP);
  const files = stat
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return [
    {
      at,
      sha: sha.slice(0, 12),
      author,
      subject,
      message: body.trim().slice(0, 2000),
      files: files.slice(0, MAX_FILES + 1),
      summary: `${sha.slice(0, 8)} ${subject} (${author}): ${files.at(-1) ?? "no file changed"}`,
    },
  ];
}

export async function diff({ from, to, path }: { from: string; to: string; path: string }, context: Context) {
  const target = inside(path);
  if (SECRET_FILE.test(target)) throw new Error(`${target} looks like a secrets file: the git addon does not read it`);
  const out = await git(context, "diff", [
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--unified=3",
    revision(from, "from"),
    revision(to, "to"),
    "--",
    target,
    ...EXCLUDE_SECRETS,
  ]);
  const added = (out.match(/^\+(?!\+\+)/gm) ?? []).length;
  const removed = (out.match(/^-(?!--)/gm) ?? []).length;
  return [
    {
      from,
      to,
      path: target,
      added,
      removed,
      patch:
        out.length > MAX_PATCH ? `${out.slice(0, MAX_PATCH)}\n… cut: ${out.length - MAX_PATCH} more characters` : out,
      summary: `${target} from ${from} to ${to}: +${added} -${removed}${out ? "" : " (no change)"}`,
    },
  ];
}

export async function grep({ text, path }: { text: string; path?: string }, context: Context) {
  if (!text.trim()) throw new Error("text must not be empty");
  const ref = revision(context.settings.ref, "ref");
  const out = await git(context, "grep", [
    "-n",
    "-I",
    "-F",
    "--no-color",
    "-e",
    text,
    ref,
    "--",
    ...(path ? [inside(path)] : []),
    ...EXCLUDE_SECRETS,
  ]);
  return out
    .split("\n")
    .filter(Boolean)
    .slice(0, MAX_COMMITS)
    .flatMap((line) => {
      // git prints "<ref>:<path>:<line>:<text>"
      const m = /^(.+?):(\d+):(.*)$/.exec(line.startsWith(`${ref}:`) ? line.slice(ref.length + 1) : line);
      if (!m) return [];
      const [, file = "", number = "", found = ""] = m;
      const shown = found.trim().slice(0, 240);
      return [{ path: file, line: Number(number), text: shown, ref, summary: `${file}:${number}: ${shown}` }];
    });
}

export async function fileAt(
  params: { path: string; ref?: string; startLine: number; lines: number },
  context: Context,
) {
  const path = inside(params.path);
  if (SECRET_FILE.test(path)) throw new Error(`${path} looks like a secrets file: the git addon does not read it`);
  const ref = revision(params.ref ?? context.settings.ref, "ref");
  const all = (await git(context, "cat-file", ["-p", `${ref}:${path}`])).split("\n");
  const start = Math.max(params.startLine, 1);
  const count = Math.min(Math.max(params.lines, 1), MAX_FILE_LINES);
  const slice = all.slice(start - 1, start - 1 + count);
  const end = start - 1 + slice.length;
  return [
    {
      path,
      ref,
      startLine: start,
      endLine: end,
      totalLines: all.length,
      content: slice.map((line, index) => `${start + index}: ${line}`).join("\n"),
      summary: `${path} at ${ref}, lines ${start}-${end} of ${all.length}`,
    },
  ];
}

export async function tags({ pattern, limit }: { pattern?: string; limit: number }, context: Context) {
  if (pattern !== undefined && !/^[\w.*-]+$/.test(pattern))
    throw new Error("pattern may only hold letters, digits, . - _ and *");
  const out = await git(context, "tag", [
    "--list",
    "--sort=-creatordate",
    `--format=%(refname:short)${SEP}%(creatordate:iso-strict)${SEP}%(subject)`,
    ...(pattern ? [pattern] : []),
  ]);
  return out
    .split("\n")
    .filter(Boolean)
    .slice(0, Math.min(Math.max(limit, 1), MAX_COMMITS))
    .map((line) => {
      const [name = "", at = "", subject = ""] = line.split(SEP);
      return { at, name, subject, summary: `tag ${name}${subject ? `: ${subject}` : ""}` };
    });
}
