# @hasna/connect-yotpo

TypeScript connector for the [Yotpo](https://www.yotpo.com/) Reviews and UGC API.

## Features

- OAuth client-credentials utoken exchange (store ID + API secret)
- List, get, and create product reviews
- Multi-profile configuration
- CLI and programmatic library exports

## Quick Start

```bash
cd connectors/yotpo
bun install
bun run dev config set-store-id YOUR_APP_KEY
bun run dev config set-api-secret YOUR_API_SECRET
bun run dev reviews list
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `YOTPO_STORE_ID` | Store ID / app key |
| `YOTPO_API_SECRET` | API secret |
| `YOTPO_BASE_URL` | Optional API base URL (default `https://api.yotpo.com`) |

## CLI Commands

```bash
connect-yotpo profile list
connect-yotpo config show
connect-yotpo reviews list --count 20 --page 1
connect-yotpo reviews get <reviewId>
connect-yotpo reviews create --sku SKU-1 --product-title "Widget" ...
```

## Library Usage

```typescript
import { Yotpo } from '@hasna/connect-yotpo';

const yotpo = Yotpo.fromEnv();
const reviews = await yotpo.listReviews({ count: 10 });
```

## API Reference

- [Yotpo API docs](https://apidocs.yotpo.com)

## License

Apache-2.0
