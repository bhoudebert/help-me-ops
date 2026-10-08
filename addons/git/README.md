# git

Read a git repository on disk: tags, commits, diffs, code search.

- **Status:** ready (see [what that means](https://bhoudebert.github.io/help-me-ops/guide/legal#experimental-integrations))
- **You need:** `git` installed and an up-to-date clone; no token, no network
- **Tools:** `git.log`, `git.show`, `git.diff`, `git.grep`, `git.fileAt`, `git.tags`
- **Variables:** `GIT_REPO`, `GIT_REF`
- **Read-only:** yes. Idle until an environment sets it up; it serves nothing and prints nothing until then.

Everything about it (set-up steps, settings, what it can do, safety, a demo
without an account, troubleshooting) is in the guide:
<https://bhoudebert.github.io/help-me-ops/guide/ready-made/git>, source in
[`docs/guide/ready-made/git.md`](../../docs/guide/ready-made/git.md).
