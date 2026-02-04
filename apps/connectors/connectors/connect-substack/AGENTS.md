# AGENTS.md

This file provides guidance to AI coding agents when working with this repository.

## Project Overview

connect-substack is a TypeScript connector for Substack's unofficial API with multi-profile configuration support. It provides both a CLI tool and a TypeScript library for programmatic access. Since Substack doesn't have a public API, this connector uses reverse-engineered endpoints with cookie-based authentication.

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
- Profile configuration: `connect-substack config set-key <key>`


## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.connect/connect-substack/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables `SUBSTACK_SUBDOMAIN` and `SUBSTACK_TOKEN` override profile config

### Authentication

Uses cookie-based authentication with the `substack.sid` session token:
1. Log in to Substack in your browser
2. Open Developer Tools > Application > Cookies
3. Find the `substack.sid` cookie value
4. Use this as the token in the connector

Credentials can be set via:
- Environment variables: `SUBSTACK_SUBDOMAIN`, `SUBSTACK_TOKEN`
- Profile configuration: `connect-substack config set --subdomain <name> --token <token>`

### Service APIs

Each Substack feature has its own API module:
- **PostsApi**: List posts, get post, create draft, publish, delete
- **SubscribersApi**: List subscribers, get stats, export
- **CommentsApi**: List comments on posts
- **StatsApi**: Publication stats, subscriber growth
- **PublicationApi**: Publication info, sections, user info

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

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SUBSTACK_SUBDOMAIN` | Publication subdomain (overrides profile) |
| `SUBSTACK_TOKEN` | Session token - substack.sid cookie (overrides profile) |

## Data Storage

```
~/.connect/connect-substack/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
