# connect-twelve-data

TypeScript connector for the [Twelve Data](https://twelvedata.com/) financial market data API.

## Features

- Real-time and historical stock, forex, and crypto market data
- API key authentication via query parameter
- Multi-profile configuration
- CLI and programmatic library access
- TypeScript with strict mode

## Quick Start

```bash
bun install
export TWELVE_DATA_API_KEY=your-api-key-here
bun run dev price AAPL
```

## CLI Commands

```bash
connect-twelve-data price <symbol>
connect-twelve-data quote <symbol>
connect-twelve-data time-series <symbol> --interval <interval>
connect-twelve-data exchange-rate <symbol>
connect-twelve-data symbols [--exchange <exchange>]
connect-twelve-data raw <path> [--query-flags]
connect-twelve-data config set-key <key>
connect-twelve-data profile list|use|create|delete|show
```

## Library Usage

```typescript
import { Connector } from '@hasna/connect-twelve-data';

const client = Connector.fromEnv();
const price = await client.price.get({ symbol: 'AAPL' });
const quote = await client.quote.get({ symbol: 'AAPL' });
const series = await client.timeSeries.get({ symbol: 'AAPL', interval: '1day' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TWELVE_DATA_API_KEY` | API key from https://twelvedata.com/ |
| `TWELVE_DATA_BASE_URL` | Optional base URL override |

## License

Apache-2.0
