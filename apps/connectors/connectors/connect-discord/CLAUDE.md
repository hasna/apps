# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

connect-discord is a TypeScript connector for Discord API v10 with multi-profile configuration support. It provides a full REST API wrapper and CLI for managing guilds, channels, messages, webhooks, application commands, and more.

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

Bearer Token authentication. Credentials can be set via:
- Environment variable (see below)
- Profile configuration: `connect-discord config set-key <key>`


## Key Patterns

### Multi-Profile Configuration

Profiles stored in `~/.connect/connect-discord/profiles/`:
- Each profile is a separate JSON file
- `current_profile` file tracks active profile
- `--profile` flag overrides for single command
- Environment variables override profile config

### Authentication

Uses Discord Bot Token for all requests:
- Environment variables: `DISCORD_BOT_TOKEN` or `DISCORD_TOKEN`
- Profile configuration: `connect-discord config set-token`

### API Modules

Each Discord resource has its own API module:
- **UsersApi**: Get user info, guilds, DMs, connections
- **GuildsApi**: Guild management, members, roles, bans, emojis, audit log
- **ChannelsApi**: Channel management, messages, reactions, pins, threads
- **WebhooksApi**: Webhook CRUD, execute webhooks
- **InvitesApi**: Invite management
- **CommandsApi**: Application commands (global and guild)
- **GatewayApi**: Gateway info, voice regions

## API Modules

Each Discord resource has its own API module:
- **UsersApi**: Get user info, guilds, DMs, connections
- **GuildsApi**: Guild management, members, roles, bans, emojis, audit log
- **ChannelsApi**: Channel management, messages, reactions, pins, threads
- **WebhooksApi**: Webhook CRUD, execute webhooks
- **InvitesApi**: Invite management
- **CommandsApi**: Application commands (global and guild)
- **GatewayApi**: Gateway info, voice regions

## CLI Commands

### User
```bash
connect-discord user me                    # Get current bot info
connect-discord user get <userId>          # Get user by ID
connect-discord user guilds                # List bot's guilds
```

### Guild
```bash
connect-discord guild get [guildId]        # Get guild info
connect-discord guild channels [guildId]   # List channels
connect-discord guild roles [guildId]      # List roles
connect-discord guild members [guildId]    # List members
connect-discord guild member <userId>      # Get specific member
connect-discord guild search-members <q>   # Search members
connect-discord guild bans [guildId]       # List bans
connect-discord guild emojis [guildId]     # List emojis
connect-discord guild invites [guildId]    # List invites
connect-discord guild webhooks [guildId]   # List webhooks
```

### Channel
```bash
connect-discord channel get <channelId>              # Get channel info
connect-discord channel messages <channelId>         # Get messages
connect-discord channel send <channelId> "text"      # Send message
connect-discord channel delete-message <chId> <msgId> # Delete message
connect-discord channel pins <channelId>             # Get pinned messages
connect-discord channel webhooks <channelId>         # Get webhooks
connect-discord channel create-invite <channelId>    # Create invite
```

### Webhook
```bash
connect-discord webhook get <webhookId>              # Get webhook
connect-discord webhook execute <id> <token> "text"  # Execute webhook
connect-discord webhook delete <webhookId>           # Delete webhook
```

### Invite
```bash
connect-discord invite get <code>          # Get invite info
connect-discord invite delete <code>       # Delete invite
```

### Commands (Application)
```bash
connect-discord commands list              # List global commands
connect-discord commands list-guild        # List guild commands
```

### Gateway
```bash
connect-discord gateway info               # Get gateway info
connect-discord gateway regions            # List voice regions
```

### Profile & Config
```bash
connect-discord profile list               # List profiles
connect-discord profile use <name>         # Switch profile
connect-discord profile create <name>      # Create profile
connect-discord config set-token <token>   # Set bot token
connect-discord config set-app-id <id>     # Set application ID
connect-discord config set-guild <id>      # Set default guild
connect-discord config show                # Show config
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DISCORD_BOT_TOKEN` | Discord Bot Token (required) |
| `DISCORD_TOKEN` | Alternative for bot token |
| `DISCORD_APPLICATION_ID` | Application ID (for commands) |
| `DISCORD_GUILD_ID` | Default guild ID |

## Data Storage

```
~/.connect/connect-discord/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Dependencies

- commander: CLI framework
- chalk: Terminal styling
