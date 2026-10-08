# {{app}} workspace

This folder tells help-me-ops what to investigate and how. It is read by the
assistant of your AI client (Claude Code, Codex, Copilot) through help-me-ops;
keep it in your own repository and review it like code.

```
ops.config.json   the apps and environments, their sources of evidence, and the settings of each addon
playbooks/        how your team investigates each kind of problem (Markdown)
knowledge/        runbooks, past incidents, notes: searched by words (Markdown)
addons/           one folder per system the assistant can read (a database, an API, Datadog ...)
```

## Next steps

1. **Point help-me-ops at this folder**, once, in the `.env` of the help-me-ops clone: `OPS_WORKSPACE=<the path of this folder>`.
2. **Add the evidence you have.** The simplest is a log file: add it under `sources` of an environment in `ops.config.json`:

   ```json
   { "id": "app-logs", "type": "file-logs", "path": "/var/log/{{app}}/app.log", "description": "Application logs" }
   ```

3. **Add what only a system can say**: switch on a ready-made addon (`rest`, `git`, `datadog`, `github`) or start your own with `npm run ops -- init addon <name> --template file|api|sql`.
4. **Write a playbook** for the problem you investigate most often: copy `playbooks/first-incident.md`. Put runbooks and past incidents in `knowledge/`.
5. **Check**: `npm run ops -- doctor`, then ask your assistant: "what is wrong with {{app}} in production?"

The guide: <https://bhoudebert.github.io/help-me-ops/guide/getting-started>
