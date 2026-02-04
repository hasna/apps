# connect-figma

Figma connector CLI - Files, Comments, Projects, Components with multi-profile support

## Installation

```bash
bun install -g @hasna/connect-figma
```

## Quick Start

```bash
# Set your API key
connect-figma config set-key YOUR_API_KEY

# Or use environment variable
export FIGMA_ACCESS_TOKEN=YOUR_API_KEY
```

## CLI Commands

### Files
```bash
connect-figma files get <fileKey>                    # Get file info
connect-figma files nodes <fileKey> --ids <nodeIds>  # Get specific nodes
connect-figma files images <fileKey> --ids <ids>     # Export images
connect-figma files versions <fileKey>               # Get version history
connect-figma files meta <fileKey>                   # Get file metadata
```

### Comments
```bash
connect-figma comments list <fileKey>                # List comments
connect-figma comments post <fileKey> <message>      # Post comment
connect-figma comments delete <fileKey> <commentId>  # Delete comment
```

### Teams
```bash
connect-figma teams projects <teamId>                # List team projects
```

### Projects
```bash
connect-figma projects list <teamId>                 # List team projects
connect-figma projects files <projectId>             # List project files
```

### Components
```bash
connect-figma components team <teamId>               # List team components
connect-figma components file <fileKey>              # List file components
connect-figma components sets <teamId>               # List team component sets
```

### Styles
```bash
connect-figma styles team <teamId>                   # List team styles
connect-figma styles file <fileKey>                  # List file styles
```

### Webhooks
```bash
connect-figma webhooks list <teamId>                 # List team webhooks
connect-figma webhooks create <teamId> -e FILE_UPDATE -u <url> --passcode <pass>
connect-figma webhooks update <webhookId> -s PAUSED
connect-figma webhooks delete <webhookId>
```

### Variables
```bash
connect-figma variables local <fileKey>              # Get local variables
connect-figma variables published <fileKey>          # Get published variables
connect-figma variables collections <fileKey>        # Get variable collections
```

### Dev Resources
```bash
connect-figma dev-resources list <fileKey>           # List dev resources
connect-figma dev-resources create <fileKey> -n <name> -u <url> --node-id <id>
connect-figma dev-resources delete <fileKey> <resourceId>
```

### User
```bash
connect-figma user me                                # Get current user
```

### Profile & Config
```bash
connect-figma profile list                           # List profiles
connect-figma profile use <name>                     # Switch profile
connect-figma profile create <name>                  # Create profile
connect-figma config set-token <token>               # Set access token
connect-figma config show                            # Show configuration
```

## Profile Management

```bash
# Create profiles for different accounts
connect-figma profile create work --api-key xxx --use
connect-figma profile create personal --api-key yyy

# Switch profiles
connect-figma profile use work

# Use profile for single command
connect-figma -p personal <command>

# List profiles
connect-figma profile list
```

## Library Usage

```typescript
import { Figma } from '@hasna/connect-figma';

const client = new Figma({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `FIGMA_ACCESS_TOKEN` | Personal access token (primary) |
| `FIGMA_TOKEN` | Personal access token (alias) |

## Data Storage

Configuration stored in `~/.connect/connect-figma/`:

```
~/.connect/connect-figma/
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
