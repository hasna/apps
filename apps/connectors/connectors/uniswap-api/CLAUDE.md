# CLAUDE.md

Guidance for working with the Uniswap Trade API connector.

## Overview

`connect-uniswap-api` wraps the Uniswap Trade API at `https://trade-api.gateway.uniswap.org/v1`.

**Authentication:** API Key via `x-api-key` header. Register at https://developers.uniswap.org/

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun test
bun run build
```

## API Endpoints

| Method | Path | CLI |
|--------|------|-----|
| POST | `/check_approval` | `trade check-approval` |
| POST | `/quote` | `trade quote` |
| POST | `/swap` | `trade swap` |
| GET | `/swaps` | `trade swap-status` |
| GET | `/swappable_tokens` | `trade swappable-tokens` |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `UNISWAP_API_KEY` | API key (overrides profile) |
| `UNISWAP_BASE_URL` | Optional base URL override |

## Configuration

Profiles stored in `~/.hasna/connectors/connect-uniswap-api/profiles/`.

```bash
connect-uniswap-api config set-key <key>
connect-uniswap-api profile list
```

## Auth Type for Dashboard

This connector uses **apikey** auth (x-api-key header). Document in CLAUDE.md for dashboard auth detection.
