# 0010. Mask what the tools return, at the one place every answer passes

- Status: accepted
- Date: 2026-10-08

## Context

What a tool returns goes to the AI provider of the client (ADR 0007: the client
hosts the model). Evidence can hold personal data, and a team may not be allowed
to send it. Asking authors of addons to leave it out (the guide does) is the
strongest measure but depends on every author. The project needs a safeguard it
controls, and it must stay honest: a pattern cannot recognise a name in a
sentence, so no mask is a promise of anonymity.

## Decision

- **One place.** Every tool answer passes the wrapper of `createToolDefinitions`
  (it already fills the ledger of the checked conclusion). The mask runs there, so
  it covers the core tools, every addon, the knowledge search and every client,
  and no addon author has to do anything.
- **Configured in `ops.config.json`** (`privacy.mask`): `fields` (keys whose values
  are hidden, at any depth, case ignored, `*` wildcards, a dotted path for a
  nested one) and `patterns` (named detectors: `email`, `ip`, `iban`, `card`,
  `phone`, `token`; or a regex of the team's), and a `replacement` (default `***`).
- **Stars first.** A hidden value becomes the replacement, which does not keep its
  length. A value hidden under a key is also hidden wherever else the same record
  repeats it (the one-line summary, a copy in the data), because addons build
  their summaries from their fields. Stable placeholders (`user-3f2a`), which let
  the assistant follow one customer across sources, are a later option: they need
  translating back in the tool inputs, and are more to get wrong.
- **Before the ledger.** The checked conclusion is built on what the assistant saw,
  so the ledger records the masked answer: a quote must be the masked line, and
  the report never holds what was hidden.
- **Fail closed.** If masking throws, the tool fails rather than answering
  unmasked. A bad configuration (an unknown pattern, an invalid regex) is refused
  when the workspace loads.
- **The assistant is told.** The MCP instructions say masking is on and that a
  value shown as the replacement was hidden on purpose and is not to be
  recovered; the answer says how many values were hidden (`masked`); `doctor`
  prints the rule, or that there is none.
- **Playbooks are not masked** (written by the team, returned as text); knowledge
  passages and every evidence are.

## Consequences

A safeguard that costs one block of configuration and protects every addon,
present and future. It is limited, and the documentation says it: structured
fields are reliable, free text is best effort; a masked identifier cannot be used
to search further (do not hide the ids an investigation needs); detectors favour
a miss over hiding every number. The `addon check` warning about personal-looking
data uses the same detectors. Declaring which sources hold personal data and a
strict mode that refuses the others stay on the roadmap.

## Alternatives considered

Masking inside each addon: depends on every author. Masking by the AI client or
the provider: out of our hands. Reversible placeholders from the start: more
machinery before the simple safeguard has proved itself. Doing nothing but the
warning: the guide is the first line, not the last.
