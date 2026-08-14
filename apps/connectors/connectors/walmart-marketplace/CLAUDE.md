# CLAUDE.md

Walmart Marketplace API connector (`@hasna/connect-walmart-marketplace`).

## Commands

```bash
bun install
bun run dev
bun run build
bun run typecheck
bun test
```

## API

- Base URL: `https://marketplace.walmartapis.com/v3`
- Auth: OAuth access token in `WM_SEC.ACCESS_TOKEN`
- Required headers: `WM_SEC.ACCESS_TOKEN`, `WM_QOS.CORRELATION_ID`, `WM_SVC.NAME`
- Resources: items (`/items`), inventory (`/inventory`), orders (`/orders`)

## Configuration

Profiles at `~/.hasna/connectors/connect-walmart-marketplace/`.

Environment variables: `WALMART_ACCESS_TOKEN`, `WALMART_SERVICE_NAME`, optional `WALMART_BASE_URL`, `WALMART_CORRELATION_ID`.

`serviceName` must be set by the user (no internal brand defaults).

## Structure

```
src/api/client.ts      # HTTP client with WM_* headers
src/api/items.ts       # Items API
src/api/inventory.ts   # Inventory API
src/api/orders.ts      # Orders API
src/cli/index.ts       # Commander CLI
src/utils/config.ts    # Multi-profile config
```
