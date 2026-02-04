# AGENTS.md

This file provides guidance to AI coding agents when working with this repository.

## Project Overview

connect-webflow is a TypeScript connector for the Webflow API v2 with multi-profile configuration support. It provides both a CLI and a programmatic API for managing Sites, Collections, Items, Pages, Assets, Forms, Users, Products, and Orders.

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
- Profile configuration: `connect-webflow config set-key <key>`
- OAuth flow: `connect-webflow oauth login`

## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.connect/connect-webflow/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### Authentication

Uses Webflow OAuth2 Bearer tokens. Credentials can be set via:
- Environment variables: `WEBFLOW_ACCESS_TOKEN`, `WEBFLOW_SITE_ID`
- Profile configuration: `connect-webflow config set --token <token> --site-id <id>`

### Service APIs

Each Webflow resource has its own API module:
- **SitesApi**: List, get, publish sites
- **CollectionsApi**: List, get, create, delete collections
- **ItemsApi**: List, get, create, update, delete, publish items
- **PagesApi**: List, get pages
- **AssetsApi**: List, get, create, update, delete assets
- **FormsApi**: List forms, list/get submissions
- **UsersApi**: List, get, invite, update, delete users
- **ProductsApi**: List, get, create, update, delete products and SKUs
- **OrdersApi**: List, get, update, fulfill, unfulfill, refund orders

## CLI Commands

### Sites
```bash
connect-webflow sites list                       # List sites
connect-webflow sites get [id]                   # Get site details
connect-webflow sites publish [id]               # Publish site
```

### Collections
```bash
connect-webflow collections list --site <id>     # List collections
connect-webflow collections get <id>             # Get collection details
connect-webflow collections create --name "X" --singular "Y"
connect-webflow collections delete <id>          # Delete collection
```

### Items
```bash
connect-webflow items list <collectionId>        # List items
connect-webflow items get <collectionId> <itemId>
connect-webflow items create <collectionId> --data '{"name":"X"}'
connect-webflow items update <collectionId> <itemId> --data '{"name":"Y"}'
connect-webflow items delete <collectionId> <itemId>
connect-webflow items publish <collectionId> --ids "id1,id2"
```

### Pages
```bash
connect-webflow pages list --site <id>           # List pages
connect-webflow pages get <id>                   # Get page details
```

### Assets
```bash
connect-webflow assets list --site <id>          # List assets
connect-webflow assets get <id>                  # Get asset details
connect-webflow assets folders --site <id>       # List asset folders
connect-webflow assets delete <id>               # Delete asset
```

### Forms
```bash
connect-webflow forms list --site <id>           # List forms
connect-webflow forms get <id>                   # Get form details
connect-webflow forms submissions <formId>       # List submissions
```

### Users
```bash
connect-webflow users list --site <id>           # List users
connect-webflow users get <id>                   # Get user details
connect-webflow users invite --email x@y.com     # Invite user
connect-webflow users delete <id>                # Delete user
connect-webflow users access-groups              # List access groups
```

### Products
```bash
connect-webflow products list --site <id>        # List products
connect-webflow products get <id>                # Get product details
connect-webflow products create --name "X" --slug "x"
connect-webflow products update <id> --name "Y"
connect-webflow products delete <id>             # Archive product
connect-webflow products skus <productId>        # List SKUs
```

### Orders
```bash
connect-webflow orders list --site <id>          # List orders
connect-webflow orders list --status unfulfilled # Filter by status
connect-webflow orders get <id>                  # Get order details
connect-webflow orders update <id> --tracking "123"
connect-webflow orders fulfill <id>              # Mark as fulfilled
connect-webflow orders unfulfill <id>            # Mark as unfulfilled
connect-webflow orders refund <id>               # Refund order
```

### Profile & Config
```bash
connect-webflow profile list                     # List profiles
connect-webflow profile use <name>               # Switch profile
connect-webflow profile create <name>            # Create profile
connect-webflow config set --token <token> --site-id <id>
connect-webflow config show
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WEBFLOW_ACCESS_TOKEN` | OAuth2 access token |
| `WEBFLOW_SITE_ID` | Default site ID (optional) |

## Data Storage

```
~/.connect/connect-webflow/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
