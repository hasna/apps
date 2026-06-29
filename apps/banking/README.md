# @hasna/banking

Agent-safe banking control plane for infrastructure and AI agents.

`@hasna/banking` is the public OSS package for a provider-capability model,
typed SDK, `banking` CLI, and `banking-mcp` entrypoint. It is request-oriented:
agents can inspect banking state and request payment/card actions, but live
money movement must pass policy, idempotency, approval, audit, and
reconciliation gates.

## Target Surfaces

| Surface | Target |
| --- | --- |
| Local folder | `open-banking` |
| GitHub repo | `hasna/banking` |
| npm package | `@hasna/banking` |
| CLI | `banking` |
| MCP binary | `banking-mcp` |
| Local data | `~/.hasna/banking/` |

## Initial Provider Scope

- Mercury: institution provider, including virtual-card lifecycle after amount
  units, scopes, IP policy, and sandbox are verified.
- bunq: institution provider after API context/session/signing and sandbox
  conformance are implemented.
- Revolut Business: institution provider with production-only card-management
  caveats encoded.
- Erste BCR: PSD2/open-banking access provider for AIS/PIS only unless broader
  commercial API access is proven.

Live money movement and virtual-card actions will remain gated by provider
scope checks, policy, idempotency, approvals, audit logging, and reconciliation.
Provider cards may document bank capabilities before adapters are released, but
card mutations fail closed until the exact operation is marked verified by a
provider conformance task.

## Install

```bash
bun add @hasna/banking
```

## CLI

```bash
banking --help
banking providers list --json
banking ops list --provider mercury --json
banking ops describe mercury.cards.createVirtual --json
banking ops plan mercury.internalTransfers.create --environment sandbox --scopes transactions:write --env-keys MERCURY_API_KEY --json
banking accounts list --provider mercury --live true --environment sandbox --limit 5 --json
banking balances get --provider mercury --account acct_123 --live true --environment sandbox --json
banking cards list --provider mercury --live true --environment sandbox --limit 1000 --json
banking cards list --provider mercury --account acct_123 --live true --environment sandbox --limit 100 --json
banking transactions list --provider mercury --live true --environment sandbox --limit 10 --order desc --json
banking transactions list --provider mercury --account acct_123 --live true --environment sandbox --limit 10 --order desc --json
banking payments request --provider mercury --account acct_123 --amount 10.00 --currency USD --to "Vendor" --recipient recipient_123 --rail ach --json
banking cards request --provider mercury --account acct_123 --label "Ops" --limit-month 250.00 --currency USD --json
```

Mercury live reads are available for accounts, balances, transactions, and
cards when `--live true` is set and credentials are supplied through
`MERCURY_API_KEY` or `--secret-key <secret-key>`. Account and routing numbers
are reduced to last-four summaries. Provider-backed reads for other providers
still fail closed until their adapters are implemented. Admin commands are
explicitly gated.

`--environment` is required for every live read. Use `sandbox` for test
credentials and `production` only when you intentionally want production
Mercury data. Public installs should prefer `MERCURY_API_KEY`; `--secret-key`
is an optional integration for machines that already have a compatible local
`secrets` CLI.

`banking ops list`, `banking ops describe`, and `banking ops plan` expose the
shared provider operation registry used to expand CLI, SDK, and MCP surfaces.
The Mercury registry covers the current official API families: accounts,
account statements, account-scoped transactions/cards, organization-wide
transactions/cards, recipients, request-send-money approvals, internal
transfers, categories, customers, invoices, attachments, events, organization,
users, credit, treasury, SAFE requests, statements, webhooks, onboarding, and
OAuth. Descriptors include provider id, resource/action, safety class,
environment support, auth scope/env requirements, endpoint metadata when known,
approval/idempotency gates, and separate flags for live reads versus
provider-side effects. Mercury live reads are enabled only for the implemented
read operations. Provider-side mutation execution remains disabled until the
descriptor's conformance, approval, idempotency, audit, and release gates pass.

## SDK

```ts
import { createBankingClient, evaluateIntentPolicy, moneyFromDecimal } from "@hasna/banking";

const banking = createBankingClient();
console.log(banking.listProviders());
```

The SDK exports provider capability cards and provider-agnostic primitives for:

- exact minor-unit money values;
- request-oriented payment and card intents;
- policy and idempotency decisions before provider side effects;
- maker-checker approval records;
- redacted audit events and reconciliation records;
- storage interfaces, a Bun SQLite dev store, and a Postgres reference schema.

## Store Safety

The production storage contract is documented in
[`docs/schema/postgres.sql`](docs/schema/postgres.sql). Production execution
must reserve idempotency, persist the intent, validate approval, enqueue
outbox work, and append audit evidence in one serializable transaction before
any provider side effect. The exported SQLite store is dev-only and intended
for local tests and non-live workflows.

## MCP

```bash
banking-mcp --help
banking-mcp --list-tools
```

The MCP entrypoint exposes stable tool descriptors and local request-envelope
dispatch helpers. The full MCP protocol server lands after the store and
provider adapter nodes.
