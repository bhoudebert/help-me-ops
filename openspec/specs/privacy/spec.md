# Privacy Specification

## Purpose

Let a team hide fields and patterns in what the tools return, before the
assistant and its AI provider see them, as a safeguard and not a guarantee.

## Requirements

### Requirement: Hide what the workspace lists

The configuration MAY hold `privacy.mask` with `fields` (keys), `patterns` and a
`replacement` (default `***`). The server SHALL hide, in the evidence of every
tool answer (the core tools, every addon, the knowledge search), the value of any
key matching a field, at any depth and in arrays, case ignored, with `*` as a
wildcard and a dotted path for a nested key; and SHALL hide, in the summary and in
every string of the data, what a pattern matches. The named patterns SHALL be
`email`, `ip` (IPv4), `iban`, `card` (only numbers that pass the Luhn check),
`phone` (international, starting with `+`) and `token` (bearer tokens, cloud and
GitHub keys, JWTs); a pattern MAY also be a regular expression of the team's. The
replacement SHALL NOT keep the length of what it hides.

#### Scenario: A field

- **WHEN** `fields` lists `user` and `order.getOrder` returns a record whose `user` is `u-881`
- **THEN** the data holds `***` for `user`, the summary no longer contains `u-881`, and the answer says how many values were hidden

#### Scenario: A pattern in free text

- **WHEN** `patterns` lists `email` and a log line holds `jane@example.com`
- **THEN** the line reaches the assistant with `***` in its place

### Requirement: A hidden value is hidden everywhere the record says it

A value hidden under a key SHALL also be hidden in the summary and in the other
strings of the same record, so an addon that builds its summary from its fields
does not leak what the field hides. A value too short to be told apart from other
text (under 3 characters, or a number under 4 digits) SHALL not be swept through
the text.

### Requirement: Before anything leaves, and before the ledger

The mask SHALL run on the answer of each tool before it is returned and before it
is recorded for the checked conclusion, so a quote must be the masked line and
the report SHALL never hold what was hidden. Answers that are not evidence (a
playbook, the scope) SHALL be returned as they are. If masking fails, the tool
SHALL fail rather than answer unmasked, and an invalid configuration (an unknown
pattern, a regular expression that does not compile) SHALL be refused when the
workspace loads.

### Requirement: The assistant and the person are told

The MCP instructions SHALL say, when a mask is configured, what is masked, and that
a value shown as the replacement was hidden on purpose and SHALL NOT be recovered,
guessed or worked around. `doctor` SHALL print the rule, or that no masking is
configured. The documentation SHALL say that the mask is a safeguard, that free
text is best effort, and that not exposing personal data in the first place is the
measure to rely on.

#### Scenario: Doctor

- **WHEN** `doctor` runs on a workspace with `fields: ["email"]` and `patterns: ["card"]`
- **THEN** it prints `Privacy: masking fields email; patterns card as ***`
