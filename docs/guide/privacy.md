# Personal data: what leaves your machine

::: danger Read this before you connect a real system
help-me-ops sends nothing anywhere by itself. But **what its tools return is sent to the AI provider of your client** (Anthropic, OpenAI, GitHub/Microsoft, or whoever runs the model). If a log line, a database row or a pull request holds personal data, then so does what that provider receives. **help-me-ops does not filter it today.** Do not connect a source whose data you are not allowed to send to your AI provider.
:::

## Where the data goes

```
your system ──▶ an addon or connector ──▶ the tool's result ──▶ your AI client ──▶ the model
(logs, DB, API)   (runs on your machine)    (evidence)          (Claude Code,        (the provider's
                                                                 Codex, Copilot)     servers, unless local)
```

- help-me-ops runs **on your machine**. It reads your systems with the accounts you give it, and hands the results to your AI client. It makes no network call of its own except to the systems you configure, and **it stores nothing on disk**: the evidence of a session is kept in memory to check the conclusion, and gone when the server stops.
- Your **AI client** sends the conversation, tool results included, to its model. Whether that is kept, for how long, and whether it is used for training is decided by **your agreement with that provider and your client's settings**, not by this project.
- The final answer is written by the model from the evidence: **personal data in the evidence can end up in the conclusion**, which is then in your chat history.

## What to do, strongest first

1. **Do not expose personal data in the first place.** This is the only measure that is really strong, and it is on your side of the connection:
   - a database: connect a **view or a replica without the personal columns**, or give the read-only user `SELECT` on the columns that are not personal only;
   - a REST API: list only the **paths that return no personal data** in `allow`;
   - logs: **scrub them at the source** (your log pipeline), so the file has no emails, names or card numbers to begin with.
2. **Connect only what an investigation needs.** Each source is a decision: a production application log holds more than a queue depth.
3. **Know the terms of your provider.** An enterprise plan, a data-processing agreement, zero-retention settings, the region where it is processed: check them for the client you use.
4. **Use a model that stays with you** when the data cannot leave: see [local models](#local-models).
5. **Tell the people who answer for it.** Sending personal data to a processor is a decision for your data protection officer or your security team, not for the person who installs a tool. (This is not legal advice.)
6. **Read-only accounts, least privilege**: it limits what can be read, which also limits what can leak.

## What each addon can return

Each ready-made addon page has a **"Data it can return"** section. In short:

| Addon      | Can return                                                                 |
| ---------- | -------------------------------------------------------------------------- |
| logs       | whatever your log lines contain: emails, user ids, IPs, names in free text |
| rest       | whatever the API returns on the paths you allow                            |
| git        | code, commit messages, and the names and emails of authors                 |
| PostgreSQL | the rows your queries select                                               |
| datadog    | log messages (often with user data); metrics and monitors rarely           |
| github     | pull request and issue text, author logins and names                       |
| knowledge  | your runbooks: often the names and phone numbers of people on call         |

The **demo** holds only invented data.

## What help-me-ops does and does not do today

|                                                               | Today                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------- |
| Keeps secrets (tokens, passwords) out of messages             | yes: secret settings are never printed, errors included |
| Leaves files that usually hold secrets out of the `git` addon | yes (`.env`, keys), best effort                         |
| Stores evidence or conversations                              | no                                                      |
| **Filters or masks personal data in what tools return**       | **no**                                                  |
| Knows which sources hold personal data                        | no: a source is not marked                              |

## Local models

The strongest answer when data must not leave your network is a model that runs
on your side. Two ways, and neither is automatic:

- **An MCP client that can use a local model.** help-me-ops is an MCP server, so any MCP-capable client works; some of them can run against a local model (through Ollama, LM Studio or an OpenAI-compatible server). Which clients, and how well, changes quickly: check your client's documentation. Claude Code, Codex and Copilot are tested here with their own models.
- **API mode**, on the [roadmap](https://github.com/bhoudebert/help-me-ops/blob/main/ROADMAP.md): running the investigation from the terminal against any model API, a local one included.

Two honest caveats. A **small local model uses tools and long evidence worse**
than a large hosted one, so expect weaker investigations. And the
[checked conclusion](/investigate#a-conclusion-that-is-checked) helps exactly
there: whatever the model, it cannot cite a line no tool returned.

## What is coming

On the [roadmap](https://github.com/bhoudebert/help-me-ops/blob/main/ROADMAP.md), in this order:

1. **Declare the data**: each source says whether it can return personal data, and `doctor` shows it.
2. **Mask it**: fields to drop, patterns to hide (emails, phone numbers, card and bank numbers, IP addresses, tokens), and stable placeholders (`user-3f2a`) so the assistant can still follow one customer across sources. Structured data (a column, a field) can be masked reliably; **free text (a log message, a pull request) cannot**, a name in a sentence is not recognised by a pattern. So masking will be a second line of defence, never a guarantee of anonymity.
3. **A strict mode** that serves only the sources declared free of personal data.
4. **Local models** through API mode.

Until then, the first measure above is the one to rely on.
