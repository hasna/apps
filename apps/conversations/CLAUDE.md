# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
  types.ts            -- TypeScript types: Message, Session, Space, Project, Priority, etc.
  index.ts            -- Library re-exports for @hasna/conversations consumers

  lib/
    db.ts             -- Singleton SQLite connection, WAL mode, schema creation, auto-migration
    messages.ts       -- sendMessage, readMessages, markRead, markSessionRead, markSpaceRead, getMessageById
    sessions.ts       -- Sessions derived from messages via GROUP BY (no sessions table)
    spaces.ts         -- Space CRUD + membership + hierarchy (max 3 levels deep)
    projects.ts       -- Project CRUD with metadata, tags, status, settings, repository
    poll.ts           -- startPolling() (plain JS) and useMessages()/useSpaceMessages() (React hooks)
    identity.ts       -- Agent identity: explicit flag -> CONVERSATIONS_AGENT_ID env -> "user" fallback

  cli/
    index.tsx         -- Commander.js CLI with subcommands (send, read, reply, space, project, etc.)
                         Default action (no subcommand) renders Ink TUI.
                         The `mcp` subcommand does a dynamic import to avoid loading MCP deps for other commands.
    components/
      App.tsx          -- Top-level TUI router: SessionList <-> ChatView <-> new conversation prompt
      SessionList.tsx  -- Lists sessions with unread counts, polls every 1s
      ChatView.tsx     -- Displays messages in a session, polls every 200ms
      MessageBubble.tsx -- Single message display component

  mcp/
    index.ts          -- MCP server with 16 tools (5 DM + 6 space + 5 project) on stdio transport.
                         Exports startMcpServer() for the CLI's dynamic import.
                         Also runs directly when invoked as conversations-mcp.

  server/
    serve.ts          -- Dashboard HTTP server: serves static files + JSON API routes for messages, sessions, spaces, projects
    serve.test.ts     -- Tests for dashboard API routes
