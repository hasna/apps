# connect-totalis

TypeScript CLI and library for the [Totalis](https://docs.totalis.trade) prediction-market parlay API.

## Install

```bash
bun install
```

## Authentication

Totalis programmatic clients authenticate with an API key in the `X-API-Key` header.

```bash
export TOTALIS_API_KEY=your-api-key
# or
connect-totalis config set-key your-api-key
```

Profiles are stored under `~/.hasna/connectors/connect-totalis/profiles/`.

## Usage

```bash
# Public market data (no API key required)
connect-totalis markets list --category sports

# Wallet snapshot
connect-totalis wallet get

# Create a live quote request
connect-totalis quote-requests create --body '{"legs":[{"market_ticker":"KXBTC-26JUN01-T72500","side":"yes"}],"bet_amount":25}'

# List parlays
connect-totalis parlays list --status open,quoted
```

## Development

```bash
bun run dev -- markets list
bun run typecheck
bun test
bun run build
```

## API surface

- `GET /markets`, `GET /markets/{ticker}`, `GET /v1/markets/list`
- `GET /v1/rfqs`, `GET /v1/rfqs/{id}`
- `POST|GET|PATCH /v1/quote-requests`, cancel/commit subroutes
- `GET /v1/wallet`

See https://docs.totalis.trade for full API reference.

## License

Apache-2.0
