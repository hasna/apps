# GEMINI.md

This file provides guidance to Gemini when working with this repository.

## Project Overview

connect-xads is a TypeScript connector for the Twitter/X Ads API with multi-profile configuration support. It provides CLI and programmatic access to manage ad campaigns, line items, promoted tweets, targeting, audiences, and analytics.

## Build & Run Commands

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build for distribution
bun run build

# Type check
bun run typecheck
```

## Code Style

- TypeScript with strict mode
- ESM modules (`type: module`)
- Async/await for all async operations
- Minimal dependencies: commander, chalk
- Type annotations required everywhere

## Project Structure

```
src/
├── api/           # API client modules
│   ├── client.ts  # HTTP client with authentication
│   └── index.ts   # Main connector class
├── cli/
│   └── index.ts   # CLI commands
├── types/
│   └── index.ts   # TypeScript types
├── utils/
│   ├── config.ts  # Multi-profile configuration
│   └── output.ts  # CLI output formatting
└── index.ts       # Library exports
```

## Authentication

OAuth authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-xads config set-key <key>`
- OAuth flow: `connect-xads oauth login`

## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.connect/connect-xads/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### Authentication

Uses OAuth 1.0a with HMAC-SHA1 signing. Credentials can be set via:
- Environment variables: `X_ADS_CONSUMER_KEY`, `X_ADS_CONSUMER_SECRET`, etc.
- Profile configuration: `connect-xads config set consumer-key <key>`
- PIN-based OAuth flow: `connect-xads auth login`

### API Structure

The Twitter Ads API has a hierarchical structure:
- **Account** → Contains campaigns, funding instruments
- **Campaign** → Contains line items
- **Line Item** → Contains promoted tweets, targeting criteria
- **Promoted Tweet** → Links tweets to line items for promotion

### Budget Amounts

All budget/bid amounts are in "micro" units (1/1,000,000 of the currency):
- $50 = 50,000,000 micro
- Use `formatMicro()` utility to display as regular currency

## CLI Commands

### Accounts
```bash
connect-xads accounts list              # List ad accounts
connect-xads accounts get <id>          # Get account details
connect-xads accounts funding <id>      # List funding instruments
```

### Campaigns
```bash
connect-xads campaigns list             # List campaigns
connect-xads campaigns get <id>         # Get campaign details
connect-xads campaigns create --name "..." --funding-instrument <id>
connect-xads campaigns pause <id>       # Pause campaign
connect-xads campaigns activate <id>    # Activate campaign
connect-xads campaigns delete <id>      # Delete campaign
```

### Line Items
```bash
connect-xads line-items list            # List line items
connect-xads line-items get <id>        # Get line item details
connect-xads line-items create --campaign <id> --name "..." --objective ENGAGEMENTS
connect-xads line-items pause <id>
connect-xads line-items activate <id>
connect-xads line-items delete <id>
```

### Promoted Tweets
```bash
connect-xads promoted list              # List promoted tweets
connect-xads promoted create --line-item <id> --tweets 123,456
connect-xads promoted delete <id>
```

### Targeting
```bash
connect-xads targeting list             # List targeting criteria
connect-xads targeting create --line-item <id> --type LOCATION --value US
connect-xads targeting delete <id>
connect-xads targeting locations "query" # Search locations
```

### Audiences
```bash
connect-xads audiences list             # List custom audiences
connect-xads audiences get <id>
connect-xads audiences create --name "..." --list-type EMAIL
connect-xads audiences delete <id>
```

### Analytics
```bash
connect-xads analytics campaigns --ids <ids> --start 2024-01-01 --end 2024-01-31
connect-xads analytics line-items --ids <ids> --start 2024-01-01 --end 2024-01-31
connect-xads analytics reach --objective ENGAGEMENTS --locations US
```

### Profile & Config
```bash
connect-xads profile list               # List profiles
connect-xads profile use <name>         # Switch profile
connect-xads profile create <name>      # Create profile
connect-xads config set consumer-key <key>
connect-xads config set consumer-secret <secret>
connect-xads config set account-id <id>
connect-xads config show
connect-xads auth login                 # PIN-based OAuth
connect-xads auth status
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `X_ADS_CONSUMER_KEY` | OAuth 1.0a Consumer Key |
| `X_ADS_CONSUMER_SECRET` | OAuth 1.0a Consumer Secret |
| `X_ADS_ACCESS_TOKEN` | OAuth 1.0a Access Token |
| `X_ADS_ACCESS_TOKEN_SECRET` | OAuth 1.0a Access Token Secret |
| `X_ADS_ACCOUNT_ID` | Default Ad Account ID |

## Data Storage

```
~/.connect/connect-xads/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
