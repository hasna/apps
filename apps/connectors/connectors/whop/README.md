# connect-whop

TypeScript CLI and library for the [Whop API v1](https://docs.whop.com/developer/api/getting-started).

## Features

- Bearer API key authentication with optional `Api-Version-Date` pinning
- Multi-profile configuration (`~/.hasna/connectors/connect-whop/`)
- Resource modules: memberships, plans, products, payments, users, webhooks, promo codes, reviews, affiliates
- Automatic retry on HTTP 429 and 5xx responses

## Quick Start

```bash
bun install
bun run dev config set-key <your-api-key>
bun run dev config set-company biz_xxxxxxxxxxxxxx
bun run dev membership list --first 10
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WHOP_API_KEY` | API key (overrides profile) |
| `WHOP_COMPANY_ID` | Default company/account ID (`biz_xxx`) |
| `WHOP_BASE_URL` | Override API base URL (default `https://api.whop.com/api/v1`) |
| `WHOP_API_VERSION_DATE` | Pin API version date header (default `2026-06-20`) |

## Commands

```bash
connect-whop user me
connect-whop membership list --statuses active,trialing
connect-whop plan list --first 20
connect-whop product list
connect-whop payment list --statuses succeeded
connect-whop webhook list
connect-whop promo list
connect-whop review list --product-id prod_xxx
connect-whop affiliate list
```

## Development

```bash
bun run typecheck
bun run build
bun test
```

## License

Apache-2.0
