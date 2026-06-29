# Provider API inventory - 2026-06-29

This inventory is the source baseline for expanding `@hasna/banking` beyond the
0.0.6 read-only Mercury adapter and the current Mercury/Erste BCR conformance
registry. It intentionally separates verified provider capabilities from
implementation decisions so the CLI, SDK, and MCP server can grow through
descriptors instead of ad hoc command branches.

## Sources Checked

| Provider | Source | Status |
| --- | --- | --- |
| Mercury | https://docs.mercury.com/llms.txt | Current docs index for guides, API reference pages, recipes, and changelog. |
| Mercury | https://docs.mercury.com/docs/getting-started | Auth, token tiers, token scope model, IP whitelist requirements, and token lifecycle. |
| Mercury | https://docs.mercury.com/docs/api-token-security-policies | Token downgrade/deletion windows, IP whitelist policy, and custom scope behavior. |
| Mercury | https://docs.mercury.com/docs/using-mercury-sandbox | Sandbox base URL and sandbox-token separation. |
| Mercury | https://docs.mercury.com/changelog/cards-api-now-available | Confirms card issue/manage API support; sensitive card-number retrieval remains undocumented in this inventory. |
| Mercury | Local official CLI `mercury version 0.10.2` | Resource and subcommand parity target for `banking`. |
| BCR | https://www.bcr.ro/en/open-banking | Official BCR page confirms Developer Portal registration and PSD2 Account Information plus Payment Initiation APIs. |
| Erste Group | https://developers.erstegroup.com/ | Official portal; public page is a JS app backed by `webapi.developers.erstegroup.com/api/v1`. |
| Erste Group | https://www.erstegroup.com/en/erste-open-banking | Describes PSD2 API access, explicit consent, sandbox flow, and ErsteConnect commercial API positioning. |
| Berlin Group | https://www.berlin-group.org/nextgenpsd2-downloads | Current NextGenPSD2 spec source; last updated 2025-12-02 and points to GitLab OpenAPI YAML files. |
| Berlin Group | https://gitlab.com/the-berlin-group/nextgenpsd2 | Current OpenAPI repository; core PSD2 compliancy release is `psd2-api_v1.3.16-2025-11-27.openapi.yaml`. |

The Erste Developer Portal bundle exposes public references to `bank.bcr`,
`bank.eboe`, AIS/PIS labels, sample paths, and an OpenAPI document backend
(`/open-api-documents/{slug}/published`). Direct anonymous calls to the backend
OpenAPI publication endpoint were connection-reset from this host on
2026-06-29, so the exact BCR YAML should be treated as portal-registration or
network-gated until a TPP account or documented public download URL is available.

## Current `banking` Coverage

`@hasna/banking` 0.0.6 currently supports:

- provider capability listing;
- Mercury live reads for accounts, balances, organization-wide cards, and
  organization-wide transactions;
- Mercury conformance assertions pinning the exact live-read allowlist and
  keeping all mutation descriptors non-executable;
- Erste BCR PSD2 conformance assertions for AIS/PIS descriptors, consent/payment
  SCA fixtures, PIS idempotency and `X-Request-ID` mapping, certificate/key path
  boundaries, and unsupported card-control behavior;
- request envelopes for payments and card actions;
- SDK primitives for money, intents, policy, approvals, idempotency, audit,
  reconciliation, and provider contracts;
- a `banking-mcp` entrypoint with safe descriptors for current request helpers.

It does not yet execute live provider mutations. This must remain true until
approval, idempotency, outbox, audit, provider conformance, and explicit
execution gates are implemented.

## Mercury Capability Inventory

### Authentication and Environments

- Production base URL: `https://api.mercury.com/api/v1`.
- Sandbox base URL: `https://api-sandbox.mercury.com/api/v1`.
- OAuth sandbox base URL: `https://oauth2-sandbox.mercury.com/`.
- API token auth supports basic auth with token as username and blank password,
  and bearer auth via `Authorization`.
- Token tiers are read-only, read-write, and custom.
- Read-write tokens require IP whitelisting.
- Custom tokens should grant the smallest required scopes.
- `RequestSendMoney` can queue payments requiring approval without the same
  broad write assumptions as immediate send-money.
- Production tokens do not work in sandbox; sandbox tokens must be created in
  the sandbox dashboard.

### Official CLI Parity Target

Local `mercury` v0.10.2 exposes these resources:

| Resource | Subcommands |
| --- | --- |
| `accounts` | `list`, `get` |
| `cards` | `create`, `update`, `list`, `cancel`, `freeze`, `get`, `unfreeze` |
| `categories` | `list` |
| `credit` | `list` |
| `customers` | `create`, `update`, `list`, `delete`, `get` |
| `events` | `list`, `get` |
| `invoices` | `create`, `update`, `list`, `cancel`, `download`, `get`, `attachments` |
| `org` | `get` |
| `payments` | `create`, `list`, `get`, `request`, `transfer` |
| `recipients` | `create`, `update`, `list`, `get`, `attachments list`, `attachments attach` |
| `safes` | `list`, `download`, `get` |
| `statements` | `download`, `accounts`, `treasury` |
| `transactions` | `update`, `list`, `get`, `attachments attach` |
| `treasury` | `list`, `transactions` |
| `users` | `list`, `get` |
| `webhooks` | `create`, `update`, `list`, `delete`, `get`, `verify` |
| Auth/onboarding | `login`, `logout`, `status`, `apply` |

