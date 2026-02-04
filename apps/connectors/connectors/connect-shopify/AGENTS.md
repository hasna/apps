# AGENTS.md

This file provides guidance to AI coding agents when working with this repository.

## Project Overview

connect-shopify is a TypeScript connector for the Shopify Admin API with multi-profile configuration support. It provides both a CLI and a programmatic API for managing Products, Orders, Customers, Inventory, Collections, and Shop information.

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
- Profile configuration: `connect-shopify config set-key <key>`


## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.connect/connect-shopify/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### Authentication

Uses Shopify Admin API access tokens. Credentials can be set via:
- Environment variables: `SHOPIFY_STORE`, `SHOPIFY_ACCESS_TOKEN`, `SHOPIFY_API_VERSION`
- Profile configuration: `connect-shopify config set --store <store> --token <token>`

### Service APIs

Each Shopify resource has its own API module:
- **ProductsApi**: List, get, create, update, delete products
- **OrdersApi**: List, get, fulfill, close, cancel orders
- **CustomersApi**: List, get, create, update, search customers
- **InventoryApi**: List, set, adjust inventory levels, manage locations
- **CollectionsApi**: List, get, create custom/smart collections
- **ShopApi**: Get shop information

## CLI Commands

### Products
```bash
connect-shopify products list                    # List products
connect-shopify products list --status active    # Filter by status
connect-shopify products get <id>                # Get product details
connect-shopify products create --title "Name"   # Create product
connect-shopify products update <id> --title "X" # Update product
connect-shopify products delete <id>             # Delete product
connect-shopify products count                   # Get product count
```

### Orders
```bash
connect-shopify orders list                      # List orders
connect-shopify orders list --status open        # Filter by status
connect-shopify orders get <id>                  # Get order details
connect-shopify orders fulfill <id> --location-id <loc> # Fulfill order
connect-shopify orders close <id>                # Close order
connect-shopify orders cancel <id>               # Cancel order
connect-shopify orders count                     # Get order count
```

### Customers
```bash
connect-shopify customers list                   # List customers
connect-shopify customers get <id>               # Get customer details
connect-shopify customers search "query"         # Search customers
connect-shopify customers create --email x@y.com # Create customer
connect-shopify customers update <id> --note "X" # Update customer
connect-shopify customers count                  # Get customer count
```

### Inventory
```bash
connect-shopify inventory list                   # List inventory levels
connect-shopify inventory set --item-id X --location-id Y --available 10
connect-shopify inventory adjust --item-id X --location-id Y --adjustment -5
connect-shopify inventory locations              # List locations
```

### Collections
```bash
connect-shopify collections list                 # List custom collections
connect-shopify collections list --type smart    # List smart collections
connect-shopify collections get <id>             # Get collection details
connect-shopify collections create --title "X"   # Create collection
connect-shopify collections delete <id>          # Delete collection
connect-shopify collections add-product <cid> <pid>  # Add product to collection
```

### Shop
```bash
connect-shopify shop                             # Get shop information
```

### Profile & Config
```bash
connect-shopify profile list                     # List profiles
connect-shopify profile use <name>               # Switch profile
connect-shopify profile create <name>            # Create profile
connect-shopify config set --store <store> --token <token>
connect-shopify config show
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SHOPIFY_STORE` | Store URL (e.g., mystore.myshopify.com) |
| `SHOPIFY_ACCESS_TOKEN` | Admin API access token |
| `SHOPIFY_API_VERSION` | API version (default: 2024-01) |

## Data Storage

```
~/.connect/connect-shopify/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
