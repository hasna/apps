# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Credential & transport resolution (adoption 2026-09-04, hasna/apps#1720)

Every data surface — CLI, MCP server, `conversations-hook`, and the library
`getStore()` — routes through `src/lib/store/index.ts`, which resolves the
credential and the service authority through the ONE shared seam in
`@hasna/contracts/client` (and `/client/storage`), fresh on every call. There
is NO vendored resolver copy in this app: `src/lib/contracts-client/` was
deleted. `src/lib/contracts-env.ts` holds the app-specific preamble — the
explicit local opt-in (`HASNA_CONVERSATIONS_DB_PATH` /
`CONVERSATIONS_DB_PATH`), the declared-but-blank normalisation that keeps the
Keychain tier's ambient gate alive across a copy (#1788), and the once-per-
process `LOCAL mode` stderr notice.

Fail-closed rules that hold here: hosted with no resolvable credential →
non-zero exit, no SQLite opened, no `*-local-fallback` event; local is ONLY the
explicit DB_PATH opt-in and never a default; the resolver's failures are
wrapped as `ConversationsStoreConfigError` so the CLI's error surface (and the
`--json` error contract) stays one shape. The legacy `~/.hasna/fleet-env/`,
`~/.hasna/cloud/`, `~/.config/hasna/` locations and `*_MODE` /
`*_STORAGE_MODE` variables are inputs nowhere. Never re-introduce an app-owned
credential read: route through the store.

## Build & Development Commands

```bash
bun install                       # Install dependencies
bun test                          # Run all tests (bun:test)
bun test src/lib/messages.test.ts # Run a single test file
bun run typecheck                 # TypeScript type checking (tsc --noEmit)
bun run build                     # Build all three entry points to dist/ and bin/
bun run dev                       # Run CLI in dev mode (bun run ./src/cli/index.tsx)
```

The build produces three separate bundles via `bun build`:
- `bin/index.js` -- CLI binary (`conversations`), externals: ink, react, chalk
- `bin/mcp.js` -- MCP server binary (`conversations-mcp`)
- `dist/index.js` -- Library entry point for programmatic use + `dist/index.d.ts` types

## Architecture

Three entry points share one core library and one SQLite database:

```
src/
  types.ts            -- TypeScript types: Message, Session, Channel, Project, Priority, etc.
  index.ts            -- Library re-exports for @hasna/conversations consumers

  lib/
    db.ts             -- Singleton SQLite connection, WAL mode, schema creation, auto-migration
    messages.ts       -- sendMessage, readMessages, markRead, markSessionRead, markChannelRead, getMessageById
    sessions.ts       -- Sessions derived from messages via GROUP BY (no sessions table)
    channels.ts       -- Flat channel CRUD + membership
    projects.ts       -- Project CRUD with metadata, tags, status, settings, repository
    poll.ts           -- startPolling() (plain JS) and useMessages()/useChannelMessages() (React hooks)
    identity.ts       -- Agent identity: explicit flag -> CONVERSATIONS_AGENT_ID env -> "user" fallback

  cli/
    index.tsx         -- Commander.js CLI with subcommands (send, read, reply, channel, project, etc.)
                         Default action (no subcommand) renders Ink TUI.
                         The `mcp` subcommand does a dynamic import to avoid loading MCP deps for other commands.
    components/
      App.tsx          -- Top-level TUI router: SessionList <-> ChatView <-> new conversation prompt
      SessionList.tsx  -- Lists sessions with unread counts, polls every 1s
      ChatView.tsx     -- Displays messages in a session, polls every 200ms
      MessageBubble.tsx -- Single message display component

  mcp/
    index.ts          -- MCP server with DM, channel, project, task, storage, and coordination tools on stdio transport.
                         Exports startMcpServer() for the CLI's dynamic import.
                         Also runs directly when invoked as conversations-mcp.

  server/
    serve.ts          -- Local HTTP server: JSON API routes for messages, sessions, channels, projects
    serve.test.ts     -- Tests for local HTTP API routes
```

All surfaces (CLI, MCP server, library, local HTTP server) call directly into `src/lib/` functions -- there is no intermediate service layer. The database module uses a singleton pattern via `getDb()`.

## Key Design Decisions

### DMs vs Channels

DMs use `to_agent` for direct addressing; the `channel` field is null. Channels set the `channel` field and use `session_id: "channel:{name}"`. The TUI's SessionList filters out channel sessions to avoid duplicates since channels appear as their own items.

### Session IDs

Auto-generated as `${[from, to].sort().join("-")}-${randomUUID().slice(0,8)}` for DMs. For channels, always `channel:{name}`. Sessions are derived from messages -- there is no sessions table; `listSessions()` uses `GROUP BY session_id` on the messages table.

### Channel Model

Channels are flat and Slack-like. There is no runtime hierarchy and no public spaces/sub-spaces API surface. Older spaces/sub-spaces are imported once as flat channels; parent context is preserved in channel `metadata.import_source`, tags, and descriptions.

### Projects

Channels can optionally belong to a project via `project_id`. Projects have rich attributes: metadata (JSON), tags (JSON array), status (active/archived), repository URL, and settings (JSON). Projects cannot be deleted while channels reference them (enforced in `deleteProject()`).

### Polling

200ms `setInterval` polling on indexed `created_at` and `id` columns. This is intentional -- SQLite does not support LISTEN/NOTIFY, and the query is microsecond-fast on the indexed columns. The `startPolling()` function seeds `lastSeenId` from the latest message, then polls for `id > lastSeenId` to avoid duplicates.

### Agent Identity Resolution

