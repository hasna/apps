# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

connect-whatsapp is a TypeScript connector for the WhatsApp Business Cloud API. It provides CLI and library access to send messages, manage templates, and handle media.

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
bun run dev message text <to> "Hello"
bun run dev template list
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
│   └── index.ts      # WhatsApp API wrapper class
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

### Messages
- Send text, image, audio, video, document, sticker
- Send location, contacts
- Send interactive messages (buttons, lists)
- Send template messages
- Send reactions
- Mark messages as read

### Media
- Get media URL
- Delete media

### Business Profile
- Get and update business profile

### Phone Numbers
- Get phone number info
- List phone numbers
- Request and verify codes

### Templates
- List, get, delete message templates

## Authentication

Uses Bearer token authentication with Meta Graph API:
```typescript
'Authorization': `Bearer ${this.accessToken}`
```

Requires:
- Access Token (from Meta Business Suite)
- Phone Number ID (from WhatsApp Business)
- Business Account ID (optional, for some operations)

## Environment Variables

| Variable | Description |
|----------|-------------|
| `WHATSAPP_ACCESS_TOKEN` | Access token (overrides profile) |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone number ID (overrides profile) |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Business account ID (overrides profile) |

## Data Storage

```
~/.hasna/connectors/connect-whatsapp/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
