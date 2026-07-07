# @hasna/connect-zerosettle

TypeScript connector and CLI for the [ZeroSettle IAP API](https://docs.zerosettle.io/api-reference/introduction).

## Features

- Multi-profile configuration
- Publishable key authentication (`X-ZeroSettle-Key`)
- IAP endpoints: products, payment intents, checkout, transactions, entitlements, restore, subscriptions, events
- JSON and pretty CLI output

## Quick Start

```bash
cd connectors/zerosettle
bun install
export ZEROSETTLE_PUBLISHABLE_KEY=your-publishable-key
bun run dev products list
```

## Configuration

```bash
connect-zerosettle config set-key <publishable-key>
connect-zerosettle profile list
connect-zerosettle config show
```

## Library Usage

```typescript
import { ZeroSettle } from '@hasna/connect-zerosettle';

const client = new ZeroSettle({
  publishableKey: process.env.ZEROSETTLE_PUBLISHABLE_KEY!,
});

const products = await client.getProducts({ user_id: 'user-123' });
```

## License

Apache-2.0
