# Knowledge

What the team has written down, in Markdown, one topic per file: runbooks, past
incidents, notes on how a service behaves. The assistant searches it with
`searchKnowledge` and quotes what it finds next to logs and rows.

- Put each file under a heading structure (`#`, `##`): a passage is a section.
- A file in `knowledge/<app>/` is about that app; `app: shop` in the front matter does the same. A file about nothing in particular applies to every app.
- Write it for the person on call at 3 a.m.: what it is, what to check, what to do, who to ask.
