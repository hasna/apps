# connect-mixpanel

Mixpanel connector CLI - Track events, manage profiles, export data, and query analytics

## Installation

```bash
bun install -g @hasna/connect-mixpanel
```

## Quick Start

```bash
# Set your API key
connect-mixpanel config set-key YOUR_API_KEY

# Or use environment variable
export MIXPANEL_PROJECT_TOKEN=YOUR_API_KEY
```

## CLI Commands

### Track Events
```bash
connect-mixpanel track "Page View"                              # Simple event
connect-mixpanel track "Purchase" -d user123                    # With distinct_id
connect-mixpanel track "Purchase" --properties '{"amount":99}'  # With properties
```

### User Profiles (Engage)
```bash
connect-mixpanel engage get <distinctId>                        # Get profile
connect-mixpanel engage set <distinctId> --properties '{...}'   # Set properties
connect-mixpanel engage set-once <distinctId> --properties '{}' # Set if not exists
connect-mixpanel engage add <distinctId> --properties '{"visits":1}' # Increment
connect-mixpanel engage unset <distinctId> --properties 'prop1,prop2' # Remove
connect-mixpanel engage delete <distinctId>                     # Delete profile
connect-mixpanel engage query --where 'properties["$city"]=="SF"'
```

### Export
```bash
connect-mixpanel export events --from 2024-01-01 --to 2024-01-31
connect-mixpanel export events --from 2024-01-01 --to 2024-01-31 -e "Purchase,Signup"
connect-mixpanel export events --from 2024-01-01 --to 2024-01-31 -o events.ndjson
```

### Insights
```bash
connect-mixpanel insights query 'function main() { return Events(...) }'
connect-mixpanel insights segmentation "Page View" --from 2024-01-01 --to 2024-01-31
connect-mixpanel insights events   # List event names
```

### Funnels
```bash
connect-mixpanel funnels list
connect-mixpanel funnels get <funnelId>
connect-mixpanel funnels get <funnelId> --from 2024-01-01 --to 2024-01-31
```

### Retention
```bash
connect-mixpanel retention get --from 2024-01-01 --to 2024-01-31
connect-mixpanel retention get --from 2024-01-01 --to 2024-01-31 -t compounded
connect-mixpanel retention get --from 2024-01-01 --to 2024-01-31 --born-event Signup -e Purchase
```

### Profile & Config
```bash
connect-mixpanel profile list                                   # List profiles
connect-mixpanel profile use <name>                            # Switch profile
connect-mixpanel profile create <name>                         # Create profile
connect-mixpanel config set --token <token> --secret <secret>  # Set credentials
connect-mixpanel config set --project-id <id>                  # Set project ID
connect-mixpanel config set --region EU                        # Set region
connect-mixpanel config show
```

## Profile Management

```bash
# Create profiles for different accounts
connect-mixpanel profile create work --api-key xxx --use
connect-mixpanel profile create personal --api-key yyy

# Switch profiles
connect-mixpanel profile use work

# Use profile for single command
connect-mixpanel -p personal <command>

# List profiles
connect-mixpanel profile list
```

## Library Usage

```typescript
import { Mixpanel } from '@hasna/connect-mixpanel';

const client = new Mixpanel({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `MIXPANEL_PROJECT_TOKEN` | Project token for tracking (overrides profile) |
| `MIXPANEL_API_SECRET` | API secret for data access (overrides profile) |
| `MIXPANEL_PROJECT_ID` | Project ID for queries (overrides profile) |
| `MIXPANEL_REGION` | Data residency (US, EU, or IN, default: US) |
| `MIXPANEL_SERVICE_ACCOUNT_USERNAME` | Service account username |
| `MIXPANEL_SERVICE_ACCOUNT_SECRET` | Service account secret |

## Data Storage

Configuration stored in `~/.connect/connect-mixpanel/`:

```
~/.connect/connect-mixpanel/
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
