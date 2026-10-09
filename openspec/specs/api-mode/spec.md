# API mode

A chat model reached over HTTP drives the same toolbox (ADR 0014).

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

### Requirement: Developing it costs nothing

The repository's tests and workflows SHALL NOT require a paid API or a key. The
gating tests use the scripted server. Runs against a real model SHALL be opt-in
(a script on the person's machine) and SHALL NOT fail a
build on a model's answer.

### Requirement: Where the model is, said

`doctor` SHALL print the configured model endpoint and whether it is this machine,
a private network address or an outside host.

### Requirement: Measuring a model

`ops eval` SHALL run the scenarios of the workspace (all of them unless some are named) against each combination of the
given models and reasoning settings a given number of times, each run in a new
conversation with a new ledger, and report per setting how many runs the
conclusion check accepted, how many named every required fact of the scenario's
`expect`, the average number of expected facts named, and the median steps, tokens
and time, then list the facts a setting never named and why runs did not conclude.
Facts are keywords found in the answer, case ignored. A failure on the first run
SHALL stop the evaluation as a configuration error; a later failure SHALL be
counted as a result. `privacy.modelHosts` SHALL apply. It SHALL make no claim
beyond what it ran.

#### Scenario: Two settings

- **WHEN** `ops eval --runs 5 --reasoning none,default` runs
- **THEN** it runs each setting five times and prints one line per setting with the counts and medians

### Requirement: A busy or rate-limited server is waited for

A request answered 429, 502, 503 or 504 SHALL be tried again up to `retries` times
(default 2), waiting `Retry-After` seconds (at most 30) when the server gives them,
else `retryDelayMs` doubled each time, and the person SHALL be told. Any other
status SHALL NOT be retried. When the retries are used up, the error SHALL name the
status.

#### Scenario: A rate limit

- **WHEN** the server answers 429 with `Retry-After: 2` and then answers normally
- **THEN** the request is made again after 2 seconds and the run goes on

### Requirement: Authentication and addresses of other providers

The model SHALL be authenticated with `Authorization: Bearer <apiKey>`, or with the
headers of `model.headers`, where a header named `authorization` replaces the
Bearer one. The `apiKey`, the header values and the address SHALL accept `${VAR}`
read from the environment, and an unset variable SHALL be named as an error. A query
string in the address SHALL be kept on the chat endpoint and SHALL NOT be shown in
`doctor`, the chat banner, the eval report or an error.

#### Scenario: Azure-style configuration

- **WHEN** the address has `?api-version=…` and `headers` has `api-key`
- **THEN** the request goes to `…/chat/completions?api-version=…` with the `api-key` header and no `Authorization`

#### Scenario: Several incidents

- **WHEN** `ops eval` runs on a workspace with three scenarios
- **THEN** it prints one report per scenario and then the settings added up over all of them

### Requirement: Measurements are kept as records and the table is made from them

A benchmark run SHALL be stored as a file with its date, the commit of the repository,
the description of the machine given by the person, and every run of every
scenario. The comparison table of the guide SHALL be generated from the stored files,
taking for each model and reasoning setting its latest record whole, and a test SHALL
fail when the page differs from what the files produce. The page SHALL state that it
is a snapshot of one setup and how a person adds their own.

#### Scenario: A new record

- **WHEN** a person runs `npm run bench` and then `npm run bench:table`
- **THEN** a record appears in `bench/results/` and the table of the page shows its setting
