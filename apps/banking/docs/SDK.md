# SDK reference

The package root exports the core model, provider model and contracts, Mercury
read adapter, and Bun SQLite development store.

```ts
import {
  createBankingClient,
  createMercuryReadClient,
  createSqliteDevStore,
  moneyFromDecimal,
} from "@hasna/banking";
```

## Client boundary

`createBankingClient()` provides provider capability lookup and local intent
envelope builders. Its generic read methods validate the provider and return a
`provider_backed_pending` result; they do not call provider APIs.

| Method | Current result |
| --- | --- |
| `listProviders`, `getProvider` | Provider capability cards. |
| `listAccounts`, `getBalance`, `listTransactions`, `listCards` | `provider_backed_pending`; no network call. |
| `createPaymentQuote`, `createPaymentRequest`, `createPaymentStatus` | Local intent, idempotency fingerprint, and policy decision. |
| `createCardRequest`, `createCardUpdate`, `createCardLifecycle` | Local intent, idempotency fingerprint, and policy decision. Unsupported provider/card combinations are denied by policy. |

Creating an envelope never submits it. The default policy is dry-run sandbox
mode, requires approval for provider side effects, and denies sensitive card
data. Callers can supply a `BankingPolicy` to the envelope methods.

## Mercury live reads

`createMercuryReadClient` is the only network-backed SDK adapter. It requires an
explicit `sandbox` or `production` environment and resolves credentials from an
`apiKey`, the matching environment variable, `MERCURY_API_KEY`, or an optional
secret reference callback/CLI.

The adapter implements:

- `listAccounts`;
- `getBalance`;
- `listCards`, optionally account-filtered;
- `listTransactions`, optionally account-filtered.

List methods accept limit, order, and cursor input. Limits must be between 1
and 1000. Only transactions accept `startAt`. Responses are normalized into
summary types; account/routing numbers and card details are not exposed as raw
provider payloads. `MercuryCredentialError` reports credential failures and
`MercuryApiError` reports sanitized transport, response, and validation errors.

## Provider registry and contracts

Use `listOperationDescriptors`, `getOperationDescriptor`, or
`requireOperationDescriptor` to inspect provider operations. `planProviderOperation`
combines the descriptor with environment, scope, credential-key, and provider
security preflights. A plan describes readiness; it does not execute an
operation.

Provider contract helpers validate request shape and build provider-safe
request descriptors. Conformance exports pin the Mercury live-read allowlist
and the Erste BCR AIS/PIS fixture surface. A documented provider capability is
not proof of implemented execution: check descriptor `executionMode`,
`liveReadEnabled`, `providerSideEffectsEnabled`, and conformance fields.

## Core workflow

The core exports exact minor-unit money helpers, typed payment/card intents,
policy evaluation, deterministic idempotency fingerprints, maker-checker
approvals, redacted hash-chained audit events, reconciliation, and execution
workflow helpers.

`submitExecutionRequest` reserves idempotency, saves the intent, appends audit
evidence, and returns one of the workflow states. Approved requests enqueue a
`provider.dry_run` outbox entry with `providerSideEffectsEnabled: false`; the
workflow does not perform a provider mutation. Approval execution verifies the
intent binding, payload hash, expiry, human approver, maker-checker separation,
and policy snapshot.

## Stores

`BankingCoreStore` is the asynchronous storage contract. `createSqliteDevStore`
implements it with `bun:sqlite`, uses `:memory:` by default, and is explicitly
`mode: "dev"`. A supplied file path is caller-owned. The store supports
idempotency reservations, intents, approvals, audit events, reconciliation,
and outbox transitions, plus a development-only `reset()`.

Production implementations should follow the [Postgres reference
schema](schema/postgres.sql) and perform reservation, intent persistence,
approval validation, audit append, and outbox enqueue in one serializable
transaction before any future provider side effect.
