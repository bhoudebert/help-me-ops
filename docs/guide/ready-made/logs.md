# logs: text log files

Search plain-text log files, one event per line, per app and environment. The
only ready-made source that is not an addon you switch on: it is a **source
type**, `file-logs`, built in.

**Status:** ready · **Read-only:** yes

## What you need

| You need                                                 | Why                                         | How to get it                                                                                |
| -------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| A log file readable from the machine running help-me-ops | it is read directly                         | a path, absolute or relative to the workspace; a mounted or copied file for a remote service |
| Lines that **start with an ISO 8601 time**               | that is how events are ordered and windowed | `2026-10-07T10:00:02Z ERROR payments webhook ... returned 503`                               |

Nothing to install, no credentials.

## Set it up

Add the file as a **source** of the environment it belongs to, in `ops.config.json`:

```json
"prod": {
  "sources": [
    {
      "id": "app-logs",
      "type": "file-logs",
      "path": "/var/log/shop/app.log",
      "description": "Application logs of the API, payments and workers"
    }
  ]
}
```

| Option        | What                                                                                 |
| ------------- | ------------------------------------------------------------------------------------ |
| `id`          | the name the assistant searches by (`app-logs`), unique in the environment           |
| `type`        | `file-logs`                                                                          |
| `path`        | the file, absolute or relative to the workspace                                      |
| `description` | what the file covers: the assistant reads it to choose where to look, so be specific |

`npm run ops -- doctor` lists `logs ... loaded (built-in)`; check the source with
`npm run ops -- sources --env prod`.

## What it can do

The core tool `searchSource` searches a source by text, within a time window, oldest first:

| Parameter    | What                                                   |
| ------------ | ------------------------------------------------------ |
| `source`     | the `id`, e.g. `app-logs`                              |
| `query`      | a word or identifier, e.g. `order=4512` (case ignored) |
| `from`, `to` | an ISO 8601 window                                     |
| `limit`      | most lines to return                                   |

Each matching line becomes evidence with its time. A line with no time is kept only when no window is given.

## Ask it

- "Search the prod logs for order 4512."
- "What did the worker log between 09:30 and 10:05?"

## Safety

The file is opened for reading only; there is no write path in the connector. Files can hold personal data, which then goes to your AI provider: choose the files you list.

## Try it without an account

The demo workspace has `logs/prod.log` and `logs/staging.log`: open the demo and ask about order 4512.

## If it does not work

| `doctor` or an error says              | It means                                          | Do                                                              |
| -------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------- |
| `source app-logs: ...` left out        | the file cannot be read, or the options are wrong | check the path and that the user running the client can read it |
| no result for a term you know is there | outside the time window, or a line without a time | widen `from`/`to`                                               |

## Limits

Plain text only; lines must start with an ISO 8601 time to be placed in time. For logs held in a service (Datadog, Loki, Elasticsearch), use the matching addon.
