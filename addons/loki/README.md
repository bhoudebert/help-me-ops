# loki

Search logs with LogQL in Grafana Loki or Grafana Cloud Logs, and list the labels.

- **Status:** **experimental** (see [what that means](https://bhoudebert.github.io/help-me-ops/guide/legal#experimental-integrations))
- **You need:** a Loki URL, an authorization header and the tenant if it is multi-tenant
- **Tools:** `loki.searchLogs`, `loki.labels`
- **Variables:** `LOKI_URL`, `LOKI_AUTHORIZATION`, `LOKI_ORG_ID`
- **Read-only:** yes. Idle until an environment sets it up; it serves nothing and prints nothing until then.

Everything about it (set-up steps, settings, what it can do, safety, the data it can return, a demo
without an account, troubleshooting) is in the guide:
<https://bhoudebert.github.io/help-me-ops/guide/ready-made/loki>, source in
[`docs/guide/ready-made/loki.md`](../../docs/guide/ready-made/loki.md).
