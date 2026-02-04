# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-figma is a TypeScript connector for the Figma REST API with multi-profile configuration support. It provides both a CLI and a programmatic API for managing Files, Comments, Teams, Projects, Components, Styles, Webhooks, Variables, and Dev Resources.

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
- Profile configuration: `connect-figma config set-key <key>`


## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.connect/connect-figma/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### Authentication

Uses Figma Personal Access Tokens. Credentials can be set via:
- Environment variables: `FIGMA_ACCESS_TOKEN` or `FIGMA_TOKEN`
- Profile configuration: `connect-figma config set-token <token>`

### Service APIs

Each Figma resource has its own API module:
- **FilesApi**: Get file, get nodes, get images, get image fills, get versions, get meta
- **CommentsApi**: List, post, delete comments, add/remove reactions
- **TeamsApi**: Get team projects
- **ProjectsApi**: Get team projects, get project files
- **UsersApi**: Get current user
- **ComponentsApi**: Get team/file components, component sets, get component by key
- **StylesApi**: Get team/file styles, get style by key
- **WebhooksApi**: List, create, update, delete webhooks
- **VariablesApi**: Get local/published variables, create/update/delete variables
- **DevResourcesApi**: Get, create, update, delete dev resources

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

## Environment Variables

| Variable | Description |
|----------|-------------|
| `FIGMA_ACCESS_TOKEN` | Personal access token (primary) |
| `FIGMA_TOKEN` | Personal access token (alias) |

## Data Storage

```
~/.connect/connect-figma/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
