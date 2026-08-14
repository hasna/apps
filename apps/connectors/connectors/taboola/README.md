# @hasna/connect-taboola

A TypeScript connector and CLI for the [Taboola Backstage API](https://developers.taboola.com/backstage-api/reference) — the native-advertising platform. Manage accounts, campaigns, campaign items (creatives), reports, and first-party audiences.

## Features

- OAuth2 `client_credentials` authentication with automatic token caching and refresh
- Multi-profile configuration (switch between different accounts/credentials)
- Campaign, campaign item, reporting, and audience APIs
- Pretty, table, and JSON output formats
- TypeScript with strict mode; usable as a library or CLI

## Installation

```bash
bun install
bun run build
```

Or run directly in development:

```bash
bun run dev --help
```

## Authentication

Taboola issues a `client_id` and `client_secret` through your account manager. Provide them via
environment variables or the CLI config:

```bash
# Environment
export TABOOLA_CLIENT_ID=your-client-id
export TABOOLA_CLIENT_SECRET=your-client-secret
export TABOOLA_ACCOUNT_ID=your-account-id

# Or persist to the active profile
connect-taboola config set-credentials <clientId> <clientSecret>
connect-taboola config set-account <accountId>
```

The connector exchanges these for a short-lived Bearer access token at
`https://backstage.taboola.com/backstage/oauth/token` and refreshes it automatically. See
`.env.example` for all supported variables.

## CLI Usage

```bash
# Accounts
connect-taboola account list
connect-taboola account current

# Campaigns
connect-taboola campaign list
connect-taboola campaign get <campaignId>
connect-taboola campaign create -n "Summer Sale" -b "Acme" -c 0.35 -s 5000
connect-taboola campaign update <campaignId> --pause

# Campaign items (creatives)
connect-taboola item list <campaignId>
connect-taboola item create <campaignId> -u https://example.com/lp -t "Great deal"

# Reports
connect-taboola report campaign-summary day --start-date 2026-01-01 --end-date 2026-01-31
connect-taboola report campaign-summary campaign_breakdown --start-date 2026-01-01 --end-date 2026-01-31

# Audiences
connect-taboola audience create -n "Newsletter signups" --ttl 720
connect-taboola audience targeting <campaignId>
```

Global options: `-a/--account`, `-f/--format <json|table|pretty>`, `-p/--profile`, `-v/--verbose`.

## Library Usage

```typescript
import { Connector } from '@hasna/connect-taboola';

const taboola = Connector.fromEnv(); // reads TABOOLA_* env vars

const accountId = taboola.getAccountId()!;
const campaigns = await taboola.campaigns.list(accountId);

const report = await taboola.reports.campaignSummary(accountId, 'day', {
  start_date: '2026-01-01',
  end_date: '2026-01-31',
});
```

## API Modules

| Module | Methods |
|--------|---------|
| `account` | `listAllowed`, `getCurrent` |
| `campaigns` | `list`, `get`, `create`, `update`, `remove` |
| `items` | `list`, `get`, `create`, `update`, `remove` |
| `reports` | `campaignSummary`, `topCampaignContent` |
| `audiences` | `createFirstParty`, `getCampaignTargeting`, `updateCampaignTargeting` |

## Configuration & Profiles

Profiles are stored under `~/.hasna/connectors/connect-taboola/profiles/`:

```bash
connect-taboola profile create work --use
connect-taboola -p work config set-credentials <clientId> <clientSecret>
connect-taboola profile list
```

## Development

```bash
bun install
bun run dev        # Run CLI in development
bun run build      # Build for distribution
bun run typecheck  # Type check
bun test           # Run tests
```

## License

Apache-2.0
