# connect-substack

Substack connector CLI - Posts, subscribers, stats with multi-profile support

## Installation

```bash
bun install -g @hasna/connect-substack
```

## Quick Start

```bash
# Set your API key
connect-substack config set-key YOUR_API_KEY

# Or use environment variable
export SUBSTACK_SUBDOMAIN=YOUR_API_KEY
```

## CLI Commands

### Posts
```bash
connect-substack posts list                    # List published posts
connect-substack posts list --drafts           # List drafts
connect-substack posts list -n 50              # Limit results
connect-substack posts list -t newsletter      # Filter by type
connect-substack posts get <postId>            # Get post by ID
connect-substack posts get <slug>              # Get post by slug
connect-substack posts create --title "Title" --body "Content"  # Create draft
connect-substack posts create --title "Title" --body "Content" --publish  # Create and publish
connect-substack posts create --title "Title" --body "Content" --publish --send  # Publish and email
connect-substack posts publish <draftId>       # Publish a draft
connect-substack posts publish <draftId> --send  # Publish and send email
connect-substack posts delete <draftId>        # Delete a draft
```

### Subscribers
```bash
connect-substack subscribers list              # List all subscribers
connect-substack subscribers list -t paid      # Filter by type (free, paid, comp, gift)
connect-substack subscribers list -s "email"   # Search by email/name
connect-substack subscribers stats             # Get subscriber statistics
connect-substack subscribers export            # Export subscribers (CSV)
connect-substack subscribers export --format json  # Export as JSON
```

### Comments
```bash
connect-substack comments list <postId>        # List comments on a post
connect-substack comments list <postId> --sort newest  # Sort by newest
```

### Stats & Publication
```bash
connect-substack stats                         # Get publication statistics
connect-substack publication                   # Get publication info
connect-substack pub                           # Alias for publication
connect-substack me                            # Get current user info
```

### Output Formats
```bash
connect-substack -f yaml posts list    # YAML output (default)
connect-substack -f json posts list    # JSON output
connect-substack -f pretty posts list  # Pretty-printed output
```

### Profile & Config
```bash
connect-substack profile list                  # List profiles
connect-substack profile use <name>            # Switch profile
connect-substack profile create <name>         # Create profile
connect-substack profile create <name> --subdomain <sub> --token <tok> --use
connect-substack config set --subdomain <name> --token <token>  # Set credentials
connect-substack config show                   # Show configuration
connect-substack config clear                  # Clear configuration
```

## Profile Management

```bash
# Create profiles for different accounts
connect-substack profile create work --api-key xxx --use
connect-substack profile create personal --api-key yyy

# Switch profiles
connect-substack profile use work

# Use profile for single command
connect-substack -p personal <command>

# List profiles
connect-substack profile list
```

## Library Usage

```typescript
import { Substack } from '@hasna/connect-substack';

const client = new Substack({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SUBSTACK_SUBDOMAIN` | Publication subdomain (overrides profile) |
| `SUBSTACK_TOKEN` | Session token - substack.sid cookie (overrides profile) |

## Data Storage

Configuration stored in `~/.connect/connect-substack/`:

```
~/.connect/connect-substack/
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