`banking` should not copy the official CLI UX one-for-one. It should map this
surface into provider operation descriptors with shared pagination, filters,
confirmation policy, request validation, and output redaction.

### Mercury Endpoint Groups

| Group | Required `banking` operations |
| --- | --- |
| Accounts | list accounts, get account, redacted routing/account summaries, account statements, statement PDF downloads |
| Transactions | organization-wide list, account-scoped list, get, update metadata, upload attachment, filters by status/date/posted date/account/card/category/search, cursor pagination |
| Cards | list, get, create virtual, update nickname/spend limits, freeze, unfreeze, cancel, account-scoped compatibility list |
| Payments | send money to recipient, request send-money approval, list/get approval requests, internal transfer |
| Recipients | list, get, create, update, upload tax form attachment, list recipient attachments |
| Categories | list, create, edit, delete custom categories |
| AR/customers/invoices | customers CRUD, invoices CRUD/list/cancel/download, invoice attachments, AR attachment details |
| Webhooks/events | webhook CRUD, verify webhook, list/get API events |
| Organization/users | org details, team member list/get |
| Credit/treasury/SAFE | credit accounts, treasury accounts/statements/transactions, SAFE list/get/download |
| OAuth/onboarding/MCP | OAuth web flow/token exchange, onboarding submit/apply, Mercury MCP docs as a comparison surface |

### Mercury Mutation Semantics

The following are provider-side mutations and must require `--execute` or an
equivalent explicit live execution gate after request-envelope validation:

- card create/update/freeze/unfreeze/cancel;
- send money;
- request send-money;
- internal transfer;
- recipient create/update/upload attachment;
- transaction metadata update/upload attachment;
- category create/edit/delete;
- customer create/update/delete;
- invoice create/update/cancel;
- webhook create/update/delete/verify;
- onboarding submit/apply.

Every mutation descriptor needs:

- supported environments and token scope requirements;
- idempotency key or synthetic request fingerprint;
- dry-run envelope output;
- maker-checker approval requirement flag;
- audit event schema with provider response redaction;
- retry safety classification;
- sandbox conformance case before production enablement.

### Mercury Limitations

- Sensitive card number, CVC, or full PAN retrieval is not documented in the
  current Mercury card API surface. The provider capability must remain
  `revealSensitiveData: unsupported`.
- Current `banking` mutations are request envelopes only; direct provider
  mutation calls must not be added as command-specific shortcuts.
- API token security policies mean `banking` needs a token freshness/readiness
  check and clear errors when a token has been downgraded, deleted, lacks
  scope, or fails IP whitelist policy.

## Erste BCR / Erste PSD2 Inventory

### Public Capability Boundary

BCR's official Open Banking page exposes PSD2 API access through the Erste
Developer Portal and specifically names:

- PSD2 Account Information APIs (AIS);
- PSD2 Payment Initiation APIs (PIS);
- sandbox and production registration through the Developer Portal;
- test data for simulating account access.

Erste Group's open-banking page describes PSD2 access by regulated TPPs with
explicit client consent, and separate corporate/premium positioning for
ErsteConnect. That means the public `erste-bcr` provider should be modeled as a
PSD2 access provider, not as a direct institution-control provider like Mercury.

### Portal and Spec Findings

- Bank ids visible in the official portal bundle include `bank.bcr`,
  `bank.eboe`, `bank.csas`, `bank.ebc`, `bank.ebh`, `bank.ebm`, `bank.egb`, and
  `bank.slsp`.
- The portal bundle contains sample sandbox calls for:
  - `GET /api/egb/sandbox/v1/aisp/v1/accounts`;
  - `GET /api/egb/sandbox/v1/aisp/v1/accounts/resource_a1/transactions`;
  - `POST /api/egb/sandbox/v1/pisp/v1/payments/sepa-credit-transfers`.
- The bundle exposes OpenAPI document methods for listing documents and reading
  published documents, but anonymous direct calls to likely BCR slugs were not
  accessible from this host on 2026-06-29.
- Berlin Group remains the normative open-banking API shape until the BCR
  portal YAML is available through registration. The current public OpenAPI
  baseline is NextGenPSD2 core `1.3.16`, released 2025-11-27.
- The current Berlin Group core OpenAPI exposes method/path families for PIS
  payment resources, payment/cancellation authorisations, AIS accounts,
  balances and transactions, account information consents, funds confirmations,
  signing baskets, party verification, and creditor confirmation. BCR's public
  page only names AIS and PIS, so the extra families stay unsupported in
  `erste-bcr` until BCR-specific portal evidence exists.

### Erste BCR Required Operations

