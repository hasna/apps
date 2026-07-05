# connect-valence

TypeScript connector for the [Valence](https://valence.trade/) prediction markets API.

## Features

- List and get prediction markets
- Create, list, and cancel cross-venue orders
- Portfolio positions and account balances
- Cross-venue arbitrage opportunities
- Ticker matching across exchanges
- Raw API access for custom endpoints

## Installation

```bash
bun install
```

## Configuration

Set your API key via environment variable or profile:

```bash
export VALENCE_API_KEY=your-api-key
# Optional: override base URL
export VALENCE_BASE_URL=https://api.valence.trade/v1
```

Or use the CLI:

```bash
connect-valence config set-key <your-api-key>
connect-valence config set-base-url https://api.valence.trade/v1
```

Profiles are stored in `~/.hasna/connectors/connect-valence/profiles/`.

## CLI Usage

```bash
# Markets
connect-valence markets list
connect-valence markets get <marketId>
connect-valence markets match-tickers --body '{"tickers":["AAPL"]}'

# Orders
connect-valence orders list
connect-valence orders create --body '{"marketId":"m1","side":"buy","size":10}'
connect-valence orders cancel <orderId>

# Portfolio
connect-valence positions
connect-valence balances

# Arbitrage
connect-valence arbitrage list-opportunities

# Raw API
connect-valence raw --path /markets --method GET
```

## Library Usage

```typescript
import { Valence } from '@hasna/connect-valence';

const valence = new Valence({ apiKey: process.env.VALENCE_API_KEY! });
const markets = await valence.markets.listMarkets();
const positions = await valence.positions.getPositions();
```

## API Reference

- Base URL: `https://api.valence.trade/v1`
- Auth: Bearer token (`api_key`)
- Docs: https://company-134f1405.mintlify.app/docs

## License

Apache-2.0
