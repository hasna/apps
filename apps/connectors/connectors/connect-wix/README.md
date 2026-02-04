# connect-wix

Wix API connector - Sites, Contacts, Members, Products, Orders, Inventory, Bookings with multi-profile support

## Installation

```bash
bun install -g @hasna/connect-wix
```

## Quick Start

```bash
# Set your API key
connect-wix config set-key YOUR_API_KEY

# Or use environment variable
export WIX_API_KEY=YOUR_API_KEY
```

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

## Profile Management

```bash
# Create profiles for different accounts
connect-wix profile create work --api-key xxx --use
connect-wix profile create personal --api-key yyy

# Switch profiles
connect-wix profile use work

# Use profile for single command
connect-wix -p personal <command>

# List profiles
connect-wix profile list
```

## Library Usage

```typescript
import { Wix } from '@hasna/connect-wix';

const client = new Wix({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WIX_API_KEY` | Wix API key |
| `WIX_SITE_ID` | Wix site ID (for site-specific calls) |
| `WIX_ACCOUNT_ID` | Wix account ID (for account-level calls) |

## Data Storage

Configuration stored in `~/.connect/connect-wix/`:

```
~/.connect/connect-wix/
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
