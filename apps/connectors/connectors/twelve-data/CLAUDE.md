# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-twelve-data is a TypeScript connector for the [Twelve Data](https://twelvedata.com/) financial market data API. It provides access to real-time and historical stock, forex, and crypto market data.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun test src/api      # Run connector tests
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Type annotations required everywhere

## Architecture

### Authentication

Twelve Data uses `apikey` as a query parameter (not a header):
```
https://api.twelvedata.com/price?apikey=YOUR_KEY&symbol=AAPL
```

### All endpoints are GET-only

Twelve Data uses GET requests for all operations with query parameters.

## Project Structure

```
src/
├── api/
│   ├── client.ts         # HTTP client with apikey query param auth
│   ├── price.ts          # Real-time price endpoint
│   ├── quote.ts          # Real-time quote endpoint
│   ├── time-series.ts    # Historical time series endpoint
│   ├── exchange-rate.ts  # Currency exchange rate endpoint
│   ├── symbols.ts        # Stock symbols list endpoint
│   └── index.ts          # Main Connector class
├── cli/
│   └── index.ts          # CLI commands
├── types/
│   └── index.ts          # Type definitions
├── utils/
│   ├── config.ts         # Multi-profile config (~/.hasna/connectors/connect-twelve-data/)
│   └── output.ts         # CLI output formatting
└── index.ts              # Library exports
```

## API Endpoints

- `GET /price` — Real-time price for a symbol
- `GET /quote` — Real-time quote with OHLCV data
- `GET /time_series` — Historical OHLCV time series
- `GET /exchange_rate` — Currency exchange rate
- `GET /stocks` — List available stock symbols

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TWELVE_DATA_API_KEY` | Twelve Data API key (overrides profile) |
| `TWELVE_DATA_BASE_URL` | Override base URL (default: https://api.twelvedata.com) |

## CLI Commands

```bash
connect-twelve-data price AAPL
connect-twelve-data quote AAPL
connect-twelve-data time-series AAPL --interval 1day
connect-twelve-data exchange-rate USD/EUR
connect-twelve-data symbols --exchange NASDAQ
connect-twelve-data raw /price --symbol AAPL
connect-twelve-data config set-key <key>
connect-twelve-data config show
connect-twelve-data profile list|use|create|delete|show
```
