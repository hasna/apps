# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

connect-telegram is a TypeScript connector for the Telegram Bot API with multi-profile configuration support. It provides both a CLI tool and a programmatic API for interacting with Telegram bots.

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
bun run dev --help
bun run dev me
bun run dev send <chatId> <text>
bun run dev updates
bun run dev get-file <fileId>
```

## Code Style

- TypeScript with strict mode
- ESM modules (type: module)
- Use async/await for all async operations
- Minimal dependencies: commander, chalk only
- Type annotations required everywhere
- Use interfaces for all API types

## Project Structure

```
src/
├── api/
│   ├── client.ts     # Telegram Bot API HTTP client
│   ├── bot.ts        # Bot info API (getMe, commands)
│   ├── messages.ts   # Message sending API
│   ├── chats.ts      # Chat management API
│   ├── updates.ts    # Updates/webhook API
│   ├── inline.ts     # Inline query API
│   └── index.ts      # Main Telegram connector class
├── cli/
│   └── index.ts      # CLI commands
├── types/
│   └── index.ts      # Type definitions
├── utils/
│   ├── config.ts     # Multi-profile configuration
│   └── output.ts     # CLI output formatting
└── index.ts          # Library exports
```

## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.hasna/connectors/connect-telegram/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variable `TELEGRAM_BOT_TOKEN` overrides profile config

### Authentication

Uses Telegram Bot Token for all requests. Token can be set via:
- Environment variable: `TELEGRAM_BOT_TOKEN`
- Profile configuration: `connect-telegram config set-token <token>`

### Service APIs

Each Telegram API feature has its own module:
- **BotApi**: Get bot info, manage commands
- **MessagesApi**: Send messages, photos, documents
- **ChatsApi**: Get chat info, members, admins
- **UpdatesApi**: Long polling and webhooks
- **InlineApi**: Handle inline queries and callbacks

## CLI Commands

### Bot Info
```bash
connect-telegram me                              # Get bot information
```

### Sending Messages
```bash
connect-telegram send <chatId> <text>            # Send text message
connect-telegram send <chatId> <text> --parse-mode HTML
connect-telegram send-photo <chatId> <path>      # Send photo
connect-telegram send-photo <chatId> <url>       # Send photo from URL
connect-telegram send-document <chatId> <path>   # Send document
```

### Updates
```bash
connect-telegram updates                         # Get recent updates
connect-telegram updates -l 20                   # Get 20 updates
connect-telegram updates -o 12345                # Start from offset
connect-telegram get-file <fileId>                # Download using Telegram's file name
connect-telegram get-file <fileId> -o ./image.jpg # Download to an explicit path
```

### Chats
```bash
connect-telegram chat <chatId>                   # Get chat info
connect-telegram chat-members <chatId>           # Get member count
connect-telegram chat-admins <chatId>            # Get administrators
```

### Webhooks
```bash
connect-telegram webhook info                    # Get webhook status
connect-telegram webhook set <url>               # Set webhook URL
connect-telegram webhook delete                  # Delete webhook
```

### Bot Commands
```bash
connect-telegram commands list                   # List bot commands
connect-telegram commands set '[{"command":"start","description":"Start"}]'
connect-telegram commands clear                  # Clear all commands
```

### Profile & Config
```bash
connect-telegram profile list                    # List profiles
connect-telegram profile use <name>              # Switch profile
connect-telegram profile create <name>           # Create profile
connect-telegram profile create <name> --bot-token <token> --use
connect-telegram config set-token <token>        # Set bot token
connect-telegram config show                     # Show config
connect-telegram config clear                    # Clear config
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Bot token (overrides profile config) |

## Data Storage

```
~/.hasna/connectors/connect-telegram/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

Profile JSON structure:
```json
{
  "botToken": "123456:ABC-DEF..."
}
```

## Programmatic Usage

```typescript
import { Telegram } from '@hasna/connect-telegram';

// Create from token
const telegram = new Telegram({ botToken: 'YOUR_BOT_TOKEN' });

// Or from environment
const telegram = Telegram.fromEnv();

// Get bot info
const me = await telegram.bot.getMe();

// Send message
const message = await telegram.messages.sendMessage({
  chatId: 123456789,
  text: 'Hello from the connector!',
});

// Get updates
const updates = await telegram.updates.getUpdates({ limit: 10 });

// Resolve or download incoming media by the file_id shown in updates
const file = await telegram.bot.getFile({ fileId: 'FILE_ID' });
const downloaded = await telegram.bot.downloadFile({ fileId: 'FILE_ID' });

// Get chat info
const chat = await telegram.chats.getChat({ chatId: '@channelname' });
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
