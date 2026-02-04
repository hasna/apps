# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-mixpanel is a TypeScript connector for the Mixpanel analytics platform. It provides CLI and programmatic access to Track, Engage (User Profiles), Export, Insights (JQL), Funnels, and Retention APIs with multi-profile configuration support.

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

API Key authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-mixpanel config set-key <key>`


## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.connect/connect-mixpanel/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### Authentication

Mixpanel uses different authentication for different APIs:

1. **Track API**: Uses project token (for sending events and profile updates)
2. **Data APIs**: Uses API secret with Basic Auth (for reading data)
3. **Service Account**: Username/secret for advanced APIs

Credentials can be set via:
- Environment variables: `MIXPANEL_PROJECT_TOKEN`, `MIXPANEL_API_SECRET`, `MIXPANEL_PROJECT_ID`
- Profile configuration: `connect-mixpanel config set --token <token> --secret <secret>`

### Data Residency

Supports US, EU, and India (IN) data residency:
- Set via `--region EU`, `--region IN` or `MIXPANEL_REGION=EU|IN`
- Defaults to US

### Service APIs

Each Mixpanel API has its own module:
- **TrackApi**: Track events, batch import
- **EngageApi**: User profiles (set, get, query, delete)
- **ExportApi**: Export raw event data (NDJSON)
- **InsightsApi**: JQL queries, segmentation, event lists
- **FunnelsApi**: List funnels, get funnel data
- **RetentionApi**: Cohort retention analysis

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

```
~/.connect/connect-mixpanel/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
