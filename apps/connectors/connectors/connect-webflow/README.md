# connect-webflow

Webflow API v2 connector - Sites, Collections, Items, Pages, Assets, Forms, Users, Products, Orders

## Installation

```bash
bun install -g @hasna/connect-webflow
```

## Quick Start

```bash
# Set your API key
connect-webflow config set-key YOUR_API_KEY

# Or use environment variable
export WEBFLOW_ACCESS_TOKEN=YOUR_API_KEY
```

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

## Profile Management

```bash
# Create profiles for different accounts
connect-webflow profile create work --api-key xxx --use
connect-webflow profile create personal --api-key yyy

# Switch profiles
connect-webflow profile use work

# Use profile for single command
connect-webflow -p personal <command>

# List profiles
connect-webflow profile list
```

## Library Usage

```typescript
import { Webflow } from '@hasna/connect-webflow';

const client = new Webflow({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WEBFLOW_ACCESS_TOKEN` | OAuth2 access token |
| `WEBFLOW_SITE_ID` | Default site ID (optional) |

## Data Storage

Configuration stored in `~/.connect/connect-webflow/`:

```
~/.connect/connect-webflow/
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
