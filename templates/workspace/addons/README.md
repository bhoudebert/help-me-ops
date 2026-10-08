# Addons

One folder per system the assistant can read. Drop a folder in here, restart,
and it is loaded; a folder starting with `_` is off.

- Start one: `npm run ops -- init addon <name> --template file|api|sql` (from the help-me-ops clone).
- Check it before relying on it: `npm run ops -- addon check <this workspace>/addons/<name>` (ok / warn / FAIL, each with its fix).
- Or switch on a ready-made one (`rest`, `git`, `datadog`, `github`): it ships with help-me-ops, you only add a block for it in `ops.config.json`. Catalog: <https://bhoudebert.github.io/help-me-ops/guide/ready-made/>
- How an addon is written (two small files, no AI knowledge): <https://bhoudebert.github.io/help-me-ops/guide/addons>

A package an addon needs (a database driver) is installed in the workspace:
`npm install pg` here, not in the help-me-ops clone.
