# connect-discord

Discord API connector CLI - Guilds, Channels, Messages, Webhooks, Commands, and more

## Installation

```bash
bun install -g @hasna/connect-discord
```

## Quick Start

```bash
# Set your API key
connect-discord config set-key YOUR_API_KEY

# Or use environment variable
export DISCORD_BOT_TOKEN=YOUR_API_KEY
```

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

## Profile Management

```bash
# Create profiles for different accounts
connect-discord profile create work --api-key xxx --use
connect-discord profile create personal --api-key yyy

# Switch profiles
connect-discord profile use work

# Use profile for single command
connect-discord -p personal <command>

# List profiles
connect-discord profile list
```

## Library Usage

```typescript
import { Discord } from '@hasna/connect-discord';

const client = new Discord({ apiKey: 'YOUR_API_KEY' });

// Use the client
// See CLAUDE.md for detailed API documentation
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DISCORD_BOT_TOKEN` | Discord Bot Token (required) |
| `DISCORD_TOKEN` | Alternative for bot token |
| `DISCORD_APPLICATION_ID` | Application ID (for commands) |
| `DISCORD_GUILD_ID` | Default guild ID |

## Data Storage

Configuration stored in `~/.connect/connect-discord/`:

```
~/.connect/connect-discord/
├── current_profile   # Active profile name
└── profiles/
    ├── default.json  # Default profile
    └── {name}.json   # Named profiles
```

## Development

```bash
# Install dependencies
bun install

# Run CLI in development
bun run dev

# Build
bun run build

# Type check
bun run typecheck
```

## License

MIT
