# Security Policy

`@hasna/banking` is a banking control-plane package. Treat all payment,
provider credential, account, and card flows as sensitive.

## Supported Versions

Only the latest published version is supported during the initial pre-1.0
period.

## Reporting A Vulnerability

Open a private security advisory on GitHub or contact the maintainers through
the Hasna security channel. Do not include secrets, API tokens, card numbers,
account numbers, or bank credentials in reports.

## Live Banking Posture

The package currently allows a narrow Mercury read-only live path for
accounts, balances, organization-wide cards, and organization-wide
transactions. These commands require `--live true`, an explicit
`--environment`, and Mercury credentials from env vars or an explicit local
secret reference resolved by a compatible local secrets CLI. Do not pass raw
tokens through command arguments. Responses redact full account/routing numbers,
live smoke output is summary-only, and provider error bodies are not surfaced.

The package does not execute provider-side mutations. Future money-moving,
card-mutating, webhook, attachment, metadata-write, or PSD2 state-changing
features must pass:

- provider scope preflight
- policy evaluation
- idempotency checks
- approval gates where required
- audit logging
- reconciliation
- adversarial security review

Sensitive card data must not be exposed to agent-facing tools.

## Provider-Specific Boundaries

- Mercury: live reads are limited to the explicit conformance allowlist. Payment,
  transfer, recipient, card lifecycle, webhook, invoice, customer, onboarding,
  attachment, category, and transaction metadata mutations are request envelopes
  or operation plans only.
- Erste BCR: modeled as PSD2 AIS/PIS conformance only. The public package must
  not run BCR sandbox or production calls until registered TPP credentials,
  bank-specific OpenAPI details, SCA behavior, and certificate-backed transport
  are verified.
- Erste BCR direct card control, card-account AIS, funds confirmation, signing
  baskets, party verification, sensitive card data, and Mercury-style webhooks
  remain unsupported unless BCR-specific evidence proves availability.

## Secret Handling

Never pass raw API tokens, certificate PEM, private key PEM, refresh tokens, PSU
credentials, SCA authentication data, card numbers, CVC values, or full account
numbers through CLI args, task comments, logs, issue text, or MCP messages.

Allowed public env names are intentionally narrow. For Erste BCR, prefer client
id aliases and filesystem paths such as `ERSTE_SANDBOX_CLIENT_ID`,
`ERSTE_PRODUCTION_CLIENT_ID`, `ERSTE_TPP_CERT_PATH`, and `ERSTE_TPP_KEY_PATH`.
Raw `*_CERT_PEM` and `*_KEY_PEM` values are rejected by preflight tests and must
stay out of logs and committed files.
