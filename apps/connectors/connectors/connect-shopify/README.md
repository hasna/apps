# connect-shopify

Shopify Admin API connector - Products, Orders, Customers, Inventory management

## Installation

```bash
bun install -g @hasna/connect-shopify
```

## Quick Start

```bash
# Set your API key
connect-shopify config set-key YOUR_API_KEY

# Or use environment variable
export SHOPIFY_STORE=YOUR_API_KEY
```

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

## Profile Management

```bash
# Create profiles for different accounts
connect-shopify profile create work --api-key xxx --use
connect-shopify profile create personal --api-key yyy

# Switch profiles
connect-shopify profile use work

# Use profile for single command
connect-shopify -p personal <command>

# List profiles
connect-shopify profile list
```

## Library Usage

```typescript
import { Shopify } from '@hasna/connect-shopify';

const client = new Shopify({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SHOPIFY_STORE` | Store URL (e.g., mystore.myshopify.com) |
| `SHOPIFY_ACCESS_TOKEN` | Admin API access token |
| `SHOPIFY_API_VERSION` | API version (default: 2024-01) |

## Data Storage

Configuration stored in `~/.connect/connect-shopify/`:

```
~/.connect/connect-shopify/
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
