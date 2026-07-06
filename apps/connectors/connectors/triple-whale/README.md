# @hasna/connect-triple-whale

TypeScript connector for the [Triple Whale](https://www.triplewhale.com/) ecommerce analytics API.

## Features

- Summary page and custom metrics (`/summary-page`, `/tw-metrics`)
- Attribution and customer journey export
- SQL data-out and Moby natural-language queries
- Data-in ingestion (orders, customers, products, ads, enrichment)
- Triple Pixel server-side events
- Compliance deletion requests
- Multi-profile configuration under `~/.hasna/connectors/connect-triple-whale`

## Install

```bash
bun install
```

## Quick start

```bash
export TRIPLE_WHALE_API_KEY=your_key
export TRIPLE_WHALE_SHOP_DOMAIN=your-shop.myshopify.com

bun run dev validate-api-key
bun run dev get-summary --start-date 2026-01-01 --end-date 2026-01-31
```

## Auth

Triple Whale uses an API key sent as the `x-api-key` header. Obtain keys from your Triple Whale dashboard.

## License

Apache-2.0
