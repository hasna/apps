# Changelog

## Unreleased

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

Initial public release of `@hasna/banking`.

Note: `0.0.1` was not used as the public release because npm rejected it as an unavailable previously published version while the public registry still returned 404.

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
