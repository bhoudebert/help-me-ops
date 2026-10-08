# prometheus

Read metrics (range and instant PromQL queries) and the alerts that are firing from Prometheus, Mimir, Thanos or VictoriaMetrics.

- **Status:** **experimental** (see [what that means](https://bhoudebert.github.io/help-me-ops/guide/legal#experimental-integrations))
- **You need:** a Prometheus URL, an authorization header and a tenant if it needs them
- **Tools:** `prometheus.queryRange`, `prometheus.query`, `prometheus.alerts`
- **Variables:** `PROMETHEUS_URL`, `PROMETHEUS_AUTHORIZATION`, `PROMETHEUS_ORG_ID`
- **Read-only:** yes. Idle until an environment sets it up; it serves nothing and prints nothing until then.

Everything about it (set-up steps, settings, what it can do, safety, the data it can return, a demo
without an account, troubleshooting) is in the guide:
<https://bhoudebert.github.io/help-me-ops/guide/ready-made/prometheus>, source in
[`docs/guide/ready-made/prometheus.md`](../../docs/guide/ready-made/prometheus.md).
