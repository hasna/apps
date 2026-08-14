# Uniswap API Connector

TypeScript CLI and library for the [Uniswap Trade API](https://developers.uniswap.org/docs/api-reference/).

## Setup

```bash
cd connectors/uniswap-api
bun install
cp .env.example .env
# Add your API key from https://developers.uniswap.org/
```

Or configure via CLI:

```bash
bun run dev config set-key <your-api-key>
```

## Usage

```bash
# Get a swap quote
bun run dev trade quote \
  --swapper 0xYourWallet \
  --token-in 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
  --token-out 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 \
  --amount 1000000

# Check token approval
bun run dev trade check-approval \
  --wallet 0xYourWallet \
  --token 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
  --amount 1000000

# List bridgeable tokens
bun run dev trade swappable-tokens \
  --token-in 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48

# Swap status
bun run dev trade swap-status --tx-hashes 0xabc...,0xdef...
```

## Library

```typescript
import { UniswapApi } from '@hasna/connect-uniswap-api';

const api = UniswapApi.fromEnv();
const quote = await api.quote({
  swapper: '0x...',
  tokenIn: '0x...',
  tokenOut: '0x...',
  tokenInChainId: 1,
  tokenOutChainId: 1,
  amount: '1000000',
  type: 'EXACT_INPUT',
});
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `UNISWAP_API_KEY` | Trade API key (`x-api-key` header) |
| `UNISWAP_BASE_URL` | Optional base URL override |

## Development

```bash
bun run typecheck
bun test
bun run build
```
