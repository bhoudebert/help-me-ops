# API mode: delta

## ADDED Requirements

### Requirement: Optional, and separate from the MCP server

A model SHALL be called only by `ops chat`, `ops ask` and `ops eval`, and only when the person
has configured a model. The MCP server and every other command SHALL NOT import or
call the model code, and a workspace with no `model` configured SHALL make no model
call.

#### Scenario: No model configured

- **WHEN** `ops ask` runs in a workspace with no `model` block, flag or variable
- **THEN** it fails saying how to configure one, and no network call is made

### Requirement: The same toolbox and the same guards

The loop SHALL call the tools of `createToolDefinitions` and no others, so that
read-only hints, the mask, stable placeholders, strict mode, the ledger and the
checked conclusion apply exactly as with an MCP client. It SHALL use the method
text the MCP server gives.

#### Scenario: A masked field

- **WHEN** the model calls a tool whose answer holds a field the mask lists
- **THEN** the model receives it hidden, as an MCP client would

### Requirement: Bounded runs

A run SHALL stop at the first of: the checked conclusion accepted, the step cap,
the token budget, or a timeout. An identical repeated tool call SHALL NOT be run
again. A malformed tool call SHALL be answered with the error and counted as a
step. On a limit, the run SHALL say which, print what it has, and exit non-zero.

#### Scenario: A model that loops

- **WHEN** the model asks for the same call at every step
- **THEN** the run stops at the cap with a message naming it, and exits non-zero

### Requirement: A conversation

`ops chat` SHALL keep the conversation and the session ledger across the person's
turns, so a conclusion can cite what an earlier turn found, and SHALL keep them in
memory only. When the conversation outgrows the model's context it SHALL drop the
oldest tool results first and SAY so. `/reset` SHALL start a new session and `/exit`
SHALL leave.

#### Scenario: A follow-up

- **WHEN** the person asks a second question after a conclusion
- **THEN** the model sees the first exchange, and the conclusion check accepts a quote from either turn

### Requirement: Where the model may be

`privacy.modelHosts` SHALL list the hosts the model may be reached at, where `local`
stands for this machine and private-network addresses written as IP literals, and
any other entry is a host name compared as written without resolving it. When the
list is present, `chat`, `ask` and `eval` SHALL refuse a model outside it before
any call, naming the list. When absent, any host SHALL be accepted.

#### Scenario: A public endpoint on a restricted workspace

- **WHEN** `modelHosts` is `["local"]` and the model URL is `https://api.example.net/v1`
- **THEN** the command refuses to start and no request is made

### Requirement: One question, one checked answer

`ops ask "<problem>"` SHALL print the steps on stderr and the checked report on
stdout, or the result as JSON with `--json`, and SHALL exit 0 only when the
conclusion check accepted the conclusion.

#### Scenario: A refused conclusion

- **WHEN** the model's conclusion cites a quote no tool returned
- **THEN** the check's refusal is given back to the model, which may fix it within the limits; if it does not, the run fails with the refusal

### Requirement: Tests never call a model

Tests of this capability SHALL use a scripted server that speaks the wire format,
and SHALL NOT reach a real model or spend money.

### Requirement: Where the model is, said

`doctor` SHALL print the configured model endpoint and whether it is this machine,
a private network address or an outside host.

### Requirement: Measuring a model

`ops eval` SHALL run the scenarios of the workspace against the configured model a
given number of times and report, per scenario, how many runs reached a conclusion,
how many the check accepted, how many matched the expected cause, and the median
steps, tokens and time. It SHALL make no claim beyond what it ran.
