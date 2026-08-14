# CLAUDE.md

Guidance for working with the Reframe (UserReframe) connector.

## Overview

`connect-usereframe` is a TypeScript connector for the Reframe hardware procurement API at `https://api.usereframe.ai/v1`.

## Auth

- Type: Bearer token (`Authorization: Bearer <api_key>`)
- Env: `USEREFRAME_API_KEY`, optional `USEREFRAME_BASE_URL`
- Config dir: `~/.hasna/connectors/connect-usereframe/`

## API modules

- `boms` — list, get, upload, request quotes
- `parts` — search catalog
- `suppliers` — list suppliers
- `purchaseOrders` — create purchase orders
- `shipments` — get shipment status
- `assistant` — procurement assistant messages
- `rawRequest` — escape hatch for arbitrary paths

## Commands

```bash
bun install
bun run dev
bun run typecheck
bun run build
bun test
```
