# Security

help-me-ops reads systems that hold customer data. Treat it like any tool with
production access.

## Read-only, by design

Every connector and tool only reads (ADR 0002). Connect sources with
**read-only credentials**: a database user without write grants, a log or
metrics token scoped to reading. The model never changes the system; it
proposes changes for a person to make.

## Secrets and data

- `.env` holds credentials and is git-ignored, as is a local `ops/` workspace. Never commit credentials; a team's own workspace goes in its own repository, with credentials named by environment variable, not written in it.
- Evidence (log lines, rows) goes to the model you use (Claude, Codex, Copilot).
  Mask or leave out personal data in your connectors when your policy requires it.
- `cases/` (investigation records, when they exist) is git-ignored.

## Reporting

Open a private security advisory on the repository, or contact the maintainer
directly. Please do not open a public issue for a vulnerability.
