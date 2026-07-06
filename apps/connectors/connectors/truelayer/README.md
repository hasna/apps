# TrueLayer Connector

TypeScript connector for the [TrueLayer](https://truelayer.com) open banking API. Supports payments, events, search, and raw API access with Bearer token authentication.

## Installation

```bash
bun install
```

## Authentication

Uses **Bearer token** authentication. Configure via environment variable or profile:

```bash
export TRUELAYER_ACCESS_TOKEN=your-access-token
# Optional sandbox mode
export TRUELAYER_SANDBOX=true
```

Or via CLI:

```bash
connect-truelayer config set-token <token>
connect-truelayer config set-sandbox true
```

## CLI Usage

```bash
# List payments
connect-truelayer payments list

# Get a payment
connect-truelayer payments get <payment-id>

# Create a payment (body from JSON file)
connect-truelayer payments create --body-file payment.json --idempotency-key <uuid>

# List events
connect-truelayer events list

# Search
connect-truelayer search --body '{"query":"..."}'

# Raw API request
connect-truelayer request /payments --method GET
```

## Optional Headers

Payments v3 and some legacy endpoints may require signed requests. Pass optional headers via CLI flags:

- `--idempotency-key` — sets `Idempotency-Key`
- `--signature` — sets `Tl-Signature`
- `--headers '{"Custom-Header":"value"}'` — additional headers as JSON

## API Base URLs

| Environment | Base URL |
|-------------|----------|
| Production | `https://api.truelayer.com/v1` |
| Sandbox | `https://api.truelayer-sandbox.com/v1` |

Override with `TRUELAYER_BASE_URL` or `config set-base-url`.

## Development

```bash
bun run dev -- payments list
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
