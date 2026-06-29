# Migrating Payment Integrations To `banking`

Date: 2026-06-29

This note is for moving existing payment or bank-integration code, including
`iapp-payments`-style flows, onto the public `hasna/banking` OSS package while
keeping the local checkout folder named `open-banking`.

## Naming

| Surface | Name |
| --- | --- |
| GitHub org/repo | `hasna/banking` |
| npm package | `@hasna/banking` |
| CLI binary | `banking` |
| MCP binary | `banking-mcp` |
| Local folder | `open-banking` |

Do not keep a separate plain-provider integration path. Provider behavior should
flow through the operation registry, SDK policy primitives, CLI commands, and
MCP descriptors.

## Provider Mapping

| Existing need | `banking` target |
| --- | --- |
| Mercury account/card/transaction visibility | Use Mercury live read commands with `--live true`, explicit environment, and read credentials. |
| Mercury payments, transfers, cards, webhooks, recipients, attachments, invoices, customers, categories, onboarding, or metadata writes | Use operation descriptors and request envelopes only. Do not execute provider side effects until release gates verify the exact operation. |
| Erste BCR account information and payment initiation | Use `erste-bcr` PSD2 AIS/PIS operation plans and conformance fixtures. No BCR sandbox or production execution is enabled yet. |
| Erste BCR card control, card-account AIS, funds confirmation, signing baskets, party verification, sensitive card data, or webhooks | Unsupported until BCR-specific evidence proves availability. |
| bunq and Revolut Business | Keep contract-only until their provider-specific conformance nodes enable safe execution. |

## Migration Checklist

1. Replace direct provider calls with `banking ops describe` and
   `banking ops plan` checks for the target operation.
2. Replace live mutation calls with SDK or CLI request envelopes. Persist the
   local intent id, idempotency key, policy decision, and audit event before any
   future provider execution path is considered.
3. For Mercury reads, pass `--live true --environment <sandbox|production>` and
   provide `MERCURY_SANDBOX_API_KEY`, `MERCURY_PRODUCTION_API_KEY`, or
   `MERCURY_API_KEY`. Use production only intentionally.
4. For Erste BCR, store only client ids and certificate/key file paths in
   public-facing config. Do not pass raw certificate PEM, private key PEM,
   tokens, PSU credentials, or SCA authentication data through CLI args, logs,
   task comments, or MCP messages.
5. Use the Postgres storage contract for production workflows: reserve
   idempotency, persist intent state, validate approval, append audit evidence,
   and enqueue outbox work in one serializable transaction.
6. Keep provider execution behind conformance, approval, idempotency, audit,
   reconciliation, and adversarial review gates.

## Smoke And Verification

```bash
banking ops list --provider mercury --json
banking ops plan mercury.internalTransfers.create --environment sandbox --scopes transactions:write --env-keys MERCURY_SANDBOX_API_KEY --json
banking accounts list --provider mercury --live true --environment sandbox --limit 5 --json
banking transactions list --provider mercury --live true --environment sandbox --limit 10 --order desc --json
banking ops list --provider erste-bcr --include-unsupported true --json
banking ops plan erste-bcr.payments.create --environment sandbox --scopes PIS --env-keys ERSTE_SANDBOX_CLIENT_ID,ERSTE_TPP_CERT_PATH,ERSTE_TPP_KEY_PATH --json
```

For a source checkout, the optional Mercury live smoke is read-only and skips by
default:

```bash
BANKING_MERCURY_LIVE_SMOKE=true BANKING_MERCURY_ENVIRONMENT=sandbox BANKING_MERCURY_LIVE_SMOKE_LIMIT=1 bun run smoke:mercury:live
```

The smoke prints summary counts only and reports sanitized failure classes. It
does not execute Mercury mutations.