Priority chain: explicit `--from` flag or function argument > `CONVERSATIONS_AGENT_ID` environment variable > `"user"` fallback. The MCP server uses `resolveIdentity()` (with fallback) while `requireIdentity()` throws if no identity is set.

### JSON Fields

`metadata` on messages and projects, `tags` and `settings` on projects are stored as JSON strings in SQLite. They are serialized with `JSON.stringify()` on write and parsed with `JSON.parse()` on read in the respective `parse*()` helper functions.

## Database

bun:sqlite with WAL mode, foreign keys enabled via schema references, 5-second busy timeout.

**Location priority**: `CONVERSATIONS_DB_PATH` env var > `~/.hasna/conversations/messages.db` global default. The `getDb()` function auto-creates the directory and database file.

**Schema auto-migration**: The `getDb()` function detects old spaces/sub-spaces tables and columns, deterministically imports them to flat channels, rewrites channel session ids to `channel:*`, preserves legacy parent context in channel metadata/tags, and removes legacy space storage.

### Tables

**messages** -- id (autoincrement PK), uuid, session_id, from_agent, to_agent, channel (nullable), project_id, content, priority (default 'normal'), working_dir, repository, branch, metadata (JSON), attachments, reply_to, created_at, read_at

**channels** -- name (text PK), description, topic, project_id (FK to projects.id), created_by, created_at, archived_at, metadata (JSON), tags (JSON)

**channel_members** -- channel + agent (composite PK), joined_at

**channel_subscriptions** -- channel + agent (composite PK), created_at, preview_chars, since_message_id

**projects** -- id (UUID text PK), name (unique), description, path, created_by, created_at, metadata (JSON), tags (JSON), status (default 'active'), repository, settings (JSON)

### Indexes

- `idx_messages_session` on messages(session_id)
- `idx_messages_to` on messages(to_agent)
- `idx_messages_created` on messages(created_at)
- `idx_messages_channel` on messages(channel)
- `idx_projects_name` on projects(name)
- `idx_projects_status` on projects(status)
- `idx_channels_project` on channels(project_id)

## MCP Tools

### DM Tools (5)
| Tool | Description |
|------|-------------|
| `send_message` | Send a direct message (sender from CONVERSATIONS_AGENT_ID) |
| `read_messages` | Read messages with filters: session_id, from, to, channel, since, limit, unread_only |
| `list_sessions` | List sessions, optionally filtered by agent |
| `reply` | Reply to message ID (auto-resolves session and recipient) |
| `mark_read` | Mark message IDs as read |

### Channel Tools
| Tool | Description |
|------|-------------|
| `create_channel` | Create channel and auto-join creator |
| `list_channels` | List channels with member/message counts |
| `send_to_channel` | Send message to channel |
| `read_channel` | Read channel messages |
| `join_channel` | Join a channel |
| `leave_channel` | Leave a channel |
| `subscribe_channel_notifications` | Subscribe to preview-only channel notifications |
| `summarize_channel` | Structured channel catch-up summary |

### Project Tools (5)
| Tool | Description |
|------|-------------|
| `create_project` | Create project with name, description, path, repository, tags, metadata, settings |
| `list_projects` | List projects, optionally filter by status (active/archived) |
| `get_project` | Get project by ID or name |
| `update_project` | Update any project field |
| `delete_project` | Delete project (fails if channels reference it) |

### Storage Sync Tools (6)
| Tool | Description |
|------|-------------|
| `conversations_storage_status` | Show remote storage config, PG connection health, and unresolved conflict count |
| `conversations_storage_push` | Push local → remote PostgreSQL storage. Skips int-PK tables (messages, reactions, etc.) to avoid ID collision |
| `conversations_storage_pull` | Pull remote storage → local with UPSERT merge. Skips int-PK tables |
| `conversations_storage_sync` | Bidirectional sync — pull then push in one call |
| `conversations_storage_migrate` | Run `src/lib/pg-migrations.ts` DDL against the configured RDS instance. Supports `--dry_run` |
| `conversations_storage_feedback` | Send feedback for the conversations service |

**Tables excluded from default sync** (integer AUTOINCREMENT PKs collide across machines): `messages`, `reactions`, `message_read_receipts`, `message_mentions`, channel notification reads, and task detail tables. Pass explicit `tables` param only when you have a deliberate merge plan.

## Testing

Tests live alongside source files in `src/lib/` and `src/server/` with the `.test.ts` suffix. Run with `bun test`.

Test files:
- `src/lib/db.test.ts` -- Database initialization, WAL mode, table creation
- `src/lib/messages.test.ts` -- Send, read, filter, mark read, metadata handling
- `src/lib/sessions.test.ts` -- Session derivation, agent filtering, unread counts
- `src/lib/channels.test.ts` -- Channel CRUD and membership
- `src/lib/projects.test.ts` -- Project CRUD, cascade protection, JSON field handling
- `src/lib/poll.test.ts` -- Polling start/stop, new message detection
- `src/lib/identity.test.ts` -- Identity resolution priority chain
- `src/server/serve.test.ts` -- Dashboard API route responses

Tests use `CONVERSATIONS_DB_PATH=:memory:` for in-memory databases. Each test file manages its own database lifecycle via `getDb()` and `closeDb()`.

## Publishing

```bash
bun run build                          # prepublishOnly runs this automatically
npm publish --access public            # Publish to npm
```

Package is `@hasna/conversations` on npm. Binaries: `conversations` and `conversations-mcp`.

## TypeScript

Strict mode with `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`. JSX uses `react-jsx` transform for Ink components. Types: `bun-types` and `react`.
