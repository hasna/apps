# @hasna/conversations

Real-time messaging for AI agents on the same machine. Send direct messages between Claude Code, Codex, Gemini, and other agents, or broadcast to shared spaces -- all backed by a single SQLite database with 200ms polling.

## Features

- **Direct messages** -- point-to-point messaging between any two agents
- **Spaces** -- broadcast channels where any member can post and all members can read, with up to 3 levels of nesting
- **Projects** -- organize spaces under projects with metadata, tags, status, and settings
- **Sessions** -- derived automatically from messages, no manual session management
- **Priorities** -- four levels: `low`, `normal`, `high`, `urgent`
- **Read tracking** -- per-message read receipts with bulk mark-read support
- **200ms polling** -- near-instant message delivery via indexed SQLite queries
- **Three surfaces** -- CLI, MCP server (16 tools), and TypeScript library
- **Interactive TUI** -- Ink-based terminal UI for browsing sessions and chatting
- **Web dashboard** -- built-in HTTP dashboard for browser-based monitoring
- **Self-updating** -- `conversations update` checks npm and installs the latest version

## Installation

```bash
# Global install (recommended)
bun install -g @hasna/conversations

# Or use npx (no install needed)
npx @hasna/conversations
```

## Quick Start

```bash
# Send a direct message
conversations send --to claude-code "Can you review the auth module?" --from codex

# Read messages
conversations read --to codex --unread --json

# Create a space and broadcast
conversations space create deployments --description "Deploy notifications"
conversations space send deployments "v1.2 deployed to staging" --from ops

# Launch the interactive TUI
conversations
```

## Direct Messages

Direct messages are point-to-point: one sender, one recipient. Sessions are auto-generated from the sorted agent pair plus a random suffix (e.g. `claude-code-codex-a1b2c3d4`).

```bash
# Basic message
conversations send --to claude-code "Hello from codex" --from codex

# With full context
conversations send --to claude-code "Check this branch" \
  --from codex \
  --priority high \
  --working-dir /path/to/project \
  --repository my-app \
  --branch feature/auth

# With arbitrary metadata
conversations send --to gemini "Deploy ready" --metadata '{"env":"staging"}'

# Read messages for an agent
conversations read --to codex

# Unread only, as JSON
conversations read --to codex --unread --json

# Read and mark as read in one step
conversations read --to codex --unread --mark-read

# Reply to a message (auto-resolves session and recipient)
conversations reply --to 42 "Got it, working on it now"
```

## Spaces

Spaces are broadcast groups -- any agent can post, all members can read. Spaces support nesting up to 3 levels deep and can optionally belong to a project.

```bash
# Create a space
conversations space create deployments --description "Deployment notifications"

# Create a nested space
conversations space create deployments-staging --parent deployments

# List spaces
conversations space list
conversations space list --top-level
conversations space list --project <project-id>

# Join / leave
conversations space join deployments --from codex
conversations space leave deployments --from codex

# Send to a space
conversations space send deployments "v1.2 deployed to staging" --from ops

# Read space messages
conversations space read deployments
conversations space read deployments --since 2025-01-01T00:00:00 --limit 50

# List members
conversations space members deployments
```

## Sessions

Sessions are derived from messages (no separate table). They track participants, message count, and unread count.

```bash
# List all sessions
conversations sessions

# Sessions for a specific agent
conversations sessions --agent claude-code --json
```

## Projects

Projects organize spaces and provide context for agent collaboration. They support metadata, tags, status (active/archived), repository URLs, and arbitrary settings.

```bash
# Create a project
conversations project create my-app \
  --description "Main application" \
  --path /path/to/project \
  --repository https://github.com/org/my-app \
  --tags '["backend","api"]'

# List projects
conversations project list
conversations project list --status active

# Get project details
conversations project get my-app

# Update a project
conversations project update <id> --status archived

# Delete a project (fails if spaces still reference it)
conversations project delete <id>
```

## Mark Read

```bash
# Mark specific messages
conversations mark-read 1 2 3 --agent codex

# Mark entire session
conversations mark-read --session abc123 --agent codex

# Mark entire space
conversations mark-read --space deployments --agent codex
```

## Status

```bash
conversations status
# Conversations Status
#   DB Path:    ~/.conversations/messages.db
#   Messages:   47
#   Sessions:   5
#   Spaces:     3
#   Projects:   2
#   Unread:     3
```

## Interactive TUI

```bash
conversations
```

Arrow keys to navigate sessions, Enter to open, `n` for new conversation, `q` to quit, Esc to go back.

## Web Dashboard

```bash
conversations dashboard                 # Start on default port 3456
conversations dashboard --port 8080     # Custom port
conversations dashboard --host 0.0.0.0  # Bind to all interfaces
```

## MCP Server

The MCP server exposes 16 tools for native AI agent integration via the Model Context Protocol over stdio.

### Agent Configuration

Add to your agent's MCP config (Claude Code, Codex, etc.):

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

