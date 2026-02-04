# GEMINI.md

This file provides guidance to Gemini when working with this repository.

## Project Overview

connect-wix is a TypeScript connector for the Wix REST APIs with multi-profile configuration support. It provides both a CLI and a programmatic API for managing Sites, Contacts, Members, Products, Orders, Inventory, and Bookings.

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
- Profile configuration: `connect-wix config set-key <key>`


## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.connect/connect-wix/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### Authentication

Uses Wix API keys with optional site-level context. Credentials can be set via:
- Environment variables: `WIX_API_KEY`, `WIX_SITE_ID`, `WIX_ACCOUNT_ID`
- Profile configuration: `connect-wix config set --api-key <key> --site-id <id>`

### Service APIs

Each Wix resource has its own API module:
- **SitesApi**: List, get sites (account-level)
- **ContactsApi**: List, get, create, update, delete contacts
- **MembersApi**: List, get members
- **ProductsApi**: List, get, create, update, delete products
- **OrdersApi**: List, get, update, archive orders
- **InventoryApi**: List, get, update, increment/decrement inventory
- **BookingsApi**: List services, list bookings, get details

## CLI Commands

### Sites
```bash
connect-wix sites list                    # List sites
connect-wix sites get <id>                # Get site details
```

### Contacts
```bash
connect-wix contacts list                 # List contacts
connect-wix contacts get <id>             # Get contact details
connect-wix contacts search "query"       # Search contacts
connect-wix contacts create --email x@y.com --first-name John
connect-wix contacts update <id> --revision 1 --email new@email.com
connect-wix contacts delete <id>          # Delete contact
connect-wix contacts count                # Get contact count
```

### Members
```bash
connect-wix members list                  # List members
connect-wix members get <id>              # Get member details
connect-wix members count                 # Get member count
```

### Products
```bash
connect-wix products list                 # List products
connect-wix products list --include-hidden --include-variants
connect-wix products get <id>             # Get product details
connect-wix products create --name "Product" --price 29.99
connect-wix products update <id> --name "New Name" --price 39.99
connect-wix products delete <id>          # Delete product
connect-wix products count                # Get product count
```

### Orders
```bash
connect-wix orders list                   # List orders
connect-wix orders get <id>               # Get order details
connect-wix orders update <id> --buyer-note "Note"
connect-wix orders archive <id>           # Archive order
connect-wix orders unarchive <id>         # Unarchive order
connect-wix orders count                  # Get order count
```

### Inventory
```bash
connect-wix inventory list                # List inventory items
connect-wix inventory get <id>            # Get inventory item
connect-wix inventory get-by-product <productId>
connect-wix inventory update <id> --variant-id X --quantity 10
connect-wix inventory increment <id> --variant-id X --quantity 5
connect-wix inventory decrement <id> --variant-id X --quantity 3
```

### Bookings
```bash
connect-wix bookings services             # List booking services
connect-wix bookings service <id>         # Get service details
connect-wix bookings list                 # List bookings
connect-wix bookings get <id>             # Get booking details
connect-wix bookings count                # Get booking count
connect-wix bookings services-count       # Get service count
```

### Profile & Config
```bash
connect-wix profile list                  # List profiles
connect-wix profile use <name>            # Switch profile
connect-wix profile create <name>         # Create profile
connect-wix config set --api-key <key> --site-id <id>
connect-wix config show
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WIX_API_KEY` | Wix API key |
| `WIX_SITE_ID` | Wix site ID (for site-specific calls) |
| `WIX_ACCOUNT_ID` | Wix account ID (for account-level calls) |

## Data Storage

```
~/.connect/connect-wix/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
