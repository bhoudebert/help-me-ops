# 0005. Node 24 without a build, TypeScript 7, ESLint and Prettier

- Status: accepted
- Date: 2026-10-07

## Context

A small tool that teams extend with their own connectors should be easy to run
and to read.

## Decision

- Node 24 runs TypeScript directly (type stripping): no build step; erasable
  syntax only (`erasableSyntaxOnly`).
- TypeScript 7 (`@typescript/native`) checks types; `typescript` is aliased to
  the TypeScript 6 API package that typescript-eslint and editors import.
- ESLint with typescript-eslint, Prettier for formatting, both pure
  JavaScript. A pre-commit hook formats staged files, and a pre-push hook runs
  `npm run quality` (added 2026-10-08, after a failure only CI saw).
- Tests with the Node test runner, coverage thresholds in `npm run quality`.

## Consequences

Clone, install, run. Connector modules are plain `.ts` files loaded as they
are.

## Alternatives considered

A bundler or `tsc` build: an extra step for no gain at this size. Biome:
faster, but a native binary per platform.
