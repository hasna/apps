# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-netlify is a TypeScript connector for Netlify's REST API. It provides a CLI and programmatic interface for managing sites, deploys, forms, DNS zones, hooks, functions, and more.

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
connect-netlify config set-key <key>   # Set API key
connect-netlify config show            # Show current config
connect-netlify config clear           # Clear config

# Profile management
connect-netlify profile list           # List profiles
connect-netlify profile use <name>     # Switch profile
connect-netlify profile create <name>  # Create profile
connect-netlify profile delete <name>  # Delete profile

# User
connect-netlify user                   # Get current user info

# Accounts
connect-netlify account list           # List accounts
connect-netlify account get <id>       # Get account details

# Sites
connect-netlify site list              # List sites
connect-netlify site get <siteId>      # Get site details
connect-netlify site create            # Create a site
connect-netlify site update <siteId>   # Update a site
connect-netlify site delete <siteId>   # Delete a site

# Deploys
connect-netlify deploy list <siteId>   # List deploys
connect-netlify deploy get <deployId>  # Get deploy details
connect-netlify deploy create <siteId> # Create a deploy
connect-netlify deploy lock <deployId> # Lock a deploy
connect-netlify deploy unlock <deployId>   # Unlock a deploy
connect-netlify deploy publish <siteId> <deployId>  # Publish a deploy
connect-netlify deploy cancel <deployId>   # Cancel a deploy

# Builds
connect-netlify build list <siteId>    # List builds
connect-netlify build get <buildId>    # Get build details
connect-netlify build trigger <siteId> # Trigger a new build

# Forms
connect-netlify form list <siteId>     # List forms
connect-netlify form submissions <formId>  # List form submissions
connect-netlify form delete <siteId> <formId>  # Delete a form

# DNS
connect-netlify dns zones              # List DNS zones
connect-netlify dns zone <zoneId>      # Get zone details
connect-netlify dns zone-create        # Create a DNS zone
connect-netlify dns zone-delete <zoneId>   # Delete a DNS zone
connect-netlify dns records <zoneId>   # List DNS records
connect-netlify dns record-create <zoneId>  # Create a DNS record
connect-netlify dns record-delete <zoneId> <recordId>  # Delete record

# Hooks
connect-netlify hook list <siteId>     # List hooks
connect-netlify hook get <hookId>      # Get hook details
connect-netlify hook delete <hookId>   # Delete a hook
connect-netlify hook enable <hookId>   # Enable a hook

# Functions
connect-netlify function list <siteId> # List functions

# Deploy Keys
connect-netlify deploy-key list        # List deploy keys
connect-netlify deploy-key get <keyId> # Get key details
connect-netlify deploy-key create      # Create a deploy key
connect-netlify deploy-key delete <keyId>  # Delete a key

# Snippets
connect-netlify snippet list <siteId>  # List snippets
connect-netlify snippet get <siteId> <snippetId>   # Get snippet
connect-netlify snippet create <siteId>    # Create a snippet
connect-netlify snippet delete <siteId> <snippetId>  # Delete snippet

# Split Tests
connect-netlify split-test list <siteId>   # List split tests
connect-netlify split-test get <siteId> <testId>   # Get split test
connect-netlify split-test enable <siteId> <testId>   # Enable test
connect-netlify split-test disable <siteId> <testId>  # Disable test
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NETLIFY_AUTH_TOKEN` | Personal access token (overrides profile) |
| `NETLIFY_TOKEN` | Alias for NETLIFY_AUTH_TOKEN |

## Authentication

Uses Bearer token authentication. Get your token from:
https://app.netlify.com/user/applications#personal-access-tokens

## Data Storage

```
~/.connect/connect-netlify/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON structure:
```json
{
  "apiKey": "netlify_pat_xxx"
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
│   └── index.ts      # Netlify API wrapper
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

- User: Get current user
- Accounts: List, get
- Sites: List, get, create, update, delete
- Deploys: List, get, create, lock, unlock, publish, cancel
- Builds: List, get, trigger
- Forms: List, delete, submissions
- DNS Zones: List, get, create, delete
- DNS Records: List, get, create, delete
- Hooks: List, get, create, update, delete, enable
- Deploy Keys: List, get, create, delete
- Functions: List
- Snippets: List, get, create, update, delete
- Split Tests: List, get, create, update, enable, disable
- Environment Variables: List, get, set, delete
