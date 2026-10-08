# Knowledge

What your team has written down, in Markdown, one topic per file: runbooks, past
incidents, notes on how a service behaves. The assistant searches it by words
(`searchKnowledge`) and quotes what it finds next to logs and rows.

- Use headings (`#`, `##`): a passage is one section, and the heading says what it is about.
- A file in `knowledge/<app>/` is about that app (`{{app}}`); so is `app: {{app}}` in its front matter. A file about nothing in particular applies to every app.
- Write it for the person on call at 3 a.m.: what it is, what to check, what to do, who to ask.

Guide: <https://bhoudebert.github.io/help-me-ops/guide/knowledge>
