# elasticsearch

Search the logs or documents of the indices you list in Elasticsearch or OpenSearch.

- **Status:** **experimental** (see [what that means](https://bhoudebert.github.io/help-me-ops/guide/legal#experimental-integrations))
- **You need:** a cluster URL, the indices it may search, and a key limited to read on them
- **Tools:** `elasticsearch.search`
- **Variables:** `ELASTICSEARCH_URL`, `ELASTICSEARCH_INDICES`, `ELASTICSEARCH_AUTHORIZATION`, `ELASTICSEARCH_TIME_FIELD`, `ELASTICSEARCH_MESSAGE_FIELD`
- **Read-only:** yes. Idle until an environment sets it up; it serves nothing and prints nothing until then.

Everything about it (set-up steps, settings, what it can do, safety, the data it can return, a demo
without an account, troubleshooting) is in the guide:
<https://bhoudebert.github.io/help-me-ops/guide/ready-made/elasticsearch>, source in
[`docs/guide/ready-made/elasticsearch.md`](../../docs/guide/ready-made/elasticsearch.md).