| Area | Required `banking` operations |
| --- | --- |
| TPP setup | provider config validation for portal app id, API key when applicable, QWAC/QSeal or client cert/key paths, redirect URIs, sandbox/live environment ids |
| OAuth/redirect | start authorization, exchange token, validate redirect URI/state, and persist token references without logging token values |
| Consent | create consent, get consent, get consent status, delete consent, and persist consent metadata without exposing PSU secrets |
| Consent SCA | create/list/get/update consent authorisations, with redirect/decoupled/embedded variants gated until BCR confirms support |
| AIS accounts | list accounts, get account, get balances, list transactions, get transaction details when supported, handle booking/pending views, keep cheques optional |
| PIS payments | initiate supported payment products only after BCR YAML confirms names and payloads, get payment resource, get payment status, cancel if supported, get bulk extended status when supported |
| Payment SCA | create/list/get/update payment authorisations and cancellation authorisations, including expired/failed SCA recovery |
| Payment confirmation | creditor confirmation update only after BCR confirms the product supports it |
| Unsupported Berlin core extras | card-account AIS, funds confirmation, signing baskets, party verification, and generic webhooks remain unsupported for BCR until BCR-specific portal evidence exists |
| SCA | redirect/decoupled/embedded flow state machine, PSU redirect URL handling, SCA status polling, expired/failed consent/payment recovery |
| Security | mTLS/certificate loading from secrets or paths, no certificate material in logs, no refresh token dumps, request signing hooks if BCR requires them |
| Conformance | Berlin Group fixture tests, sandbox happy paths once credentials exist, negative tests for missing certificates, missing consent, expired SCA, and unsupported card operations |

### Erste BCR Non-Capabilities

Until a separate commercial API contract says otherwise, `erste-bcr` must not
advertise or implement:

- virtual-card creation;
- card nickname/spend-limit updates;
- card freeze/unfreeze/cancel;
- card-account AIS operations unless BCR explicitly publishes support;
- confirmation-of-funds operations unless BCR explicitly publishes support;
- signing basket operations unless BCR explicitly publishes support;
- party or bulk-party verification operations unless BCR explicitly publishes support;
- direct account/routing credential management;
- generic webhooks equivalent to Mercury webhooks;
- recipient book management outside payment initiation payloads.

These are not PSD2 AIS/PIS capabilities in the public source set.

## Scalable CLI Architecture Requirements

The implementation now uses a provider operation registry with typed
descriptors. The descriptor drives CLI, SDK, MCP, docs, tests, and policy gates
from one source.

Each operation descriptor should include:

- `providerId`;
- `operationId`;
- `resource`;
- `action`;
- `safetyClass` (`read`, `metadata_write`, `money_movement`,
  `card_lifecycle`, `webhook_mutation`, `file_upload`, `destructive`);
- environment support;
- auth model and required scopes;
- input schema and coercion rules;
- provider endpoint/method/path template;
- pagination/filter metadata;
- response redaction policy;
- idempotency policy;
- approval policy;
- sandbox conformance status;
- production execution status;
- MCP exposure status;
- documentation links.

CLI commands should be thin adapters over descriptors:

- `banking ops list --provider mercury`;
- `banking ops describe mercury.cards.create`;
- `banking mercury cards list ...`;
- `banking mercury cards create --dry-run ...`;
- `banking mercury cards create --environment production --execute --approval <id> --idempotency-key <key> ...`;
- `banking erste-bcr consents create ...`;
- `banking erste-bcr accounts list --consent <id> ...`;
- `banking erste-bcr payments sepa-credit-transfer --dry-run ...`.

The CLI can still expose ergonomic resource commands, but dispatch should pass
through the registry so the SDK and MCP surfaces stay aligned.

## Implementation Gates

Completed gates:

1. Build the operation registry and derive CLI/MCP provider validation from it.
2. Add Mercury descriptors for the current official API families, with
   implemented live reads limited to accounts, balances, cards, and
   transactions.
3. Add Mercury mutation descriptors as dry-run request envelopes first.
4. Add Mercury live-read conformance tests and an opt-in sanitized smoke runner
   that returns summary counts only.
5. Add Erste BCR PSD2 descriptors using Berlin Group-compatible fixtures.
6. Add Erste BCR PSD2 conformance tests for consent lifecycle, SCA
   redirect/decoupled/embedded fixture state, PIS idempotency/status checks,
   certificate/key path boundaries, and unsupported card operations.

Remaining gates:

1. Add Mercury token readiness checks before any live execution: explicit
   environment, token tier, required custom scopes, IP whitelist posture,
   freshness/deletion risk, and normalized `MERCURY_API_KEY`/token aliases.
2. Add Mercury sandbox conformance tests and only then enable gated live
   execution for low-risk metadata writes.
3. Enable card and money movement mutations only after idempotency, approvals,
   audit, outbox, retry classification, and redaction tests pass.
4. Keep BCR sandbox/live calls disabled until TPP registration credentials and
   exact BCR OpenAPI YAML are available.
5. Add adversarial security, architecture, provider-parity, and release reviews
   before publishing the next patch release.
