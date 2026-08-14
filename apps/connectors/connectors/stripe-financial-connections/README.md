# connect-stripe-financial-connections

TypeScript connector for the [Stripe Financial Connections](https://stripe.com/docs/financial-connections) API.

## Features

- Bearer token authentication
- Multi-profile configuration
- Items, events, search, and raw API access
- Pretty and JSON output formats

## Quick Start

```bash
cd connectors/stripe-financial-connections
bun install
bun run dev config set-key your-api-key
bun run dev items list
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STRIPE_FINANCIAL_CONNECTIONS_API_KEY` | API key |
| `STRIPE_FINANCIAL_CONNECTIONS_BASE_URL` | Optional base URL override |

## CLI

```bash
connect-stripe-financial-connections items list
connect-stripe-financial-connections items get <itemId>
connect-stripe-financial-connections items create --body '{}'
connect-stripe-financial-connections events list
connect-stripe-financial-connections search --body '{}'
connect-stripe-financial-connections raw --path /items
```

## Library Usage

```typescript
import { StripeFinancialConnections } from '@hasna/connect-stripe-financial-connections';

const client = StripeFinancialConnections.fromEnv();
const items = await client.listItems();
```

## License

Apache-2.0
