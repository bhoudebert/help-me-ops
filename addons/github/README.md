# github

Read pull requests, releases, commits, issues and workflow runs of the repositories you list.

- **Status:** **experimental** (see [what that means](https://bhoudebert.github.io/help-me-ops/guide/legal#experimental-integrations))
- **You need:** a fine-grained token with the five _Read_ permissions on those repositories, the list of repositories
- **Tools:** `github.pullRequests`, `github.pullRequest`, `github.releases`, `github.commits`, `github.issues`, `github.workflowRuns`
- **Variables:** `GITHUB_TOKEN`, `GITHUB_REPOS`, `GITHUB_API_URL`
- **Read-only:** yes. Idle until an environment sets it up; it serves nothing and prints nothing until then.

Everything about it (set-up steps, settings, what it can do, safety, a demo
without an account, troubleshooting) is in the guide:
<https://bhoudebert.github.io/help-me-ops/guide/ready-made/github>, source in
[`docs/guide/ready-made/github.md`](../../docs/guide/ready-made/github.md).
