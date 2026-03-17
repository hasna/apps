# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-intercom is a TypeScript connector for the Intercom API. It provides CLI and library access to manage contacts, conversations, companies, admins, teams, articles, and customer engagement.

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
bun run dev contact list
bun run dev conversation list
bun run dev company list
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
│   └── index.ts      # Intercom API wrapper class
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

### Contacts
- List, search, get, create, update, delete contacts
- Archive/unarchive contacts
- Merge contacts (lead to user)
- Attach/detach contacts to companies
- Add/remove tags from contacts
- Create notes for contacts

### Conversations
- List, search, get conversations
- Reply to conversations (comment or note)
- Close, open, assign, snooze conversations
- Add/remove tags from conversations

### Companies
- List, get, create/update, delete companies
- List company contacts
- Add/remove tags from companies

### Tags
- List, get, create, update, delete tags

### Admins
- List admins
- Get admin info
- Get current admin (me)
- Set admin away mode

### Teams
- List teams
- Get team info

### Articles
- List, get, create, update, delete articles

### Data Events
- Track custom events
- List events for users
- Bulk track events

### Messages
- Send outbound messages (email/in-app)

## Authentication

Uses Bearer token authentication with Intercom API:
```typescript
'Authorization': `Bearer ${this.accessToken}`
'Intercom-Version': '2.11'
```

Requires:
- Access Token (from Intercom Developer Hub)

## Environment Variables

| Variable | Description |
|----------|-------------|
| `INTERCOM_ACCESS_TOKEN` | Access token (overrides profile) |

## Data Storage

```
~/.connect/connect-intercom/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
