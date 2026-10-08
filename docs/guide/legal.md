# Independence, trademarks and no warranty

## Independent project

help-me-ops is an **independent, open-source project**. It is **not affiliated
with, endorsed by, sponsored by or supported by** Anthropic, OpenAI, GitHub,
Microsoft, Datadog, the PostgreSQL Global Development Group, Docker or any other
company or project named in this documentation.

## Trademarks

All product and company names are trademarks or registered trademarks of their
respective owners. For example: Claude and Claude Code are trademarks of
Anthropic, PBC; Codex and ChatGPT of OpenAI; GitHub, GitHub Copilot and Visual
Studio Code of GitHub, Inc. and Microsoft Corporation; Datadog of Datadog, Inc.;
PostgreSQL of the PostgreSQL Community Association of Canada; Docker of Docker,
Inc.

They are named here only to say **what help-me-ops works with** (descriptive,
nominative use). No logo is used, and nothing here suggests an official
relationship or approval. An addon named after a product, such as `datadog`,
means "an addon that talks to that product's public API", not "made by" or
"approved by" its owner.

## Experimental integrations

An integration with a third-party service that has not been run against the real
service is labelled **experimental** (the `datadog` and `github` addons are, today). It is
written from the service's public documentation and tested against recorded
responses and a mock, so it **may not work, or may behave differently, on a real
account**. A label comes off only once it has been verified on one.

## How it talks to those products

Only through their **published interfaces**: the Model Context Protocol for the
AI clients, and each product's documented HTTP API or driver for the systems you
read. You use **your own** accounts, keys and subscriptions, and you are bound
by those products' terms of service and acceptable-use rules. help-me-ops
ships none of their software, data or credentials.

The **demo backend** includes a mock of three Datadog API endpoints. It is an
independent re-implementation of their documented request and response shapes,
written for this project. It is **not Datadog**, contains no Datadog code or
data, and exists only so the demo and the tests run without an account.

## No warranty, and what read-only does and does not mean

help-me-ops is provided **as is**, under the [MIT licence](https://github.com/bhoudebert/help-me-ops/blob/main/LICENSE),
without warranty of any kind.

- **Read-only is a design goal with several layers, not a guarantee.** The
  tools are declared read-only and tested, and the shipped addons only read, but
  an addon is code, and what a database user or a token can do is decided by the
  permissions **you** give it. Use read-only accounts.
- **An AI assistant can be wrong.** Its conclusions are leads backed by the
  evidence it quotes, not facts. Check the evidence before acting on a
  conclusion, above all before changing a production system.
- **Evidence may contain personal or confidential data**, which then goes to the
  AI service your client uses ([personal data](/privacy), and the mask that can hide what you list). Choose the sources you connect, and check your
  organisation's rules for sending that data to an AI provider.
- **You are responsible for what you connect** and for complying with the law
  and the agreements that apply to you.

Found a security problem? See [SECURITY.md](https://github.com/bhoudebert/help-me-ops/blob/main/SECURITY.md).
