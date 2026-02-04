# connect-xads

Twitter/X Ads API connector CLI - Manage ad campaigns, promoted tweets, targeting, and analytics

## Installation

```bash
bun install -g @hasna/connect-xads
```

## Quick Start

```bash
# Set your API key
connect-xads config set-key YOUR_API_KEY

# Or use environment variable
export X_ADS_CONSUMER_KEY=YOUR_API_KEY
```

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

## Profile Management

```bash
# Create profiles for different accounts
connect-xads profile create work --api-key xxx --use
connect-xads profile create personal --api-key yyy

# Switch profiles
connect-xads profile use work

# Use profile for single command
connect-xads -p personal <command>

# List profiles
connect-xads profile list
```

## Library Usage

```typescript
import { Xads } from '@hasna/connect-xads';

const client = new Xads({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
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

Configuration stored in `~/.connect/connect-xads/`:

```
~/.connect/connect-xads/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Development

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build
bun run build

# Type check
bun run typecheck
```

## License

MIT
