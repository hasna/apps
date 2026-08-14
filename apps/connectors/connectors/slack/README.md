# @hasna/connect-slack

Slack API connector with CLI and library support. Multi-profile configuration for managing multiple workspaces.

## Installation

```bash
bun install -g @hasna/connect-slack
```

## Quick Start

```bash
# Set your bot token
connect-slack config set-token xoxb-your-bot-token

# Test authentication
connect-slack test

# Send a message
connect-slack send general "Hello from CLI!"

# List channels
connect-slack channels list

# View message history
connect-slack messages history general --limit 10
```

## CLI Commands

### Configuration

```bash
connect-slack config set-token <token>    # Set bot token
connect-slack config set-user-token <token>  # Set user token
connect-slack config set-channel <channel>   # Set default channel
connect-slack config show                 # Show configuration
connect-slack config clear                # Clear configuration
```

### Profile Management

```bash
connect-slack profile list                # List profiles
connect-slack profile create <name>       # Create profile
connect-slack profile use <name>          # Switch profile
connect-slack profile delete <name>       # Delete profile
connect-slack profile show                # Show current profile

# Use specific profile for a command
connect-slack --profile work channels list
```

### Channels

```bash
connect-slack channels list               # List channels
connect-slack channels info <channel>     # Get channel info
connect-slack channels join <channel>     # Join channel
connect-slack channels leave <channel>    # Leave channel
```

### Messages

```bash
connect-slack send <channel> <text>              # Quick send
connect-slack messages send <channel> <text>     # Send message
connect-slack messages send <channel> <text> -t <ts>  # Reply to thread
connect-slack messages history <channel>         # View history
connect-slack messages search <query>            # Search messages
```

### Users

```bash
connect-slack users list                  # List users
connect-slack users info <user>           # Get user info
connect-slack test                        # Show current user
```

## Library Usage

```typescript
import { Slack } from '@hasna/connect-slack';

const slack = new Slack({
  accessToken: process.env.SLACK_BOT_TOKEN,
});

// Test authentication
const auth = await slack.test();
console.log(`Logged in as ${auth.user} in ${auth.team}`);

// List channels
const channels = await slack.channels.list();
console.log(channels);

// Send a message
await slack.send('C1234567890', 'Hello from the library!');

// Get message history
const messages = await slack.messages.history({
  channel: 'C1234567890',
  limit: 10,
});

// List users
const users = await slack.users.list();
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SLACK_BOT_TOKEN` | Bot token (xoxb-...) |
| `SLACK_USER_TOKEN` | User token (xoxp-...) |
| `SLACK_TEAM_ID` | Team/workspace ID |

## Configuration Files

Configuration is stored in `~/.hasna/connectors/connect-slack/`:

```
~/.hasna/connectors/connect-slack/
├── current_profile          # Active profile name
└── profiles/
    ├── default/
    │   ├── config.json      # Profile settings
    │   └── tokens.json      # OAuth tokens
    └── work/
        ├── config.json
        └── tokens.json
```

## Getting a Bot Token

1. Go to [Slack API Apps](https://api.slack.com/apps)
2. Create a new app or select existing
3. Navigate to "OAuth & Permissions"
4. Add required scopes:
   - `channels:read`, `channels:history`, `channels:join`
   - `chat:write`
   - `users:read`
5. Install to your workspace
6. Copy the Bot User OAuth Token

## License

Apache-2.0
