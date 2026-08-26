# Changelog

## 0.0.11

### Patch Changes

- 56abcec: Switch @hasna/banking local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/banking` default (with the `HASNA_BANKING_HOME` exact-app override) stays the effective data home until the store has actually been migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. The dependency is pinned exactly to `@hasna/paths@0.2.1` (XDG home migration, hotfixes plan 0f49f56a, task P3.3).

## 0.0.10

### Patch Changes

- Switch @hasna/banking local path reads/writes through the @hasna/paths resolver (XDG/macOS home layout). The legacy `~/.hasna/banking` default (with the `HASNA_BANKING_HOME` exact-app override) stays the effective data home until the store is actually migrated to the XDG data home or the operator sets the data-kind override `HASNA_DATA_HOME` — an existing local store never becomes invisible on upgrade. (XDG home migration, hotfixes plan 0f49f56a, task P3.3.)

## 0.0.9

### Patch Changes

- 009d79e: The SQLite development store now defaults to a file-backed database at the canonical package data root `~/.hasna/banking/banking.db` (created on first use, mode `0700`); `HASNA_BANKING_HOME` overrides the root, and an explicit `path` or `":memory:"` wins over both. Policy rule hashes now sort provider IDs before hashing, so persisted hashes are stable regardless of provider-list ordering. `hasna.contract.json` aligned to the contracts kit 0.11.1 schema. Sol-guided coverage added for money, policy, execution, store, CLI/MCP, and audit paths. Documentation (README, docs/STATE_LAYOUT.md) and the storage-engine waiver reason updated to match the persistent default, including the retired `open-`-prefixed legacy name.

## 0.0.8 - 2026-08-18

First version published to the public npm registry (2026-08-18). `0.0.7` was
burned on the registry (published then unpublished 2026-08-15; npm refuses
republishing it with `E400 Cannot publish over previously published version`),
so the first actual publish ships as 0.0.8. Contains the full monorepo-import
tree plus: banking execution safety workflow (97504a8ff), global state
migration to `~/.hasna/banking`, complete LICENSE, alignment with
`@hasna/contracts`, docs deep-scan, `.editorconfig`, the mercury `--secret-key`
fix for the secrets 0.2.9 non-TTY refusal, artifact-scan packing to scratch
rather than the repo root, and the approval-status fix (a rejected approval
now reports `denied` instead of `approved`).

## 0.0.7 - 2026-06-29

In-tree release; not a public npm publish. `0.0.7` was published to the public
registry and then unpublished 2026-08-15; npm refuses to republish it
(`E400 Cannot publish over previously published version`), so it is burned and
the first public publish ships as 0.0.8.

### Added

- Shared provider operation registry derived from conformance contracts, exposed
  through SDK exports, `banking ops list`, `banking ops describe`, `banking ops
