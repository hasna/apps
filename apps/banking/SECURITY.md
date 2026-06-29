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

## Live Money Posture

The initial package scaffold does not execute live bank operations. Future
money-moving and card-mutating features must pass:

- provider scope preflight
- policy evaluation
- idempotency checks
- approval gates where required
- audit logging
- reconciliation
- adversarial security review

Sensitive card data must not be exposed to agent-facing tools.
