# connect-stripeapps

Stripe Apps connector CLI - items, events, search, and raw requests against the Stripe Apps REST API.

## Installation

```bash
bun install -g @hasna/connect-stripeapps
```

## Quick Start

```bash
# Set your API key
connect-stripeapps config set-key YOUR_API_KEY

# Or use environment variables
export STRIPEAPPS_API_KEY=YOUR_API_KEY
# Optional: override the default base URL
export STRIPEAPPS_BASE_URL=https://api.stripeapps.com/v1
```

## CLI Commands

```bash
connect-stripeapps config set-key <key>        # Set API key
connect-stripeapps config set-base-url <url>   # Set a custom base URL
connect-stripeapps config show                 # Show config
connect-stripeapps profile list                # List profiles
connect-stripeapps profile use <name>          # Switch profile

connect-stripeapps list-items                  # GET /items
connect-stripeapps create-item --name "Demo"   # POST /items
connect-stripeapps get-item <itemId>           # GET /items/{itemId}
connect-stripeapps list-events                 # GET /events
connect-stripeapps search "query"              # POST /search
connect-stripeapps raw-request /items -X GET   # Any endpoint
```

### Examples

```bash
# List the first 5 items with a status filter
connect-stripeapps list-items --limit 5 --status active

# Create an item with metadata
connect-stripeapps create-item --name "Widget" --metadata '{"sku":"W-1"}'

# Search with filters, JSON output
connect-stripeapps -f json search "widget" --filters '{"category":"hardware"}'

# Raw POST request
connect-stripeapps raw-request /items -X POST -d '{"name":"Widget"}'
```

## Profile Management

```bash
# Create profiles for different accounts
connect-stripeapps profile create work --api-key xxx --use
connect-stripeapps profile create personal --api-key yyy

# Switch profiles
connect-stripeapps profile use work

# Use a profile for a single command
connect-stripeapps -p personal list-items
```

## Library Usage

```typescript
import { StripeApps } from '@hasna/connect-stripeapps';

const client = new StripeApps({ apiKey: 'YOUR_API_KEY' });

const items = await client.items.list({ limit: 10 });
const item = await client.items.create({ name: 'Widget' });
const events = await client.events.list({ type: 'item.created' });
const results = await client.search.search({ query: 'widget' });
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STRIPEAPPS_API_KEY` | API key (used as a Bearer token) |
| `STRIPEAPPS_BASE_URL` | Optional API base URL override |

## Data Storage

Configuration is stored in `~/.hasna/connectors/stripeapps/`:

```
~/.hasna/connectors/stripeapps/
├── current_profile      # Active profile name
└── profiles/
    └── {name}/
        └── config.json  # Per-profile credentials
```

## Development

```bash
bun install       # Install dependencies
bun run dev       # Run CLI in development
bun run build     # Build for distribution
bun run typecheck # Type check
bun test          # Run tests
```

## License

Apache-2.0