plan`, and MCP operation discovery/planning tools.
- Mercury full-surface descriptor coverage for the current official API
  families: accounts, account statements, account-scoped transactions/cards,
  organization-wide transactions/cards, recipients, request-send-money
  approvals, internal transfers, categories, customers, invoices, attachments,
  events, organization, users, credit, treasury, SAFE requests, statements,
  webhooks, onboarding, and OAuth.
- Erste BCR PSD2 descriptor coverage using BCR/Erste public docs and the
  current Berlin Group NextGenPSD2 OpenAPI baseline: OAuth/redirect assumptions,
  consent lifecycle, consent/payment SCA authorisations, AIS
  accounts/balances/transactions, PIS create/get/status/cancel, cancellation
  authorisations, and creditor confirmation.
- Mercury live-read conformance guard and opt-in sanitized smoke runner for
  accounts, balances, organization-wide cards, and organization-wide
  transactions.
- Erste BCR PSD2 conformance guard with non-executable consent/payment SCA
  fixtures, PIS idempotency status checks, `X-Request-ID` mapping, and
  certificate/key path boundaries.
- Migration notes for moving existing payment integrations to the `banking`
  provider-operation model.
- MCP request-envelope parity for card unfreeze and terminate lifecycle actions.

### Changed

- CLI provider validation is derived from the provider registry, and the parser
  now supports `--key=value` plus `--` positional delimiters.
- Operation descriptors now use explicit CLI/MCP surface maps, separate
  Mercury live-read flags from provider-side mutation execution, and expose
  operation-plan requirements for future submit gates.
- Mercury provider preflight metadata now uses `MERCURY_API_KEY` as the
  canonical credential name while accepting sandbox/production-specific aliases.
- Erste BCR provider preflight metadata now accepts environment-specific client
  aliases plus TPP/QWAC certificate and key path variables, while keeping all
  PSD2 operations conformance-plan only.
- MCP environment parsing now rejects invalid environment values instead of
  silently falling back to sandbox.
- Unsupported provider operations, including Erste BCR direct card-control
  descriptors, no longer report MCP exposure even when a generic global MCP tool
  exists.

### Safety Notes

- Mercury is the only provider with live reads, and only the explicit read-only
  allowlist is implemented. Provider-side mutations remain disabled.
- Erste BCR remains PSD2 AIS/PIS conformance-only; no sandbox or production BCR
  calls are made by this package.
- BCR certificate and key handling is path-based in public surfaces. Raw PEM,
  token, PSU credential, and SCA authentication material is forbidden from logs
  and task evidence.

## 0.0.6 - 2026-06-29

### Fixed

- Mercury live `transactions list` now uses the current organization-wide `GET /api/v1/transactions` endpoint with optional `--account` filtering and `--order asc|desc` support, so latest company-wide transaction reads include credit-card activity instead of only account-scoped deposit transactions.

## 0.0.5 - 2026-06-29

### Fixed

- Mercury live `cards list` now uses the current organization-wide `GET /api/v1/cards` endpoint with optional `--account` filtering and `--limit` support, instead of undercounting via the legacy account-scoped card path.

## 0.0.4 - 2026-06-29

### Fixed

- `banking --version` now prints only the CLI version instead of falling through to help output.

## 0.0.3 - 2026-06-29

### Added

- Read-only live Mercury adapter for accounts, balances, cards, and transactions.
- `banking` CLI live-read mode for Mercury using `--live true`, explicit `--environment`, and either `MERCURY_API_KEY` or optional `--secret-key`.
- Credential resolution through env vars or an explicit local `secrets get` key on machines that provide that CLI, without printing token values.
- Redacted Mercury account summaries that expose last-four account/routing numbers instead of full values.

### Safety Notes

- Live money movement and card mutations are still not executed by `banking`; they remain request envelopes and provider-conformance gated.
- Live reads are currently Mercury-only. bunq, Revolut Business, and Erste BCR remain contract-only.
- Production Mercury reads require explicit `--environment production`; live commands do not default to production.
- Mercury API error bodies are not surfaced to callers, avoiding accidental token/provider-detail leakage.

## 0.0.2 - 2026-06-29

In-tree release; not a public npm publish. No version of `@hasna/banking` reached the public registry until 0.0.8 (first npm publish, 2026-08-18). `0.0.1` was skipped because npm refused it as an unavailable previously published version while the public registry still returned 404.

### Added

- Provider capability cards for Mercury, bunq, Revolut Business, and Erste BCR.
- Typed SDK primitives for money, intents, policy, approvals, idempotency, audit, reconciliation, and provider contracts.
- `banking` CLI with provider listing and request-envelope commands for payments and cards.
- `banking-mcp` entrypoint with safe tool descriptors and local request-envelope dispatch helpers.
- Postgres reference schema plus a Bun SQLite dev store for non-live tests and local workflows.
- Provider conformance contracts and contract-only staged adapters for the initial provider set.
- GitHub Actions CI for typecheck, tests, build, smoke, pack dry-run, and secret-pattern scanning.

### Safety Notes

- No provider adapter executes live bank calls in this release.
- Money movement and card side effects are request-oriented and require policy, idempotency, maker-checker approval, audit, and reconciliation gates before future live execution.
- Mercury and bunq sensitive-card-data operations are explicitly unsupported until exact official endpoint evidence exists.
- Revolut Business card management remains production-only because official docs mark card creation unavailable in Sandbox.
- Erste BCR is modeled as PSD2 AIS/PIS only, with no direct card-control surface.

### Validation

- `bun run verify:release` passes with typecheck, 53 tests, build, dist smoke, and pack dry-run.
- Four adversarial review gates are required before publish: security/compliance, architecture/maintainability, provider/API feasibility, and public release/publishing.
