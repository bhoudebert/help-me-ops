# Contributing

Thanks for helping. The way of working is the same for people and coding
agents: `AGENTS.md` is the short form, `docs/EVOLVING.md` the full path from
an idea to a release.

## Set up

```bash
nvm use            # Node 24, from .nvmrc
npm install        # also installs the git hooks (commit-msg, pre-commit)
cp -r examples/my-workspace ops    # git-ignored; point to it with --workspace ops
npm run ops -- investigate "order 4512 is stuck"
npm run quality    # typecheck, lint, format check, tests with coverage
```

## Branches and pull requests

Never commit to `main`. Branch from it (`feat/...`, `fix/...`, `docs/...`,
`build/...`, `ci/...`, `chore/...`), open a pull request with the template,
and let the maintainer review and merge. Pull requests are squash-merged: the
PR title becomes the commit on `main`, so it follows the commit rules below.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), checked by a
commit-msg hook and in CI:

```
<type>(<scope>): <subject>
```

- Types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`,
  `chore`, `style`, `revert`. `feat` and `fix` drive the version and the
  changelog.
- Scope: kebab-case, optional (`connectors`, `playbooks`, `mcp`, `cli`, `spec`).
- Imperative, present tense; no trailing period; at most 100 characters.
- Body when the why is not obvious: what changed, why, what was verified.
- One concern per commit.

### Examples

```
feat(connectors): read JSON log lines
fix(mcp): keep logs off stdout
docs(spec): playbooks matched by the words of the report
test(connectors): time windows on lines without a timestamp
build(deps): bump the MCP SDK
ci: build the guide in the quality job
```

No attribution trailers or generated-by footers in commits or pull requests.

## Releases

release-please opens and maintains a release pull request on `main` with the
changelog and version bump. Merging it tags the release. Nothing is published
to npm.

## Code conventions

- Connectors implement `Connector` and only read. Tools are defined once in
  `src/tools/index.ts` with their four MCP hints.
- Lint: ESLint with typescript-eslint. Format: Prettier. Both pure JavaScript.
- TypeScript, two packages on purpose: `@typescript/native` is TypeScript 7,
  the native compiler behind `npm run typecheck`; `typescript` is an alias of
  `@typescript/typescript6`, the JavaScript API typescript-eslint and editors
  import.
