# logs

The `file-logs` source type: search plain-text log files, one event per line
starting with an ISO 8601 time, per app and environment.

- **Status:** ready
- **You need:** a log file readable from the machine running help-me-ops
- **Used as:** a `sources` entry with `"type": "file-logs"` and a `path`; there is nothing to switch on

Details: <https://bhoudebert.github.io/help-me-ops/guide/ready-made/logs>, source in
[`docs/guide/ready-made/logs.md`](../../docs/guide/ready-made/logs.md).
