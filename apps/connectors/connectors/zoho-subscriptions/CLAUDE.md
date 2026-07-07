# CLAUDE.md

Zoho Subscriptions (Billing) API connector for open-connectors.

## Build & Run

```bash
bun install
bun run dev -- customers list
bun run typecheck
bun test
bun run build
```

## Authentication

OAuth authentication. Required credentials:

- `access_token` — Zoho OAuth access token (`ZOHO_SUBSCRIPTIONS_TOKEN`)
- `organization_id` — Zoho organization ID (`ZOHO_SUBSCRIPTIONS_ORG_ID`)
- `data_center` — optional: `com`, `eu`, `in`, `com.au`, `jp`, `ca`, `sa` (default `com`)

API base: `{data_center_host}/billing/v1` with header `X-com-zoho-subscriptions-organizationid`.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ZOHO_SUBSCRIPTIONS_TOKEN` | OAuth access token |
| `ZOHO_SUBSCRIPTIONS_ORG_ID` | Organization ID |
| `ZOHO_SUBSCRIPTIONS_DATA_CENTER` | Data center code (optional) |
| `ZOHO_SUBSCRIPTIONS_BASE_URL` | Override base URL (optional) |

## CLI Examples

```bash
zoho-subscriptions config set-token <token>
zoho-subscriptions config set-org-id <org-id>
zoho-subscriptions customers list
zoho-subscriptions subscriptions list --status live
zoho-subscriptions plans list
zoho-subscriptions invoices list
zoho-subscriptions webhooks list
zoho-subscriptions organization
```

## API Surface

Customers, subscriptions (CRUD + cancel/reactivate/postpone/charge), hosted pages, plans, addons, coupons, invoices, cards, products, events, webhooks, organization.

Docs: https://www.zoho.com/billing/api/v1/
