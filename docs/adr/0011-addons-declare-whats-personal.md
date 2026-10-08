# 0011. Addons declare what is personal, as JSON that can only hide

- Status: accepted
- Date: 2026-10-08

## Context

ADR 0010 lets a workspace list fields and patterns to hide. The people who know
what is personal in a domain are the ones who write its addon: a company id with
a check digit, the keys of an account record. Asking every workspace to retype
that is error-prone, and a regex alone cannot tell a real id from any number of
the same length. A company also keeps shared addons for all its workspaces
(`OPS_ADDONS`), which is the natural place to write it once.

## Decision

- An addon declares `privacy` in its `addon.json` (or its `addon.ts`):
  `personalFields` (keys of its records) and `detectors` (formats only it knows).
- **Fields are scoped.** The workspace switches them on with
  `privacy.mask.fromAddons` (`true`, or the addons to take), and they apply to the
  answers of that addon's own tools only, so a key called `name` in one addon does
  not hide another's.
- **Detectors are named `<addon>.<name>`** in `privacy.mask.patterns`, like the
  built-in ones. The namespace avoids clashes between addons and with the
  built-ins. Applied everywhere, since a format is a format whichever tool shows it.
- **JSON, not code.** A detector is a regex, an optional case flag, and an
  optional **named checksum** (`luhn`, `iban`) so only real ids are hidden. It
  cannot read, log or send anything: it can only hide. The regex is limited to 200
  characters and refused if a group that repeats holds a repeat (`(a+)+`), which
  can make a search run away on every line of evidence.
- **A detector tests itself.** `examples.matches` and `examples.ignores` in the
  manifest are checked by `addon check`: a regex that hides too little or too much
  fails the check, and a detector with no examples is warned about.
- **References are checked.** A pattern or `fromAddons` that names what is not
  loaded is an error when the workspace opens, never a mask that silently hides
  nothing.

## Consequences

A company writes its identifiers once, in a shared addon, and every workspace
that names them gets them, with a test. Detectors stay data. Only two checksums
exist; a format with another needs one more name added to the core, which is a
small change, not a plug-in point for code. As with the rest of the mask, this is
a safeguard, and a name in free text is still not found.

## Alternatives considered

A detector as a function in `tools.ts`: it could do anything in the process, on
every answer. Applying an addon's fields to every tool: over-masks, and one
addon's `name` is not another's. Global names without a namespace: clashes.
