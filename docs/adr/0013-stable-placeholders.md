# 0013. Stable placeholders, as an option next to the stars

- Status: accepted
- Date: 2026-10-08

## Context

The mask (ADR 0010) replaces a hidden value by `***`. That keeps the value from the
assistant, but also the link: a user id hidden in the order and in the logs reads
`***` in both, so the assistant cannot follow one customer from one source to the
next, which is most of an investigation. Hiding the identifier or being able to
follow it looked like a choice between privacy and usefulness.

## Decision

- `privacy.mask.placeholders: true` (off by default) replaces a hidden value by a
  **placeholder**: the name of the key or pattern and a few hex digits, such as
  `user-3f2a`. The same value is the same placeholder in every tool and every
  source of the session; two values differ (the hex grows on a collision).
- The digits come from a **keyed hash** (HMAC-SHA-256) with a random key made when
  the server starts. A placeholder cannot be computed from a guess of the value,
  and the same value has another placeholder in the next session.
- **The placeholder given back stands for the value.** In every tool input except
  the conclusion check, a placeholder this session handed out is replaced by its
  value before the tool runs, so `searchSource` for `user-3f2a` searches for the
  real user id. An error that would repeat an input is rewritten with the
  placeholders, so a refusal does not give the value away.
- **The checked conclusion keeps the placeholders**: its quotes must match what the
  assistant saw, and the report never holds a hidden value.
- Values a field hides that are not a string or a number (an object, a list) stay
  `***`: one placeholder cannot stand for several values.
- The assistant is told what a placeholder is, and not to guess what it hides.

## Consequences

- The investigation keeps working through a hidden identifier; the provider sees
  that two lines concern the same person, though not who.
- **That link is itself information.** A pseudonym is still personal data under
  most rules. The stars hide more; placeholders hide the value and keep the
  linkage, and the person chooses.
- The report the assistant writes names `user-3f2a`, and the mapping lives only in
  the server's memory for the session: the person cannot look it up afterwards.
  Saving it with a case file is a later decision.

## Alternatives considered

An unkeyed hash of the value: anyone can test a guess against it (a short id or an
email is easy to enumerate). A counter (`user-1`, `user-2`): stable inside a
session, and nothing to guess, but it would not tell two sessions apart and gives
away how many values there are; the keyed hash costs nothing more. Restoring the
value in the conclusion: it would put the hidden value back in front of the model's
answer and the chat history.
