# AGENTS.md

This file provides guidance to AI coding agents when working with this repository.

## Project Overview

Brandsight/GoDaddy Domain API connector CLI - A TypeScript wrapper for domain management

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

SSO Key authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-brandsight config set-key <key>`


## Key Patterns

1. **API Client**: All API calls go through `BrandsightClient` which handles sso-key authentication
2. **Domains API**: Domain operations including availability check, purchase, DNS management
3. **CLI Commands**: Commander-based with subcommands for domains, dns, config
4. **Configuration**: Stored in `~/.connect-brandsight/config.json`
5. **Environment Variables**: `BRANDSIGHT_API_KEY`, `BRANDSIGHT_API_SECRET`, `BRANDSIGHT_CUSTOMER_ID`

## CLI Commands

```bash
# Profile Management
connect-brandsight profile list
connect-brandsight profile use <name>
connect-brandsight profile create <name> --set-api-key <key> --set-api-secret <secret> --set-customer-id <id> --use
connect-brandsight profile delete <name>
connect-brandsight profile show [name]

# Configuration (applies to active profile)
connect-brandsight config set-key <api-key>
connect-brandsight config set-secret <api-secret>
connect-brandsight config set-customer-id <customer-id>
connect-brandsight config show

# Contact Management (stored in ~/.connect/connect-brandsight/contacts/)
connect-brandsight contacts add <name> \
  --first-name "John" --last-name "Doe" \
  --email "john@example.com" --phone "+1.5551234567" \
  --address "123 Main St" --city "San Francisco" \
  --state "CA" --postal-code "94102" --country "US" \
  --default
connect-brandsight contacts list
connect-brandsight contacts show <name>
connect-brandsight contacts remove <name>
connect-brandsight contacts set-default <name>

# Domain Operations
connect-brandsight domains check <domain>
connect-brandsight domains check-bulk domain1.com domain2.com domain3.com
connect-brandsight domains suggest <keyword>
connect-brandsight domains list
connect-brandsight domains info <domain>
connect-brandsight domains tlds
connect-brandsight domains purchase <domain> --contact <name>  # Use saved contact
connect-brandsight domains purchase <domain>                    # Uses default contact
connect-brandsight domains purchase <domain> --contact-json contact.json  # Use JSON file

# DNS Operations
connect-brandsight dns list <domain>
connect-brandsight dns add <domain> <type> <name> <data>
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `BRANDSIGHT_API_KEY` | API key |

## Data Storage

```
~/.connect/connect-brandsight/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
