# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-vercel is a TypeScript connector for Vercel's REST API. It provides a CLI and programmatic interface for managing Vercel deployments, projects, domains, environment variables, and more.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
```

## CLI Commands

```bash
# Authentication
connect-vercel auth login              # Set API key
connect-vercel auth logout             # Clear API key
connect-vercel auth status             # Check auth status

# Profile management
connect-vercel profile list            # List profiles
connect-vercel profile use <name>      # Switch profile
connect-vercel profile create <name>   # Create profile
connect-vercel profile delete <name>   # Delete profile

# User
connect-vercel user                    # Get authenticated user info

# Teams
connect-vercel team list               # List teams
connect-vercel team get <id>           # Get team details
connect-vercel team use <id>           # Set team ID for requests

# Projects
connect-vercel project list            # List projects
connect-vercel project get <name>      # Get project details
connect-vercel project create <name>   # Create project
connect-vercel project delete <name>   # Delete project

# Deployments
connect-vercel deployment list         # List deployments
connect-vercel deployment get <id>     # Get deployment details
connect-vercel deployment cancel <id>  # Cancel deployment
connect-vercel deployment delete <id>  # Delete deployment
connect-vercel deployment logs <id>    # Get deployment logs

# Domains
connect-vercel domain list             # List domains
connect-vercel domain get <domain>     # Get domain details
connect-vercel domain add <project> <domain>     # Add domain to project
connect-vercel domain remove <project> <domain>  # Remove domain from project
connect-vercel domain verify <project> <domain>  # Verify domain

# Environment Variables
connect-vercel env list <project>      # List env vars
connect-vercel env get <project> <id>  # Get env var details
connect-vercel env create <project>    # Create env var
connect-vercel env delete <project> <id>  # Delete env var

# Secrets (Legacy)
connect-vercel secret list             # List secrets
connect-vercel secret get <name>       # Get secret details
connect-vercel secret create <name>    # Create secret
connect-vercel secret delete <name>    # Delete secret

# Aliases
connect-vercel alias list              # List aliases
connect-vercel alias get <id>          # Get alias details
connect-vercel alias assign <deployment> <alias>  # Assign alias
connect-vercel alias delete <id>       # Delete alias
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VERCEL_TOKEN` | API token (overrides profile config) |
| `VERCEL_TEAM_ID` | Team ID (overrides profile config) |

## Authentication

Uses Bearer token authentication. Get your token from:
https://vercel.com/account/tokens

## Data Storage

```
~/.hasna/connectors/connect-vercel/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON structure:
```json
{
  "apiKey": "vercel_token_xxx",
  "teamId": "team_xxx"
}
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Type annotations required everywhere

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with Bearer auth
│   └── index.ts      # Vercel API wrapper
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   ├── config.ts     # Multi-profile configuration
│   └── output.ts     # CLI output formatting
└── index.ts          # Library exports
```

## API Coverage

- User: Get authenticated user
- Teams: List, get, set
- Projects: List, get, create, update, delete
- Deployments: List, get, create, cancel, delete, logs
- Domains: List, get, add, remove, verify, config
- Environment Variables: List, get, create, update, delete
- Secrets (Legacy): List, get, create, delete
- Aliases: List, get, assign, delete
