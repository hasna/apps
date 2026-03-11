# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-gmail is a TypeScript CLI and library for interacting with Gmail API. It provides OAuth2 authentication with browser-based login flow and stores tokens securely in `.connectors/connect-gmail/`.

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

## API Updates (2025-2026)

### OAuth Enforcement (May 2025)
Google fully enforced OAuth 2.0 for all Gmail access as of May 2025. Less Secure Apps / password-based auth is permanently disabled. All clients MUST use OAuth 2.0 token-based authentication.

### Scope Classification (2026)
| Scope | Classification | Notes |
|-------|---------------|-------|
| `https://mail.google.com/` | Restricted | Full access |
| `https://www.googleapis.com/auth/gmail.modify` | Restricted | Read + modify |
| `https://www.googleapis.com/auth/gmail.readonly` | Restricted | Read only |
| `https://www.googleapis.com/auth/gmail.send` | Sensitive | Send only |
| `https://www.googleapis.com/auth/gmail.metadata` | Non-sensitive | Headers only |

Restricted scopes require Google's restricted scope verification process including a third-party security assessment. For send-only use cases, prefer `gmail.send` to avoid stricter compliance requirements.

### Gmail Postmaster Tools API v2 (GA Feb 2026)
New: `POST /v2/domains/{domain}:queryDomainStats` — flexible querying of domain stats including compliance status. Supports batch operations. The v2beta endpoint was available Dec 2025.

### Deal Cards in Promotions Tab (Sep 2025)
New annotation support for creating Deal Cards. See Gmail annotations documentation.

## Authentication

OAuth authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-gmail config set-key <key>`
- OAuth flow: `connect-gmail oauth login`

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GMAIL_CLIENT_ID` | OAuth2 client ID |
| `GMAIL_CLIENT_SECRET` | OAuth2 client secret |
| `GMAIL_ACCESS_TOKEN` | Override access token |
| `GMAIL_REFRESH_TOKEN` | Override refresh token |

## Data Storage

```
~/.connectors/connect-gmail/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
