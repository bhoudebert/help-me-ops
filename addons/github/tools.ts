// The github addon: read pull requests, releases, commits, issues and workflow
// runs of the repositories you list, through GitHub's REST API.
//
// Read-only by construction: GET only, six fixed paths built here, a repository
// only if it is in the `repos` list, numbers checked as integers, redirects not
// followed, answers capped, calls timed out, and the token is a secret setting
// that never appears in an error. Use a fine-grained token limited to those
// repositories with read permissions: even a bug here could not write.
//
// The text of pull requests and issues is written by other people. It comes back
// trimmed, and the tool descriptions tell the assistant it is evidence, not
// instructions.
interface Settings {
  token: string;
  repos: string;
  baseUrl: string;
}
interface Context {
  settings: Settings;
  fetch: typeof fetch;
}

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2_000_000;
const MAX_ITEMS = 50;
const MAX_TEXT = 500;

/** The repositories the settings allow, lowercase owner/name. */
function allowed(settings: Settings): string[] {
  const repos = settings.repos
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  for (const repo of repos) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error(`"${repo}" in the repos setting is not owner/name`);
  }
  if (!repos.length) throw new Error("the repos setting lists no repository");
  return repos;
}

/** The repository asked for, if it is listed; the only one when the question names none. */
function pick(settings: Settings, wanted: string | undefined): string {
  const repos = allowed(settings);
  if (!wanted) {
    if (repos.length === 1) return repos[0]!;
    throw new Error(`which repository? one of ${repos.join(", ")}`);
  }
  const found = repos.find((r) => r.toLowerCase() === wanted.toLowerCase());
  if (!found) throw new Error(`repository ${wanted} is not in the list this addon may read (${repos.join(", ")})`);
  return found;
}

const limit = (value: number) => String(Math.min(Math.max(value, 1), MAX_ITEMS));

function instant(value: string, what: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw new Error(`${what} "${value}" must be a time in ISO 8601 form`);
  return new Date(time).toISOString();
}

const trim = (text: unknown, max = MAX_TEXT): string | undefined =>
  typeof text === "string" && text ? (text.length > max ? `${text.slice(0, max)}… (cut)` : text) : undefined;

