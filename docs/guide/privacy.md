# Personal data: what leaves your machine

::: danger Read this before you connect a real system
help-me-ops sends nothing anywhere by itself. But **what its tools return is sent to the AI provider of your client** (Anthropic, OpenAI, GitHub/Microsoft, or whoever runs the model). If a log line, a database row or a pull request holds personal data, then so does what that provider receives. **help-me-ops hides only what you list** ([mask](#mask-it-a-safeguard-in-ops-config-json)). Do not connect a source whose data you are not allowed to send to your AI provider.
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

| Addon         | Can return                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------ |
| logs          | whatever your log lines contain: emails, user ids, IPs, names in free text                 |
| rest          | whatever the API returns on the paths you allow                                            |
| git           | code, commit messages, and the names and emails of authors                                 |
| PostgreSQL    | the rows your queries select                                                               |
| datadog       | log messages (often with user data); metrics and monitors rarely                           |
| github        | pull request and issue text, author logins and names                                       |
| prometheus    | metrics and alerts: label values (sometimes a user or customer id) and alert annotations   |
| loki          | log lines, with everything they contain: user ids, emails, IPs, bodies, names in free text |
| elasticsearch | the documents of the indices you list, every field of `_source`                            |
| knowledge     | your runbooks: often the names and phone numbers of people on call                         |

The **demo** holds only invented data.

## Mask it: a safeguard in `ops.config.json`

help-me-ops can hide values on the fly, in **everything its tools return**, before
the assistant (and its provider) sees them. List what to hide in `ops.config.json`:

```json
{
  "apps": { "...": "..." },
  "privacy": {
    "mask": {
      "fields": ["email", "phone", "customer.name", "*address*"],
      "patterns": ["email", "ip", "card", "iban", "phone", "token"]
    }
  }
}
```

| Setting        | What                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fields`       | keys whose **values** are hidden, at any depth, in the data of the evidence. **Case, underscores, hyphens and spaces are ignored**, so `firstName` also hides `first_name`, `first-name`, `FIRST_NAME` and `first name`; `*` is a wildcard (`*address*`, and `*firstname*` for a key that only contains it, like `given_first_name`); a dotted path (`customer.name`) names a nested key. |
| `patterns`     | what is hidden **wherever it appears in a text** (a log line, a summary, a runbook): `email`, `ip` (IPv4), `iban`, `card` (only numbers that pass the Luhn check), `phone` (international, starting with `+`), `token` (bearer tokens, cloud and GitHub keys, JWTs), or **your own regex**: `{ "name": "customer-id", "regex": "CUST-\\d{6}" }`.                                          |
| `placeholders` | `true` replaces a hidden value by a [stable placeholder](#keep-the-link-stable-placeholders) (`user-3f2a`) instead of the replacement. Off by default.                                                                                                                                                                                                                                    |
| `replacement`  | what replaces a hidden value, default `***` (it does not keep the length).                                                                                                                                                                                                                                                                                                                |

Which keys a field matches:

| You list          | Hides these keys                                                                 | Does not hide                                                                                             |
| ----------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `"firstName"`     | `firstName`, `first_name`, `first-name`, `FIRST_NAME`, `FirstName`, `first name` | `given_first_name`, `lastName`                                                                            |
| `"*firstname*"`   | all of the above, and `given_first_name`, `customer_first_name`                  | `lastName`                                                                                                |
| `"customer.name"` | the key `name` inside a key `customer` (any spelling of each)                    | a `name` anywhere else                                                                                    |
| `"*address*"`     | `address`, `billingAddress`, `email_address`                                     | `addr`                                                                                                    |
| `"name"`          | `name` and `NAME` only                                                           | `firstName`, `filename`, `hostname` (add a wildcard if you want them, knowing it also catches `filename`) |

It does not matter which addon returned the record: a field you list applies to **every** tool, one an addon declared nothing for included.

What it does with them:

- A value hidden under a key is **also hidden wherever the same record repeats it**: if `email` is a field, `jane@example.com` is stars in the summary too, not only in the `email` field.
- It runs at the one place every answer passes, so it covers **every addon** (yours included), the knowledge search and every client, with nothing to do in the addon. **A field you list applies even if the addon never declared it**: the workspace's own `fields` and `patterns` reach every answer; what an addon declares only adds to them.
- The answer says how many values were hidden (`"masked": 3`), `doctor` shows the rule (`Privacy: masking fields email; patterns card as ***`), and the assistant is told that a value shown as `***` was hidden on purpose and is not to be guessed.
- The [checked conclusion](/investigate#a-conclusion-that-is-checked) is built on what the assistant saw: a quote must be the masked line, so **the report never holds what was hidden**.
- If masking itself fails, the tool **fails** rather than answer unmasked, and a mistake in the configuration (an unknown pattern, a bad regex) is refused when the workspace loads.

Try it on the demo: add the block `"privacy": { "mask": { "fields": ["user"] } }` to the
demo's `ops.config.json`, restart, and ask about order 4512. The user `u-881`
reads `***`. (The demo scenario itself runs without the mask.)

### Keep the link: stable placeholders

With stars, a user id hidden in the order and in the logs reads `***` in both, and
the assistant cannot follow that user from one to the other. Turn on placeholders:

```json
"privacy": { "mask": { "fields": ["user"], "placeholders": true } }
```

A hidden value becomes the name of its key and a few hex digits, `user-3f2a`:

- **The same value is the same placeholder** in every tool and source of the session, and two values differ.
- **Give it back to a tool and it stands for the value**: `searchSource` for `user-3f2a` searches for the real user id, and the answer comes back masked again. An error that would repeat the input shows the placeholder.
- **It cannot be guessed.** The digits come from a keyed hash with a key made when the server starts: you cannot compute a placeholder from an email, and the same email is another placeholder in the next session.
- The [checked conclusion](/investigate#a-conclusion-that-is-checked) keeps the placeholders, and its report names `user-3f2a`. The mapping lives in the server's memory for the session only, so you cannot look it up afterwards.
- A value under a key that is an object or a list stays `***`.

::: warning A pseudonym is still personal data
The stars hide more. Placeholders hide the value but keep the linkage: the provider
sees that two lines concern the same person, not who. Whether that is acceptable is
a decision for the people who answer for your data, like the rest of this page.
:::

### Let an addon say what is personal

The people who know what is personal in a domain are the ones who write its addon:
the keys of an account record, a company id with a check digit. An addon can
**declare** it in its `addon.json`, once, and every workspace that uses it benefits:

```json
"privacy": {
  "personalFields": ["email", "contact.name"],
  "detectors": {
    "company-id": {
      "description": "A company id: ACME- and six digits, the last a Luhn check",
      "regex": "ACME-\\d{6}",
      "validate": "luhn",
      "examples": { "matches": ["ACME-123455"], "ignores": ["ACME-123456", "ACME-12"] }
    }
  }
}
```

The workspace then **switches it on**:

```json
"privacy": { "mask": { "fromAddons": ["acme"], "patterns": ["acme.company-id"] } }
```

- **`personalFields` are scoped**: with `fromAddons` (`true` for every addon, or a list), they are hidden in the answers of **that addon's own tools only**, so one addon's `name` does not hide another's.
- **Detectors are named `<addon>.<name>`** in `patterns`, and apply **everywhere**: the same company id is hidden in the logs, in a database row and in a runbook.
- **A checksum keeps it precise.** `validate` names a check the match must pass: `luhn` (card numbers, many company and tax ids) or `iban` (ISO 7064 mod 97-10). Without it, `ACME-\d{6}` hides any six digits; with it, only real ids.
- **A detector tests itself.** `examples.matches` must be hidden and `examples.ignores` must not; `npm run ops -- addon check <folder>` runs them and **fails** when the regex hides too little or too much, and warns when there are no examples.
- **It can only hide.** A detector is data (a regex, a case flag, a checksum name), not code: it cannot read, log or send anything. The regex is limited to 200 characters, and a repeated group that holds a repeat (`(a+)+`), which can make a search run away, is refused.
- **A reference that does not exist is an error when the workspace opens** (`"acme.company-id" is not a detector of a loaded addon`), never a mask that silently hides nothing. `doctor` shows what is declared (`fields declared by addons acme(email, contact.name)`).
- A company that keeps its **shared addons** in one folder (`OPS_ADDONS`) writes its identifiers once there.

On the demo, the `order` addon declares its `user` field and a `user-id` detector
(`u-881`). Add `"privacy": { "mask": { "fromAddons": ["order"], "patterns": ["order.user-id"] } }`
to the demo config: the order's user is `***`, and so is `user=u-881` in the logs.

::: warning A seat belt, not a guarantee

- **Free text is best effort.** A pattern finds an email address; it does not find a name in a sentence ("Jane called about her order"). Fields are reliable, patterns are not.
- **A hidden value cannot be used to search further.** If you hide an identifier the investigation needs (a user id), the assistant cannot follow it from one source to the next. Hide what identifies a person; leave the ids that identify an order or a request. To keep the link without the value, turn on [stable placeholders](#keep-the-link-stable-placeholders).
- **Detectors prefer a miss to hiding every number**: a card number is hidden only if it passes the Luhn check; IPv6 is not covered.
- It cannot see data **in the questions**: what you type to the assistant goes to the provider as you wrote it.
- **Playbooks are not masked**: they are written by your team.

Still do the first measure: [do not expose personal data in the first place](#what-to-do-strongest-first).
:::

## Declare which sources hold personal data

Say it once, in `ops.config.json`, where a reviewer can read it. A key is a
**source id**, an **addon name**, or `knowledge`; the value is `none` (holds no
personal data) or `possible`:

```json
"privacy": {
  "data": { "app-logs": "possible", "health": "none", "knowledge": "none" }
}
```

An addon can say it for itself (`personalData` in its `addon.json`, a default your
workspace overrides). The shipped addons declare `possible`: nothing external is
assumed free of personal data until you say so. A key that names nothing in the
workspace is an error when it opens. `doctor` prints the result:

```
Data: not strict; free of personal data: health, metrics; may hold some: app-logs, order; undeclared: knowledge
```

### Strict mode: serve only what is declared free of it

Off by default. With `"strict": true`, the assistant is served **only** what is
declared `none`:

```json
"privacy": { "strict": true, "data": { "app-logs": "none", "health": "none" } }
```

- `listSources` leaves the others out and lists them under `withheld`.
- A call to one is refused, with the line to add: `Strict mode: "order" is not declared free of personal data (undeclared). If it holds none, say so in ops.config.json: "privacy": { "data": { "order": "none" } }.`
- An addon is served or withheld **as a whole** (by its name), and so is `knowledge`. Tools that read no system (scope, playbooks, the conclusion check) are not concerned.
- A source or addon added later is undeclared, so strict mode withholds it until someone declares it.

::: warning It is your word, not a check
help-me-ops does not look inside a source. Declaring `none` for logs that hold
emails is a mistake strict mode cannot see; the [mask](#mask-it-a-safeguard-in-ops-config-json) is still the safeguard, and so is not exposing the data in the first place.
:::

## What help-me-ops does and does not do today

|                                                               | Today                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Keeps secrets (tokens, passwords) out of messages             | yes: secret settings are never printed, errors included                              |
| Leaves files that usually hold secrets out of the `git` addon | yes (`.env`, keys), best effort                                                      |
| Stores evidence or conversations                              | no                                                                                   |
| Hides the fields and patterns you list in what tools return   | **yes, opt in** ([above](#mask-it-a-safeguard-in-ops-config-json))                   |
| Finds personal data you did not list                          | no: a name in free text stays                                                        |
| Knows which sources hold personal data                        | **what you declare**, shown by `doctor`; it does not look inside                     |
| Serves only sources declared free of it                       | **yes, opt in** ([strict mode](#strict-mode-serve-only-what-is-declared-free-of-it)) |

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

1. **Local models** through API mode.

The mask is a second line of defence, never a guarantee of anonymity: the first measure above is the one to rely on.