| Tool | Category | Description |
|------|----------|-------------|
| `send_message` | DM | Send a direct message (sender auto-resolved from env) |
| `read_messages` | DM | Read messages with filters (session, agent, space, time, unread) |
| `list_sessions` | DM | List conversation sessions, optionally filtered by agent |
| `reply` | DM | Reply to a message by ID (auto-resolves session and recipient) |
| `mark_read` | DM | Mark message IDs as read for the current agent |
| `create_space` | Space | Create a new space (creator auto-joined, supports nesting and projects) |
| `list_spaces` | Space | List spaces with member/message counts, filter by project or parent |
| `send_to_space` | Space | Send a message to a space (all members can see it) |
| `read_space` | Space | Read messages from a space |
| `join_space` | Space | Join a space to receive messages |
| `leave_space` | Space | Leave a space |
| `create_project` | Project | Create a new project with metadata, tags, and settings |
| `list_projects` | Project | List all registered projects, optionally filter by status |
| `get_project` | Project | Get full project details by ID or name |
| `update_project` | Project | Update any project field |
| `delete_project` | Project | Delete a project (fails if spaces still reference it) |

## Programmatic API

```typescript
import {
  sendMessage,
  readMessages,
  markRead,
  markSessionRead,
  markSpaceRead,
  listSessions,
  createSpace,
  listSpaces,
  joinSpace,
  leaveSpace,
  createProject,
  listProjects,
  startPolling,
  resolveIdentity,
} from "@hasna/conversations";

// Send a direct message
const msg = sendMessage({
  from: "my-agent",
  to: "claude-code",
  content: "Hello!",
  priority: "high",
});

// Read unread messages
const messages = readMessages({ to: "my-agent", unread_only: true });

// Poll for new messages (200ms default interval)
const { stop } = startPolling({
  to_agent: "my-agent",
  on_messages: (msgs) => console.log("New:", msgs),
});

// Spaces
createSpace("deploys", "my-agent", { description: "Deploy notifications" });
joinSpace("deploys", "claude-code");
sendMessage({
  from: "my-agent",
  to: "deploys",
  content: "v2.0 shipped",
  space: "deploys",
  session_id: "space:deploys",
});
const channelMsgs = readMessages({ space: "deploys" });

// Projects
const project = createProject({
  name: "my-app",
  created_by: "my-agent",
  description: "Main application",
  tags: ["backend", "api"],
});

// Clean up
stop();
```

### React Hooks (for Ink TUI)

```typescript
import { useMessages, useSpaceMessages } from "@hasna/conversations";

// Poll session messages (200ms interval)
const messages = useMessages(sessionId, agent);

// Poll space messages (200ms interval)
const spaceMessages = useSpaceMessages("deployments");
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CONVERSATIONS_AGENT_ID` | Agent identity for MCP server and CLI `--from` fallback | `"user"` |
| `CONVERSATIONS_DB_PATH` | Override database file location | `~/.conversations/messages.db` |

## Architecture

```
┌──────────────────┐  ┌─────────────────────┐  ┌──────────────────────┐
│     Ink TUI      │  │    CLI (headless)    │  │     MCP Server       │
│ `conversations`  │  │ `conversations send` │  │ `conversations mcp`  │
└────────┬─────────┘  └──────────┬──────────┘  └──────────┬───────────┘
         │                       │                        │
         └───────────┬───────────┴────────────────────────┘
                     │
             ┌───────▼────────┐
             │  Core Library   │
             │  src/lib/*      │
             └───────┬────────┘
                     │
             ┌───────▼────────┐
             │   bun:sqlite    │
             │   WAL mode      │
             │   200ms polling  │
             └───────┬────────┘
                     │
             ~/.conversations/messages.db
```

- **SQLite WAL mode** for concurrent read/write across processes
- **200ms `setInterval` polling** on indexed `created_at`/`id` columns -- microsecond-fast queries
- **Single shared database** at `~/.conversations/messages.db`
- **Sessions derived from messages** -- no separate sessions table
- **Agent identity resolution**: explicit `--from` flag > `CONVERSATIONS_AGENT_ID` env var > `"user"` fallback

## CLI Commands

| Command | Description |
|---------|-------------|
| `conversations` | Launch interactive TUI |
| `conversations send` | Send a direct message |
| `conversations read` | Read messages with filters |
| `conversations reply` | Reply to a message by ID |
| `conversations sessions` | List conversation sessions |
| `conversations mark-read` | Mark messages as read |
| `conversations status` | Show database stats |
| `conversations update` | Check for and install updates |
| `conversations space create` | Create a new space |
| `conversations space list` | List all spaces |
| `conversations space send` | Send a message to a space |
| `conversations space read` | Read messages from a space |
| `conversations space join` | Join a space |
| `conversations space leave` | Leave a space |
| `conversations space members` | List space members |
| `conversations project create` | Create a new project |
| `conversations project list` | List all projects |
| `conversations project get` | Get project details |
| `conversations project update` | Update a project |
| `conversations project delete` | Delete a project |
| `conversations mcp` | Start MCP server on stdio |
| `conversations dashboard` | Start web dashboard |

All commands support `--json` for machine-readable output.

## Development

```bash
git clone https://github.com/hasna/conversations.git
cd conversations
bun install
bun run dev          # Run CLI in dev mode
bun test             # Run tests
bun run typecheck    # Type-check
bun run build        # Build everything
```

## License

[Apache-2.0](./LICENSE)
