# 0006. Conventional Commits and automated releases

- Status: accepted
- Date: 2026-10-07

## Context

A changelog written by hand drifts; versions bumped by hand are forgotten.

## Decision

Commits and pull request titles follow Conventional Commits, checked by a
commit-msg hook and in CI. release-please reads `main` and maintains a release
pull request with the version and the changelog; merging it tags the release.

## Consequences

The history reads as a changelog; every merged `feat` or `fix` ends up in a
release without manual steps.

## Alternatives considered

Manual releases; semantic-release (publishes on every merge, less review).
