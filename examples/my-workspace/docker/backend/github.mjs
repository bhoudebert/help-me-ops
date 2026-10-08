// A mock of six GitHub REST API endpoints for the demo (not GitHub, and no
// GitHub code or data): their documented request and response shapes, answered
// from the recorded data of the workspace (data/github/*.json) for one
// repository, shop-co/shop. It lets the github addon run without an account.
//
//   GET /repos/{owner}/{repo}/pulls            List pull requests
//   GET /repos/{owner}/{repo}/pulls/{n}        Get a pull request
//   GET /repos/{owner}/{repo}/pulls/{n}/files  List a pull request's files
//   GET /repos/{owner}/{repo}/releases         List releases
//   GET /repos/{owner}/{repo}/commits          List commits
//   GET /repos/{owner}/{repo}/issues           List issues
//   GET /repos/{owner}/{repo}/actions/runs     List workflow runs
//
// It authenticates with a bearer token (401 "Bad credentials" otherwise), answers
// 404 for any other repository, and refuses anything but GET. Filters understood:
// state, labels, since, until, path, sha (ignored), branch, status, per_page.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const GITHUB_TOKEN = "demo-github-token";
export const GITHUB_REPO = "shop-co/shop";

const data = (workspace, name) => JSON.parse(readFileSync(join(workspace, "data", "github", `${name}.json`), "utf8"));
const strip = ({ _files, ...rest }) => rest;
const newest = (key) => (a, b) => Date.parse(b[key]) - Date.parse(a[key]);

/** Handles a /repos/... request; resolves true when it answered. */
export function githubApi(workspace, request, response, url) {
  if (!url.pathname.startsWith("/repos/")) return false;
  const send = (status, body) => {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(body));
  };
  if (request.headers.authorization !== `Bearer ${GITHUB_TOKEN}`) {
    send(401, { message: "Bad credentials", documentation_url: "https://docs.github.com/rest" });
    return true;
  }
  if (request.method !== "GET") {
    send(405, { message: "the demo's mock of GitHub is read-only: only GET" });
    return true;
  }
  const m = /^\/repos\/([^/]+)\/([^/]+)\/(.+)$/.exec(url.pathname);
  if (!m || `${m[1]}/${m[2]}`.toLowerCase() !== GITHUB_REPO) {
    send(404, { message: "Not Found" });
    return true;
  }
  const q = url.searchParams;
  const perPage = Math.min(Number(q.get("per_page") ?? 30), 100);
  const at = (value, key, after) =>
    !q.get(key) || (after ? Date.parse(value) >= Date.parse(q.get(key)) : Date.parse(value) <= Date.parse(q.get(key)));
  const states = (items) =>
    items.filter(
      (i) =>
        !q.get("state") ||
        q.get("state") === "all" ||
        i.state === q.get("state") ||
        (q.get("state") === "closed" && i.merged_at),
    );
  const route = m[3];
  let found;
  if (route === "pulls") {
    found = states(data(workspace, "pulls")).sort(newest("updated_at")).slice(0, perPage).map(strip);
  } else if (/^pulls\/\d+$/.test(route)) {
    const pr = data(workspace, "pulls").find((p) => String(p.number) === route.split("/")[1]);
    if (!pr) return (send(404, { message: "Not Found" }), true);
    found = strip(pr);
  } else if (/^pulls\/\d+\/files$/.test(route)) {
    const pr = data(workspace, "pulls").find((p) => String(p.number) === route.split("/")[1]);
    if (!pr) return (send(404, { message: "Not Found" }), true);
    found = pr._files.slice(0, perPage);
  } else if (route === "releases") {
    found = data(workspace, "releases").sort(newest("published_at")).slice(0, perPage);
  } else if (route === "commits") {
    found = data(workspace, "commits")
      .filter((c) => at(c.commit.author.date, "since", true) && at(c.commit.author.date, "until", false))
      .filter(
        (c) =>
          !q.get("path") ||
          c._files.some((f) => f === q.get("path") || f.startsWith(`${q.get("path").replace(/\/$/, "")}/`)),
      )
      .sort((a, b) => Date.parse(b.commit.author.date) - Date.parse(a.commit.author.date))
      .slice(0, perPage)
      .map(strip);
  } else if (route === "issues") {
    const labels = q.get("labels")?.split(",") ?? [];
    found = states(data(workspace, "issues"))
      .filter((i) => at(i.updated_at, "since", true))
      .filter((i) => labels.every((l) => i.labels.some((x) => x.name === l)))
      .sort(newest("updated_at"))
      .slice(0, perPage);
  } else if (route === "actions/runs") {
    const runs = data(workspace, "runs")
      .workflow_runs.filter((r) => !q.get("branch") || r.head_branch === q.get("branch"))
      .filter((r) => !q.get("status") || r.status === q.get("status") || r.conclusion === q.get("status"));
    found = { total_count: runs.length, workflow_runs: runs.slice(0, perPage) };
  } else {
    send(404, { message: "Not Found" });
    return true;
  }
  send(200, found);
  return true;
}
