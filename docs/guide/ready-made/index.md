# Ready-made addons

An **addon** teaches help-me-ops to read one more place. Some ship with it, so
you **configure them instead of writing them**. This page is the map: what each
one reads, what you need to have before you start, and where to find the steps.

## At a glance

| Addon          | Reads                                                 | You need                                                              | Status                       |                              |
| -------------- | ----------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------- | ---------------------------- |
| **logs**       | text log files, one event per line                    | the file, readable from this machine                                  | ready                        | [page](/ready-made/logs)     |
| **rest**       | your own HTTP API, `GET` only, on the paths you allow | its URL, the allowed path prefixes, a read-only token if it needs one | ready                        | [page](/ready-made/rest)     |
| **git**        | a repository on disk: tags, commits, diffs, code      | `git` installed and an up-to-date clone                               | ready                        | [page](/ready-made/git)      |
| **PostgreSQL** | a database, `SELECT` only                             | the `pg` driver and a read-only database user                         | template + [demo](/database) | [page](/ready-made/postgres) |
| **datadog**    | Datadog logs, metrics and monitors                    | an API key, an application key with read scopes, your site            | **experimental**             | [page](/ready-made/datadog)  |
| **github**     | pull requests, releases, commits, issues, builds      | a fine-grained read-only token, the list of repositories              | **experimental**             | [page](/ready-made/github)   |

_Ready_ means it has been run for real (a log file, a live HTTP backend, a real
git repository, a real PostgreSQL). _Experimental_ means written from the
service's documented API and tested against recorded responses and a mock, but
**not yet against a real account**: it may not work as is on yours.
[More on that](/legal#experimental-integrations).

Not in this list? An addon is two small files: [write one](/addons), or start
from a template with `npm run ops -- init addon <name> --template file|api|sql`.

## Which one for which question

| You want to know                             | Use                                                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| what the application said around the failure | **logs**, or **datadog** if your logs are there                                                           |
| what a metric did (queue, memory, latency)   | **datadog**, or an addon of your own on your metrics store                                                |
| what changed before it broke                 | **git** (what the code was), **github** (who merged what, when a release shipped, whether a build failed) |
| what the data says (did the customer pay?)   | **PostgreSQL** (template)                                                                                 |
| what an internal service answers             | **rest**                                                                                                  |
| what is alerting right now                   | **datadog** (monitors)                                                                                    |

## How every ready-made addon is turned on

They are always installed and **idle**: an idle addon serves no tool, prints
nothing and costs nothing. Four steps turn one on, the same for all:

1. **Get what it needs** (the "You need" table of its page): a key, a token, a clone.
2. **Put secrets in `.env`**, in the help-me-ops clone (git-ignored). Never in a file you commit.
3. **Add a block** for the addon under the environment that has it, in `ops.config.json`, referring to secrets as `${NAME}`:

   ```json
   "prod": {
     "sources": [],
     "addons": { "rest": { "baseUrl": "https://api.example.com", "allow": "/orders", "token": "${PROD_API_TOKEN}" } }
   }
   ```

4. **Check, then restart your AI client**: `npm run ops -- doctor` must show the addon `loaded`.

Each environment has its own block, so prod and staging can use different
accounts, and a question about prod is never answered from staging. Where
the settings are all given by environment variables (the table of each page lists
them), no block is needed, and the same settings then apply to every environment.

Run every command from the help-me-ops clone, once `npm install` is done; the
workspace is the only thing that may live elsewhere
([where do I run what](/getting-started#where-do-i-run-what)).

### What `doctor` says

```bash
npm run ops -- doctor
```

| Status                                                           | Meaning                                                                                   |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `loaded`                                                         | set up, its tools are served                                                              |
| `idle ... no environment sets it up`                             | installed, not used: add its block (step 3)                                               |
| `idle ... waiting for NAME`                                      | the block refers to `${NAME}`, or only some of its variables are set: set the missing one |
| `loaded` with `! unavailable in shop/prod: invalid settings ...` | set up, but a setting is missing or wrong in that environment                             |
| `skipped ... <reason>`                                           | the addon itself could not load (a missing package, a wrong version)                      |

## Try each one without an account

The demo workspace has stand-ins, so you can see every addon work before pointing
it at anything of yours: a small **live backend** in Docker (the shop's REST API,
a mock of three Datadog APIs and of six GitHub endpoints), a script that builds a
**git repository**, and a **PostgreSQL** with a `SELECT`-only user. Each page has a
"Try it without an account" section; the
[demo workspace README](https://github.com/bhoudebert/help-me-ops/blob/main/examples/my-workspace/README.md)
lists them in one place.

## The same rules for all

- **Read-only.** Every tool declares it, a test checks it, and each addon fences itself in (allow-lists, fixed requests, capped answers). Give each one an account that can only read: that is your part ([why](/addons#read-only-your-part)).
- **Secrets stay out of files and messages.** They live in `.env` and are never printed, errors included.
- **A broken addon never takes the rest down.** It is skipped or refused with one line saying why.
- **Independent.** help-me-ops is not affiliated with the products it reads: [independence and trademarks](/legal).
