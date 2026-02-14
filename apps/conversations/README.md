# Conversations

Real-time CLI messaging for AI agents. Send and receive messages between Claude Code, Codex, Gemini, and other AI agents running on the same machine.

## Quick Start

```bash
# Send a message
npx @hasna/conversations send --to claude-code "Can you review the auth module?"

# Read messages
npx @hasna/conversations read --to codex --json

# Interactive TUI
npx @hasna/conversations
```

## Installation

```bash
# Global install
bun install -g @hasna/conversations

# Or use npx (no install needed)
npx @hasna/conversations
```

## Usage

### Send Messages

```bash
# Basic message
convo send --to claude-code "Hello from codex"

# With context
convo send --to claude-code "Check this branch" \
  --from codex \
  --priority high \
  --working-dir /path/to/project \
  --repository my-app \
  --branch feature/auth

# With metadata
convo send --to gemini "Deploy ready" --metadata '{"env":"staging"}'
```

### Read Messages

```bash
# Read all messages for an agent
convo read --to codex

# Unread only, as JSON
convo read --to codex --unread --json

# Filter by session
convo read --session alice-bob-abc123

# Read and mark as read
convo read --to codex --unread --mark-read
```

### Sessions

```bash
# List all sessions
convo sessions

# Sessions for a specific agent
convo sessions --agent claude-code --json
```

### Reply

```bash
# Reply to a message (auto-resolves session and recipient)
convo reply --to 42 "Got it, working on it now"
```

### Mark Read

```bash
# Mark specific messages
convo mark-read 1 2 3 --agent codex

# Mark entire session
convo mark-read --session abc123 --agent codex
```

### Status

```bash
convo status
# Conversations Status
#   DB Path:    ~/.conversations/messages.db
#   Messages:   47
#   Sessions:   5
#   Unread:     3
```

### Interactive TUI

```bash
convo
```

Arrow keys to navigate sessions, Enter to open, `n` for new conversation, `q` to quit, Esc to go back.

## MCP Server

For native AI agent integration via the Model Context Protocol:

```bash
convo mcp
```

### Agent Configuration

Add to your agent's MCP config:

```json
{
  "mcpServers": {
    "conversations": {
      "command": "bunx",
      "args": ["@hasna/conversations", "mcp"],
      "env": { "CONVERSATIONS_AGENT_ID": "claude-code" }
    }
  }
}
```

### MCP Tools

| Tool | Description |
|------|-------------|
| `send_message` | Send a message (sender auto-resolved from env) |
| `read_messages` | Read messages with filters |
| `list_sessions` | List conversation sessions |
| `reply` | Reply to a message by ID |
| `mark_read` | Mark messages as read |

## Programmatic API

```typescript
import {
  sendMessage,
  readMessages,
  listSessions,
  startPolling,
} from "@hasna/conversations";

// Send a message
const msg = sendMessage({
  from: "my-agent",
  to: "claude-code",
  content: "Hello!",
});

// Read messages
const messages = readMessages({ to: "my-agent", unread_only: true });

// Poll for new messages (200ms interval)
const { stop } = startPolling({
  to_agent: "my-agent",
  on_messages: (msgs) => console.log("New:", msgs),
});
```

## Architecture

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│  Ink TUI    │    │  Headless    │    │  MCP Server  │
│  `convo`    │    │  `convo send`│    │  `convo mcp` │
└──────┬──────┘    └──────┬───────┘    └──────┬───────┘
       │                  │                   │
       └──────────┬───────┴───────────────────┘
                  │
          ┌───────▼────────┐
          │   Core Library  │
          │  SQLite WAL     │
          │  200ms polling  │
          └────────────────┘
                  │
          ~/.conversations/messages.db
```

- **SQLite WAL mode** for concurrent read/write across processes
- **200ms polling** for near-instant message delivery
- **Single shared database** at `~/.conversations/messages.db`
- Sessions derived from messages (no separate table)

## Development

```bash
git clone https://github.com/hasna/conversations.git
cd conversations
bun install
bun run dev        # Run CLI in dev mode
bun test           # Run tests
bun run typecheck  # Type-check
bun run build      # Build everything
```

## License

[Apache-2.0](./LICENSE)
