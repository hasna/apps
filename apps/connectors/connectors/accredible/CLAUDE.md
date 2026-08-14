# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-accredible is a TypeScript connector for the Accredible API. It provides a CLI and library for managing digital credentials, certificates, and badges.

## Build & Run Commands

```bash
bun install           # Install dependencies
bun run dev           # Run CLI in development
bun run build         # Build for distribution
bun run typecheck     # Type check
bun run dev -- --help # Show CLI help
```

## API Details

- **Base URL**: `https://api.accredible.com/v1`
- **Auth**: Rails-style token: `Authorization: Token token="YOUR_API_KEY"`
- **Pagination**: `page` (1-indexed), `page_size`

## API Resources

| Resource | Endpoints | Description |
|----------|-----------|-------------|
| Credentials | `/all_credentials`, `/credentials/{id}` | Digital credentials and certificates |
| Groups | `/issuer/all_groups`, `/issuer/groups/{id}` | Credential groups/templates |
| Designs | `/issuer/all_designs` | Certificate designs |
| Evidence | `/credentials/{id}/evidence_items` | Evidence items on credentials |
| SSO | `/sso/generate_link` | Single sign-on link generation |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ACCREDIBLE_API_KEY` | API key (overrides profile config) |

## CLI Commands

```bash
connect-accredible credentials list     # List credentials
connect-accredible credentials get <id> # Get credential by ID
connect-accredible credentials create   # Create credential
connect-accredible credentials delete   # Delete credential
connect-accredible groups list          # List groups
connect-accredible groups get <id>      # Get group by ID
connect-accredible groups create        # Create group
connect-accredible groups delete        # Delete group
connect-accredible designs list         # List designs
connect-accredible evidence add <id>    # Add evidence to credential
connect-accredible sso generate-link    # Generate SSO link
connect-accredible config set-key <key> # Set API key
connect-accredible profile list         # List profiles
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Bun runtime
