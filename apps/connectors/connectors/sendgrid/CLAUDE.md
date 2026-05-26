# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-sendgrid is a TypeScript connector for the SendGrid API v3. It provides CLI and library access to send emails, manage contacts, templates, senders, and suppressions.

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

# Run specific commands
bun run dev mail send --to test@example.com --from sender@example.com --subject "Test" --text "Hello"
bun run dev contact ls
bun run dev template ls
bun run dev config show
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Minimal dependencies: commander, chalk only
- Type annotations required everywhere

## Project Structure

```
src/
├── api/
│   ├── client.ts     # HTTP client with Bearer token auth
│   └── index.ts      # SendGrid API wrapper class
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

### Mail Send
- Send emails (single and batch)
- Send simple emails (convenience method)

### Contacts (Marketing)
- List, get, search contacts
- Add/update contacts (upsert)
- Delete contacts
- Get contact count

### Lists (Marketing)
- List, get, create, update, delete lists
- Add/remove contacts from lists

### Templates
- List, get, create, update, delete templates
- Manage template versions
- Activate template versions

### Senders
- List, get, create, update, delete senders
- Resend sender verification

### Stats
- Get global email stats
- Get stats by category

### Suppressions
- Bounces: list, get, delete
- Blocks: list, delete
- Spam reports: list, delete
- Invalid emails: list, delete
- Global unsubscribes: list, add, delete

### Unsubscribe Groups
- List, get, create, update, delete groups
- Manage group suppressions

### API Keys
- List, get, create, update, delete API keys

## Authentication

Uses Bearer token authentication:
```typescript
'Authorization': `Bearer ${apiKey}`
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SENDGRID_API_KEY` | API key (overrides profile) |

## Data Storage

```
~/.hasna/connectors/connect-sendgrid/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
