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
replacement SHALL NOT keep the length of what it hides. Case, underscores, hyphens and
spaces SHALL NOT tell two spellings of a key apart (`firstName`, `first_name`,
`FIRST-NAME`), in a field and in each part of a dotted path; a key that merely
contains the name SHALL need a wildcard. The fields and patterns of the workspace
SHALL apply to the answers of every tool, whether or not an addon declared them.

#### Scenario: A field

- **WHEN** `fields` lists `user` and `order.getOrder` returns a record whose `user` is `u-881`
- **THEN** the data holds `***` for `user`, the summary no longer contains `u-881`, and the answer says how many values were hidden

#### Scenario: Spellings, and an addon that declared nothing

- **WHEN** `fields` lists `firstName` and an addon that declares no personal field returns `first_name`, `FIRST-NAME` and `FirstName`
- **THEN** all three values are hidden, and a key `given_first_name` is hidden only if `*firstname*` is listed

#### Scenario: A pattern in free text

- **WHEN** `patterns` lists `email` and a log line holds `jane@example.com`
- **THEN** the line reaches the assistant with `***` in its place

### Requirement: Addons declare what is personal

An addon MAY declare `privacy` in its manifest (or its definition): `personalFields`
(keys of its records) and `detectors` (name, regex of at most 200 characters with
no repeated group holding a repeat, an optional case flag, an optional checksum
among `luhn` and `iban`, optional `examples` of what to hide and what to leave
alone). The workspace SHALL switch the fields on with `privacy.mask.fromAddons`
(`true`, or a list of addons), and they SHALL apply to the answers of that addon's
own tools only. A detector SHALL be named in `privacy.mask.patterns` as
`<addon>.<name>`, apply to every answer, and hide only the matches that pass its
checksum. A pattern or a `fromAddons` entry that names what is not loaded SHALL be
refused when the workspace opens. `doctor` SHALL show the fields declared. A
detector SHALL be data and SHALL NOT be able to do anything but hide.

#### Scenario: A checksum

- **WHEN** a detector `ACME-\d{6}` with `luhn` is named in `patterns` and a line holds `ACME-123455` and `ACME-123456`
- **THEN** the first is hidden and the second, which fails the check, is left alone

#### Scenario: One addon's field

- **WHEN** `fromAddons` takes `order`, which declares `user`, and `order.getOrder` and `metrics.queryMetric` both return a `user` key
- **THEN** only the answer of `order.getOrder` has it hidden

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

### Requirement: Sources declare whether they hold personal data

A workspace SHALL be able to declare, in `privacy.data`, by source id, addon name
or `knowledge`, that it holds no personal data (`none`) or may (`possible`). An
addon SHALL be able to declare a default with `personalData`; the workspace's
declaration SHALL win. Anything undeclared is `unknown`. A declaration for a key
that is no source, addon or `knowledge` of the workspace SHALL be refused when the
workspace opens. `doctor` SHALL print what is declared and what is not, and
`listSources` SHALL show a declared value.

#### Scenario: Doctor

- **WHEN** `doctor` runs on a workspace where `health` is `none` and `app-logs` is `possible`
- **THEN** it prints a `Data:` line naming `health` as free of personal data and `app-logs` as possibly holding some

#### Scenario: A declaration for nothing

- **WHEN** `privacy.data` names `orders` and the workspace has no source or addon of that name
- **THEN** the workspace is refused with the names it knows

### Requirement: An optional strict mode

`privacy.strict` SHALL default to false, and then everything is served. When true,
the tools SHALL serve only the sources, addons and knowledge declared `none`:
`listSources` SHALL leave the others out and name them as `withheld`, and a call to
one SHALL be refused with the declaration to add and SHALL NOT be recorded as
evidence. An addon is served or withheld as a whole. Strict mode SHALL work
without a `mask`.

#### Scenario: A source declared possible

- **WHEN** strict mode is on and `order` is declared `possible`
- **THEN** `order.getOrder` is refused with `Strict mode: "order" is not declared free of personal data`

### Requirement: Stable placeholders

When `privacy.mask.placeholders` is true (default false), a hidden string or number
SHALL be replaced by a placeholder made of the name of its key or pattern and hex
digits from a keyed hash whose key is made at start-up, so that the same value is
the same placeholder in every tool answer of the session, two values differ, and a
placeholder cannot be computed from a guess. Before a tool other than the
conclusion check runs, a placeholder handed out in this session found in its input
SHALL be replaced by its value. An error that would repeat a known value SHALL show
its placeholder. The checked conclusion SHALL keep the placeholders. The assistant
SHALL be told what a placeholder is.

#### Scenario: Following a user

- **WHEN** `order.getOrder` shows the user as `user-3f2a` and the assistant searches the logs for `user-3f2a`
- **THEN** the search is made for the real user id and the lines come back with `user-3f2a`, never the id