async function get(context: Context, path: string, query: Record<string, string> = {}): Promise<unknown> {
  const { settings, fetch } = context;
  const url = new URL(`${settings.baseUrl.replace(/\/$/, "")}${path}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${settings.token}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "help-me-ops",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error(
      `GitHub redirected ${path} (${response.status}): the repository may have moved; update the repos setting`,
    );
  }
  if (response.status === 401) throw new Error("GitHub refused the token (401): check it, its expiry and the API URL");
  if (response.status === 403 || response.status === 429) {
    const reset = response.headers.get("x-ratelimit-reset");
    if (response.headers.get("x-ratelimit-remaining") === "0" || response.status === 429) {
      throw new Error(
        `GitHub rate limit reached${reset ? ` (resets at ${new Date(Number(reset) * 1000).toISOString()})` : ""}`,
      );
    }
    throw new Error("GitHub refused the request (403): the token lacks a read permission on this repository");
  }
  if (response.status === 404)
    throw new Error(
      `GitHub answered 404 on ${path}: the repository or the item does not exist, or the token cannot see it`,
    );
  const text = await response.text();
  if (!response.ok) throw new Error(`GitHub answered ${response.status} on ${path}: ${text.slice(0, 200)}`);
  if (text.length > MAX_BYTES)
    throw new Error(`GitHub's answer on ${path} is larger than ${MAX_BYTES} bytes; narrow the question`);
  return JSON.parse(text);
}

// GitHub's JSON, read field by field below: its shape is documented, not typed here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const who = (user: Json | null | undefined) => (user?.login as string | undefined) ?? "unknown";

export async function pullRequests(
  params: { repo?: string; state: string; mergedSince?: string; limit: number },
  context: Context,
) {
  const repo = pick(context.settings, params.repo);
  const since = params.mergedSince ? Date.parse(instant(params.mergedSince, "mergedSince")) : undefined;
  const list = (await get(context, `/repos/${repo}/pulls`, {
    state: params.state,
    sort: "updated",
    direction: "desc",
    per_page: since === undefined ? limit(params.limit) : String(MAX_ITEMS),
  })) as Json[];
  return list
    .filter((pr) => since === undefined || (pr.merged_at && Date.parse(pr.merged_at) >= since))
    .slice(0, Number(limit(params.limit)))
    .map((pr) => ({
      at: pr.merged_at ?? pr.closed_at ?? pr.updated_at,
      repo,
      number: pr.number,
      title: pr.title,
      state: pr.merged_at ? "merged" : pr.state,
      author: who(pr.user),
      mergedAt: pr.merged_at,
      branch: pr.head?.ref,
      url: pr.html_url,
      summary: `${repo}#${pr.number} ${pr.title} (${who(pr.user)}, ${pr.merged_at ? `merged ${pr.merged_at}` : pr.state})`,
    }));
}

export async function pullRequest({ repo: wanted, number }: { repo?: string; number: number }, context: Context) {
  const repo = pick(context.settings, wanted);
  if (!Number.isInteger(number) || number < 1) throw new Error("number must be a positive integer");
  const pr = (await get(context, `/repos/${repo}/pulls/${number}`)) as Json;
  const files = (await get(context, `/repos/${repo}/pulls/${number}/files`, { per_page: "30" })) as Json[];
  return [
    {
      at: pr.merged_at ?? pr.closed_at ?? pr.updated_at,
      repo,
      number: pr.number,
      title: pr.title,
      state: pr.merged_at ? "merged" : pr.state,
      author: who(pr.user),
      mergedBy: pr.merged_by ? who(pr.merged_by) : undefined,
      mergedAt: pr.merged_at,
      description: trim(pr.body),
      additions: pr.additions,
      deletions: pr.deletions,
      changedFiles: pr.changed_files,
      files: files.map((f) => `${f.filename} (+${f.additions} -${f.deletions})`),
      url: pr.html_url,
      summary: `${repo}#${pr.number} ${pr.title}: ${pr.changed_files ?? files.length} files, +${pr.additions ?? 0} -${pr.deletions ?? 0}`,
    },
  ];
}

export async function releases({ repo: wanted, limit: count }: { repo?: string; limit: number }, context: Context) {
  const repo = pick(context.settings, wanted);
  const list = (await get(context, `/repos/${repo}/releases`, { per_page: limit(count) })) as Json[];
  return list.map((r) => ({
    at: r.published_at ?? r.created_at,
    repo,
    tag: r.tag_name,
    name: r.name,
    author: who(r.author),
    prerelease: r.prerelease,
    notes: trim(r.body),
    url: r.html_url,
    summary: `${repo} release ${r.tag_name}${r.name && r.name !== r.tag_name ? ` "${r.name}"` : ""}${r.prerelease ? " (pre-release)" : ""}`,
  }));
}

export async function commits(
  params: { repo?: string; branch?: string; path?: string; since?: string; until?: string; limit: number },
  context: Context,
) {
  const repo = pick(context.settings, params.repo);
  const query: Record<string, string> = { per_page: limit(params.limit) };
  if (params.branch) query.sha = params.branch;
  if (params.path) query.path = params.path;
  if (params.since) query.since = instant(params.since, "since");
  if (params.until) query.until = instant(params.until, "until");
  const list = (await get(context, `/repos/${repo}/commits`, query)) as Json[];
  return list.map((c) => {
    const subject = String(c.commit?.message ?? "").split("\n")[0] ?? "";
    return {
      at: c.commit?.author?.date,
      repo,
      sha: String(c.sha).slice(0, 12),
      author: c.commit?.author?.name ?? who(c.author),
      subject,
      url: c.html_url,
      summary: `${String(c.sha).slice(0, 8)} ${subject} (${c.commit?.author?.name ?? who(c.author)})`,
    };
  });
}

export async function issues(
  params: { repo?: string; state: string; labels?: string; since?: string; limit: number },
  context: Context,
) {
  const repo = pick(context.settings, params.repo);
  const query: Record<string, string> = {
    state: params.state,
    sort: "updated",
    direction: "desc",
    per_page: limit(params.limit),
  };
  if (params.labels) query.labels = params.labels;
  if (params.since) query.since = instant(params.since, "since");
  const list = (await get(context, `/repos/${repo}/issues`, query)) as Json[];
  return list
    .filter((issue) => !issue.pull_request)
    .map((issue) => ({
      at: issue.updated_at,
      repo,
      number: issue.number,
      title: issue.title,
      state: issue.state,
      author: who(issue.user),
      labels: (issue.labels as Json[] | undefined)?.map((l) => l.name),
      createdAt: issue.created_at,
      description: trim(issue.body),
      url: issue.html_url,
      summary: `${repo}#${issue.number} ${issue.title} (${issue.state}, ${who(issue.user)})`,
    }));
}

export async function workflowRuns(
  params: { repo?: string; branch?: string; status?: string; limit: number },
  context: Context,
) {
  const repo = pick(context.settings, params.repo);
  const query: Record<string, string> = { per_page: limit(params.limit) };
  if (params.branch) query.branch = params.branch;
  if (params.status) query.status = params.status;
  const answer = (await get(context, `/repos/${repo}/actions/runs`, query)) as Json;
  return ((answer.workflow_runs as Json[] | undefined) ?? []).map((run) => ({
    at: run.run_started_at ?? run.created_at,
    repo,
    id: run.id,
    name: run.name,
    title: run.display_title,
    status: run.status,
    conclusion: run.conclusion,
    branch: run.head_branch,
    event: run.event,
    url: run.html_url,
    summary: `${run.name} "${run.display_title ?? ""}" on ${run.head_branch}: ${run.conclusion ?? run.status}`,
  }));
}
