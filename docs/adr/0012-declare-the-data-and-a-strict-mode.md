# 0012. Declare which sources hold personal data, and an optional strict mode

- Status: accepted
- Date: 2026-10-08

## Context

The mask (ADR 0010, 0011) hides what a team lists, and the guide tells people not
to connect a source whose data they may not send to their AI provider. Nothing
records that decision. A reviewer cannot see which sources someone judged free of
personal data, and nothing stops the assistant from reading a source nobody
thought about. The benefit of a strict mode is modest, since a declaration is a
person's word and not a check, so it must cost nothing when it is not wanted.

## Decision

- **Two values, said by a person**: `none` (holds no personal data) or `possible`.
  Anything not declared is `unknown`. The project never decides that a source is
  free of personal data; it only records and enforces what someone declared.
- **Where**: `privacy.data` in `ops.config.json`, keyed by **source id**, **addon
  name**, or `knowledge` (the written knowledge). An addon may declare its own
  default with `personalData` in its manifest (`none` or `possible`); the
  workspace wins. Shipped addons declare `possible`, so nothing external is
  assumed free of personal data until a workspace says so.
- **A declaration for something that does not exist is an error** when the
  workspace opens, like a reference to an unknown detector.
- **`privacy.strict: true` serves only what is declared `none`.** Off by default.
  `listSources` leaves the others out and names them under `withheld`; a call to
  one is refused with the line to add to the configuration. An addon's tools are
  all-or-nothing, by addon name. Tools that read no system (scope, playbooks,
  checkConclusion) are not concerned.
- **Visible**: `doctor` prints a `Data:` line (what is declared, what is not, and
  whether strict mode is on), `listSources` shows a declared value, and
  `addon check` notes an addon that says nothing.
- `privacy.mask` becomes optional, so strict mode can be used without a mask.

## Consequences

- A team can write down, review and enforce "these sources are free of personal
  data"; a source added later is unknown, and strict mode withholds it.
- It is a statement, not a detector: declaring `none` for a source that holds
  emails is the person's mistake, and the mask is still the safeguard.
- Granularity is the source or the addon, not a field or a tool.

## Alternatives considered

Detecting personal data to fill the declaration: unreliable, and it would turn a
person's decision into a guess. Declaring per environment: more precise, but a
source id is already per environment in practice, and the extra key was not worth
the configuration. A strict mode on by default: it would withhold every shipped
addon until configured, which is the wrong first experience.
