# rest

Read your own HTTP API with `GET`, on the path prefixes you allow.

- **Status:** ready (see [what that means](https://bhoudebert.github.io/help-me-ops/guide/legal#experimental-integrations))
- **You need:** a base URL, the allowed path prefixes, a read-only token if the API needs one; nothing to install
- **Tools:** `rest.get`
- **Variables:** `REST_BASE_URL`, `REST_ALLOW`, `REST_TOKEN`, `REST_TOKEN_HEADER`
- **Read-only:** yes. Idle until an environment sets it up; it serves nothing and prints nothing until then.

Everything about it (set-up steps, settings, what it can do, safety, a demo
without an account, troubleshooting) is in the guide:
<https://bhoudebert.github.io/help-me-ops/guide/ready-made/rest>, source in
[`docs/guide/ready-made/rest.md`](../../docs/guide/ready-made/rest.md).
