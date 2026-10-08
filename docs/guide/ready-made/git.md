# git: what changed before the incident

Read a git repository on disk: the tags, commits, diffs and code of what was deployed, with no token and no network.

**Status:** ready · **Tools:** 6 · **Read-only:** yes ([why](#safety))

## What you need

| You need                                           | Why                                  | How to get it                                         |
| -------------------------------------------------- | ------------------------------------ | ----------------------------------------------------- |
| `git` installed                                    | the addon runs it (tested with 2.55) | `git --version` on the machine running help-me-ops    |
| A **clone** of the repository on that machine      | there is nothing to call remotely    | `git clone ...`, anywhere readable                    |
| An **up-to-date** clone                            | the addon never fetches or pulls     | `git fetch --all --tags` yourself, or from a cron job |
| The **branch or tag deployed** in each environment | so prod is read at what prod runs    | e.g. `v2.14.0`, `main`, `release/2.14`                |
| No credentials                                     | nothing leaves the machine           | -                                                     |

## Set it up

**1. Clone and update** the repository:

```bash
git clone https://github.com/acme/shop.git /home/me/code/shop
git -C /home/me/code/shop fetch --all --tags      # again before an investigation
```

**2. Add it to the environments**, in `ops.config.json` (the path is absolute, or relative to the workspace):

```json
"prod":    { "sources": [], "addons": { "git": { "repo": "/home/me/code/shop", "ref": "v2.14.0" } } },
"staging": { "sources": [], "addons": { "git": { "repo": "/home/me/code/shop", "ref": "main" } } }
```

The path is absolute, or relative to the workspace folder; `~` is not expanded.

**3. Check and restart.** `npm run ops -- doctor` must say `git ... loaded`; restart your client.

With variables alone: `GIT_REPO` (and `GIT_REF`) set the same repository for every environment.

### Settings

| Setting |                | Variable   | What                                                                                                               |
| ------- | -------------- | ---------- | ------------------------------------------------------------------------------------------------------------------ |
| `repo`  | required       | `GIT_REPO` | The repository folder, absolute or relative to the workspace (a clone you keep up to date)                         |
| `ref`   | default `HEAD` | `GIT_REF`  | The branch, tag or commit deployed in this environment; history is read from it (e.g. main, release/2.14, v2.14.0) |

## What it can do

| Tool         | What it does                                                                                                                                                                        | Parameters (`?` = optional)                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `git.log`    | Commits of the repository before an incident: who changed what and when, newest first, with the files they touched. Use it to see what changed before a problem started. Read-only. | `since?`, `until?`, `path?`, `author?`, `message?`, `limit?` |
| `git.show`   | One commit in full: author, time, message and the files it changed with their size. Read-only.                                                                                      | `commit`                                                     |
| `git.diff`   | The changes of one file or folder between two commits, tags or branches, as a patch (cut when long). Read-only.                                                                     | `from`, `to`, `path`                                         |
| `git.grep`   | Search the code of the repository at the deployed ref for a text (not a regex): where a message, an error or a setting is defined. Read-only.                                       | `text`, `path?`                                              |
| `git.fileAt` | Read one file of the repository as it is at a commit, tag or branch, cut when long. Read-only.                                                                                      | `path`, `ref?`, `startLine?`, `lines?`                       |
| `git.tags`   | The tags of the repository with their dates: which release shipped when, to match a release to the commits before it. Read-only.                                                    | `pattern?`, `limit?`                                         |

Every result becomes **evidence**: a piece of data with its source and, when it has one, its time, which the assistant quotes in its conclusion.

## Ask it

- "What changed in the code in the three days before the 2.14.0 release?"
- "Which release shipped at 09:30, and what was in it?"
- "Show me the diff of `src/worker/confirm.js` between v2.13.2 and v2.14.0."
- "Where is the message 'queue full' produced in the code?"

Each commit, tag, patch, match or file excerpt becomes evidence with its time, so a conclusion can say "commit 6e0ff87, on 5 October, changed the worker".

## Safety

It runs git, so it is built not to be talked into anything but reading:

- only `log`, `show`, `diff`, `grep`, `tag` and `cat-file` exist in the code, run with an argument list and **never a shell**;
- a branch, tag or path from the question is **one argument that cannot be an option** (no leading `-`, no `..`, paths after `--`): `--output=somewhere` is refused, not obeyed;
- a repository's own configuration cannot run a program: external diff drivers, text conversion, pagers and file-system monitors are switched off (the tests build a hostile repository to prove it);
- files that usually hold secrets (`.env`, `*.pem`, `*.key`, SSH keys) are **refused or left out** of every answer. A seat belt: secrets do not belong in a repository;
- answers are capped and calls time out. The repository is left unchanged.

## Data it can return

Code and **commit messages**, and the **names and email addresses of the authors** of every commit. Files that usually hold secrets are left out, best effort; personal data committed by mistake (a test fixture with real customers) is not recognised.

**What to do:** treat the repository like what you are willing to send to your AI provider; keep real data out of it.

What leaves your machine, and what to do about it: [personal data](/privacy).

## Try it without an account

A script builds a real demo repository (a repository cannot be stored inside this one), with the changes that led to the incident. It needs only `git` and Node.

```bash
# from the help-me-ops clone
node examples/my-workspace/git-demo/build.mjs        # makes examples/my-workspace/.demo-repo
echo 'SHOP_REPO=.demo-repo' >> .env                  # relative to the workspace
npm run ops -- --workspace examples/my-workspace doctor     # git: loaded
```

Ask: "what changed in the code before the incident? The release 2.14.0 went out on 7 October at 09:30." The assistant finds **two suspects**: a change that batches confirmations and keeps them in a cache that is never emptied (5 October), and a change that lowers the worker's memory limit to 512Mi (6 October). It cannot tell which one is the cause, and says so.

## If it does not work

Run `npm run ops -- doctor` first: it lists the addon as `loaded`, `idle` or `skipped`, with the reason.

| `doctor` or an error says                       | It means                                       | Do                                                |
| ----------------------------------------------- | ---------------------------------------------- | ------------------------------------------------- |
| `idle ... waiting for GIT_REPO`                 | only `GIT_REF` is set, or the block is absent  | set `repo`                                        |
| `... is not a git repository`                   | `repo` points to a folder that is not a clone  | fix the path; check `git -C <repo> status`        |
| `git refuses ...: it belongs to another user`   | git's `safe.directory` protection              | `git config --global --add safe.directory <repo>` |
| `ref "..." is not a commit, tag or branch name` | a name with `..`, spaces or a leading `-`      | use a plain name                                  |
| `git log failed: ... unknown revision`          | the `ref` does not exist in that clone         | fetch it, or fix `ref`                            |
| `looks like a secrets file`                     | the file name matches `.env`, a key or similar | by design: not readable here                      |
| `git took too long`                             | a huge repository or range                     | narrow with `since`, `path`, `limit`              |

## Limits

The addon reads one repository per environment; it does not fetch, so a stale clone gives a stale answer; at most 100 commits per call, patches are cut at about 6000 characters, files at 400 lines. Tested with git 2.55 on Linux, not yet on Windows or on very large repositories.
