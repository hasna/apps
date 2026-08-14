# Zoho Subscriptions Connector

TypeScript and CLI connector for the Zoho Billing v1 API, formerly Zoho Subscriptions. It supports customers, subscriptions, plans, hosted pages, invoices, cards, products, events, webhooks, and organization metadata.

## Install

```bash
bun install
bun run build
```

## Authentication

The API client uses a Zoho OAuth access token and a Zoho Billing organization ID.

```bash
export ZOHO_SUBSCRIPTIONS_TOKEN="your-oauth-access-token"
export ZOHO_SUBSCRIPTIONS_ORG_ID="your-organization-id"
```

Optional environment variables:

| Variable | Description |
| --- | --- |
| `ZOHO_SUBSCRIPTIONS_DATA_CENTER` | Zoho data center: `com`, `eu`, `in`, `com.au`, `jp`, `ca`, `sa`, or `uk`. Defaults to `com`. |
| `ZOHO_SUBSCRIPTIONS_BASE_URL` | Override the Zoho Billing API base URL. |

OAuth helper functions use Zoho Accounts endpoints for the selected data center and request the `ZohoSubscriptions.fullaccess.all` scope by default. Configure OAuth client credentials before using the login helper flow:

```bash
zoho-subscriptions config set-credentials --client-id <client-id> --client-secret <client-secret>
```

## CLI

```bash
zoho-subscriptions --help
zoho-subscriptions config set-token <token>
zoho-subscriptions config set-org-id <organization-id>
zoho-subscriptions customers list
zoho-subscriptions subscriptions list --status live
zoho-subscriptions plans list
zoho-subscriptions invoices list
zoho-subscriptions webhooks list
zoho-subscriptions organization
```

Profiles are stored under `~/.hasna/connectors/zoho-subscriptions/`. Profile files are written with restrictive permissions because they can contain tokens and OAuth client credentials.

## Library Usage

```ts
import { ZohoSubscriptions } from "@hasna/connect-zoho-subscriptions";

const client = new ZohoSubscriptions({
  token: process.env.ZOHO_SUBSCRIPTIONS_TOKEN!,
  organizationId: process.env.ZOHO_SUBSCRIPTIONS_ORG_ID!,
  dataCenter: process.env.ZOHO_SUBSCRIPTIONS_DATA_CENTER,
});

const subscriptions = await client.listSubscriptions({ status: "live" });
console.log(subscriptions);
```

## Development

```bash
bun run typecheck
bun test
bun run build
```

## License

Apache-2.0
