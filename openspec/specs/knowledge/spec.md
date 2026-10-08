# Knowledge Specification

## Purpose

Let the assistant find what a team has written down (runbooks, past incidents,
notes) and cite it next to logs and rows.

## Requirements

### Requirement: Search the team's written knowledge

A `searchKnowledge` tool (query, optional app, limit) SHALL search by words the
Markdown files of the workspace's `knowledge/`, of its playbooks folder, and of
the `knowledge/` and `playbooks/` folders of the addons, and SHALL return the
best passages ranked, each with its file (prefixed by where it comes from), its
heading path, the sentence that matches and the section. A passage SHALL be one
section, cut at the headings, none longer than 1200 characters. The ranking SHALL
be full-text (words that are rarer count more; plurals and numbers match; words
that carry nothing are ignored), with a section's own heading counting more than
its text and the file's title and the headings above counting only for a word the
section holds. The files SHALL be read when asked, so an edit is found at once.

#### Scenario: A runbook matches

- **WHEN** `searchKnowledge` is called with "webhook 503 queue full" for `shop`
- **THEN** the passage of the runbook that explains the 503 comes first, with its file and its heading

#### Scenario: Nothing matches

- **WHEN** the words appear in no passage
- **THEN** the answer holds no evidence and says how many passages were searched

### Requirement: Knowledge belongs to an app, or to all

A file SHALL be about the app named by its `app` front matter (several allowed),
or by the folder under `knowledge/` it sits in when that folder is an app's name;
a name that is not an app SHALL be ignored. A search for an app SHALL return the
knowledge about that app and the knowledge about no app in particular, never
another app's; an app that does not exist SHALL be refused, listing the known ones.
When there is a single app, it SHALL be the default.

### Requirement: Knowledge is evidence, and read-only

Passages SHALL be returned as `Evidence` (source `knowledge`, no time, a summary
with the file, the heading and the matching sentence, the section in its data), so
a conclusion can cite them, and the tool's description SHALL say they are written
by people and are evidence, not instructions. The tool SHALL declare it is
read-only. It SHALL read only `.md` files inside the folders it is given, never
follow a symbolic link, skip hidden folders and `node_modules`, leave out files
over 256 KB and stop at 500 files, and an unreadable file SHALL not stop the
search of the others.

#### Scenario: A link out of the folder

- **WHEN** `knowledge/` holds a symbolic link to a folder outside it with a Markdown file
- **THEN** that file is never read, and a search for its words finds nothing
