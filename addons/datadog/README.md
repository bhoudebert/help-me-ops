# datadog

Read Datadog logs, metrics and monitors.

- **Status:** **experimental** (see [what that means](https://bhoudebert.github.io/help-me-ops/guide/legal#experimental-integrations))
- **You need:** an API key, an application key with read scopes (`logs_read_data`, `timeseries_query`, `monitors_read`), your Datadog site
- **Tools:** `datadog.searchLogs`, `datadog.queryMetric`, `datadog.monitors`
- **Variables:** `DD_API_KEY`, `DD_APP_KEY`, `DD_SITE`, `DD_BASE_URL`
- **Read-only:** yes. Idle until an environment sets it up; it serves nothing and prints nothing until then.

Everything about it (set-up steps, settings, what it can do, safety, a demo
without an account, troubleshooting) is in the guide:
<https://bhoudebert.github.io/help-me-ops/guide/ready-made/datadog>, source in
[`docs/guide/ready-made/datadog.md`](../../docs/guide/ready-made/datadog.md).
