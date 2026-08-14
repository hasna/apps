# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Resend Email API connector CLI - Send emails, manage templates, domains, API keys, audiences, contacts, webhooks, and broadcasts

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

### New Endpoints
- **`GET /emails`** (Oct 2025) — List sent emails with cursor-based pagination (`before`, `after`, `limit` params; max 100 per page)
- **Email suppression status** (Jan 2026) — New `suppressed` delivery status in email responses when Resend prevents delivery due to bounce/complaint history

### Email Suppression (Jan 2026)
New `last_event: "suppressed"` status in email objects. New `email.suppressed` webhook event. Webhooks include suppression type (`OnAccountSuppressionList`) and message.

### Endpoints Overview
| Method | Path | Description |
|--------|------|-------------|
| POST | `/emails` | Send email |
| GET | `/emails/{id}` | Get email |
| GET | `/emails` | **New** List sent emails |
| GET/POST/DELETE | `/domains` | Domain management |
| GET/POST/DELETE | `/api-keys` | API key management |
| GET/POST/DELETE | `/audiences` | Contact lists |
| GET/POST/DELETE | `/contacts` | Contacts in audience |
| GET/POST/DELETE | `/broadcasts` | Email broadcasts |

## Authentication

API Key authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-resend config set-key <key>`


## Environment Variables

| Variable | Description |
|----------|-------------|
| `RESEND_API_KEY` | API key |

## Data Storage

```
~/.hasna/connectors/connect-resend/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