```

All surfaces (CLI, MCP server, library, dashboard) call directly into `src/lib/` functions -- there is no intermediate service layer. The database module uses a singleton pattern via `getDb()`.

## Key Design Decisions

### DMs vs Spaces

DMs use `to_agent` for direct addressing; the `space` field is null. Spaces set the `space` field and use `session_id: "space:{name}"`. The TUI's SessionList filters out `space:*` sessions to avoid duplicates since spaces appear as their own items.

### Session IDs

Auto-generated as `${[from, to].sort().join("-")}-${randomUUID().slice(0,8)}` for DMs. For spaces, always `space:{name}`. Sessions are derived from messages -- there is no sessions table; `listSessions()` uses `GROUP BY session_id` on the messages table.

### Space Hierarchy

Spaces can have a `parent_id` referencing another space. Max depth is 3 levels (0, 1, 2), enforced in `createSpace()` via `getSpaceDepth()` which walks the parent chain. Messages are isolated per space -- sub-spaces do not inherit parent messages.

### Projects

Spaces can optionally belong to a project via `project_id`. Projects have rich attributes: metadata (JSON), tags (JSON array), status (active/archived), repository URL, and settings (JSON). Projects cannot be deleted while spaces reference them (enforced in `deleteProject()`).

### Polling

200ms `setInterval` polling on indexed `created_at` and `id` columns. This is intentional -- SQLite does not support LISTEN/NOTIFY, and the query is microsecond-fast on the indexed columns. The `startPolling()` function seeds `lastSeenId` from the latest message, then polls for `id > lastSeenId` to avoid duplicates.

### Agent Identity Resolution

Priority chain: explicit `--from` flag or function argument > `CONVERSATIONS_AGENT_ID` environment variable > `"user"` fallback. The MCP server uses `resolveIdentity()` (with fallback) while `requireIdentity()` throws if no identity is set.

### JSON Fields

`metadata` on messages and projects, `tags` and `settings` on projects are stored as JSON strings in SQLite. They are serialized with `JSON.stringify()` on write and parsed with `JSON.parse()` on read in the respective `parse*()` helper functions.

## Database

bun:sqlite with WAL mode, foreign keys enabled via schema references, 5-second busy timeout.

**Location priority**: `CONVERSATIONS_DB_PATH` env var > `~/.conversations/messages.db` global default. The `getDb()` function auto-creates the directory and database file.

**Schema auto-migration**: The `getDb()` function detects old `channels`/`channel_members` tables and migrates them to `spaces`/`space_members`. It also migrates the `messages.channel` column to `messages.space` and rewrites `session_id` values from `channel:*` to `space:*`.

### Tables

**messages** -- id (autoincrement PK), session_id, from_agent, to_agent, space (nullable), content, priority (default 'normal'), working_dir, repository, branch, metadata (JSON), created_at, read_at

**spaces** -- name (text PK), description, parent_id (FK to spaces.name), project_id (FK to projects.id), created_by, created_at

**space_members** -- space + agent (composite PK), joined_at

**projects** -- id (UUID text PK), name (unique), description, path, created_by, created_at, metadata (JSON), tags (JSON), status (default 'active'), repository, settings (JSON)

### Indexes

- `idx_messages_session` on messages(session_id)
- `idx_messages_to` on messages(to_agent)
- `idx_messages_created` on messages(created_at)
- `idx_messages_space` on messages(space)
- `idx_projects_name` on projects(name)
- `idx_projects_status` on projects(status)
- `idx_spaces_parent` on spaces(parent_id)
- `idx_spaces_project` on spaces(project_id)

## MCP Tools (22 total)

### DM Tools (5)
| Tool | Description |
|------|-------------|
| `send_message` | Send a direct message (sender from CONVERSATIONS_AGENT_ID) |
| `read_messages` | Read messages with filters: session_id, from, to, space, since, limit, unread_only |
| `list_sessions` | List sessions, optionally filtered by agent |
| `reply` | Reply to message ID (auto-resolves session and recipient) |
| `mark_read` | Mark message IDs as read |

### Space Tools (6)
| Tool | Description |
|------|-------------|
| `create_space` | Create space (auto-joins creator, supports parent_id and project_id) |
| `list_spaces` | List spaces with member/message counts, filter by project or parent |
| `send_to_space` | Send message to space |
| `read_space` | Read space messages |
| `join_space` | Join a space |
| `leave_space` | Leave a space |

### Project Tools (5)
| Tool | Description |
|------|-------------|
| `create_project` | Create project with name, description, path, repository, tags, metadata, settings |
| `list_projects` | List projects, optionally filter by status (active/archived) |
| `get_project` | Get project by ID or name |
| `update_project` | Update any project field |
| `delete_project` | Delete project (fails if spaces reference it) |

### Storage Sync Tools (6)
| Tool | Description |
|------|-------------|
| `conversations_storage_status` | Show remote storage config, PG connection health, and unresolved conflict count |
| `conversations_storage_push` | Push local → remote PostgreSQL storage. Skips int-PK tables (messages, reactions, etc.) to avoid ID collision |
| `conversations_storage_pull` | Pull remote storage → local with UPSERT merge. Skips int-PK tables |
| `conversations_storage_sync` | Bidirectional sync — pull then push in one call |
| `conversations_storage_migrate` | Run `src/lib/pg-migrations.ts` DDL against the configured RDS instance. Supports `--dry_run` |
| `conversations_storage_feedback` | Send feedback for the conversations service |

**Tables excluded from default sync** (integer AUTOINCREMENT PKs collide across machines): `messages`, `reactions`, `message_read_receipts`, `message_mentions`. Pass explicit `tables` param to sync these.

## Testing

Tests live alongside source files in `src/lib/` and `src/server/` with the `.test.ts` suffix. Run with `bun test`.

Test files:
- `src/lib/db.test.ts` -- Database initialization, WAL mode, table creation
- `src/lib/messages.test.ts` -- Send, read, filter, mark read, metadata handling
- `src/lib/sessions.test.ts` -- Session derivation, agent filtering, unread counts
- `src/lib/spaces.test.ts` -- Space CRUD, membership, hierarchy depth enforcement
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
