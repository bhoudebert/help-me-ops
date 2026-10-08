# Workspace Specification

## Purpose

Let a team describe its own infrastructure, several apps in several
environments, in one folder it owns.

## Requirements

### Requirement: One folder per team

A workspace SHALL be one directory holding `ops.config.json` and the
playbooks folder it names. The CLI and the MCP server SHALL accept
`--workspace <dir>`, then `OPS_WORKSPACE`, and default to the current
directory. A directory without `ops.config.json` SHALL be refused, saying to
copy `examples/my-workspace`. A configuration in the earlier flat format (a
top-level `sources` list) SHALL be refused, saying where sources go now.

#### Scenario: Run from another repository

- **WHEN** the server is started with `--workspace ../shop/ops`
- **THEN** sources and playbooks are read from that folder only, with paths relative to it

### Requirement: Apps and environments

The configuration SHALL declare at least one app, each with at least one
environment, each with its sources. Tools that read evidence SHALL take `app`
and `env`; an app or environment that is the only choice MAY be left out,
otherwise the tool SHALL refuse and name the choices. Source ids SHALL be unique
within an environment.

#### Scenario: Same question, two environments

- **WHEN** order 4512 is searched in `shop` `prod` and in `shop` `staging`
- **THEN** each search reads only that environment's sources, and its result names the app and environment

### Requirement: Resolve the scope

A `scope` tool SHALL list the apps and environments, and propose the likely
ones for a question with the reason (the words of the question they share, or
being the only choice), without reading any evidence. When it cannot tell, it
SHALL say what to ask the person.

Every entry point SHALL make the loaded workspace visible: the `scope` answer
names its folder, the MCP server's instructions state it, `doctor` prints it,
and the CLI and the server say it on stderr at start-up. A person or a model
SHALL never have to guess which workspace is being read.

#### Scenario: Which workspace

- **WHEN** a client calls `scope`, or the server starts
- **THEN** the workspace folder is in the answer and in the start-up line

#### Scenario: Vague question

- **WHEN** the question names no app and there are several
- **THEN** no app is proposed and the answer asks which app
