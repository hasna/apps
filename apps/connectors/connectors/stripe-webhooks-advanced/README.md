# Stripe Webhooks Advanced Connector

Focused Stripe connector for **webhook endpoint management**, **event inspection**, and **local signature verification**.

This package complements the full [`connect-stripe`](../stripe/) connector — use that for broad Stripe API coverage; use this one when your workflow centers on webhooks and event debugging.

## Features

- Webhook endpoint CRUD (`/webhook_endpoints`)
- Event list/get/search (`/events`)
- Local HMAC-SHA256 signature verification (no network)
- Authenticated `raw-request` escape hatch
- Multi-profile configuration

## Install

```bash
bun install
```

## Configuration

```bash
connect-stripe-webhooks-advanced config set-key sk_test_...
connect-stripe-webhooks-advanced config set-secret whsec_...
```

Environment variables:

| Variable | Description |
|----------|-------------|
| `STRIPE_WEBHOOKS_ADVANCED_API_KEY` | Stripe secret API key |
| `STRIPE_WEBHOOKS_ADVANCED_API_SECRET` | Webhook signing secret |
| `STRIPE_WEBHOOKS_ADVANCED_BASE_URL` | Optional API base URL |

## CLI Examples

```bash
# Webhook endpoints
connect-stripe-webhooks-advanced webhooks list
connect-stripe-webhooks-advanced webhooks create --url https://example.com/hook --events invoice.paid,customer.created
connect-stripe-webhooks-advanced webhooks delete we_123

# Events
connect-stripe-webhooks-advanced events list --type invoice.paid
connect-stripe-webhooks-advanced events get evt_123
connect-stripe-webhooks-advanced events search --query charge.succeeded

# Signature verification (local)
connect-stripe-webhooks-advanced verify signature --payload '{"id":"evt_1"}' --signature 't=...,v1=...'

# Raw API passthrough
connect-stripe-webhooks-advanced raw-request --path /webhook_endpoints --method GET
```

## API Docs

- [Webhook Endpoints](https://docs.stripe.com/api/webhook_endpoints)
- [Events](https://docs.stripe.com/api/events)
- [Webhook Signatures](https://docs.stripe.com/webhooks/signatures)

## Development

```bash
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
