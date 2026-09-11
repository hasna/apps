# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Credential & transport resolution (adoption 2026-09-04, hasna/apps#1720; API-only clients 2026-09-11)

Every data surface — CLI, MCP server, `conversations-hook`, and the library
`getStore()` — routes through `src/lib/store/index.ts`, which resolves the
credential and the service authority through the ONE shared seam in
`@hasna/contracts/client` (and `/client/storage`), fresh on every call. There
is NO vendored resolver copy in this app: `src/lib/contracts-client/` was
deleted. `src/lib/contracts-env.ts` holds the app-specific preamble — the
rejection of the retired local selectors (`HASNA_CONVERSATIONS_DB_PATH` /
`CONVERSATIONS_DB_PATH` make `getStore()` throw `ConversationsStoreConfigError`;
they never select anything) and the declared-but-blank normalisation that keeps
the Keychain tier's ambient gate alive across a copy (#1788).

Fail-closed rules that hold here: no resolvable credential → non-zero exit, no
database opened, no `*-local-fallback` event, no hint that a local mode exists;
the resolver's failures are wrapped as `ConversationsStoreConfigError` so the
CLI's error surface (and the `--json` error contract) stays one shape. The
legacy `~/.hasna/fleet-env/`, `~/.hasna/cloud/`, `~/.config/hasna/` locations
and `*_MODE` / `*_STORAGE_MODE` variables are inputs nowhere. Never re-introduce
an app-owned credential read or a local store: route through the store.
`src/client-bundles-sqlite-free.test.ts` fails the build if `bun:sqlite` or
`LocalStore` reappears in any client bundle.

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

Three entry points share one core library. Every client surface (CLI, MCP server, hook, library) is API-only: the store is resolved per call through the `@hasna/contracts` client seam to the hosted authority `https://api.hasna.com/conversations` (`/v1`), authenticated with the station credential (macOS Keychain `hasna.credentials.conversations.api-key`, then `~/.hasna/conversations/config/credentials`, then `HASNA_CONVERSATIONS_API_KEY`). There is no local database: `HASNA_CONVERSATIONS_DB_PATH` / `CONVERSATIONS_DB_PATH` are rejected, nothing falls back to SQLite, and a missing or unreadable credential fails closed. Only `conversations-serve` touches a database (PostgreSQL, `HASNA_CONVERSATIONS_DATABASE_URL`).

```
src/
  types.ts            -- TypeScript types: Message, Session, Channel, Project, Priority, etc.
  index.ts            -- Library re-exports for @hasna/conversations consumers

  lib/
    home.ts           -- The station app home `~/.hasna/conversations` (`HASNA_CONVERSATIONS_HOME` / `HASNA_HOME` overrides only); holds identity + session bindings, never data
    db.ts             -- LEGACY, test-only: SQLite helpers kept for the unit tests of the old domain libraries; not reachable from any shipped bin or public export (`src/client-bundles-sqlite-free.test.ts` enforces this)
    messages.ts       -- sendMessage, readMessages, markRead, markSessionRead, markChannelRead, getMessageById
    sessions.ts       -- Sessions derived from messages via GROUP BY (no sessions table)
    channels.ts       -- Flat channel CRUD + membership
    projects.ts       -- Project CRUD with metadata, tags, status, settings, repository
    poll.ts           -- startPolling() (plain JS) and useMessages()/useChannelMessages() (React hooks)
    identity.ts       -- Agent identity: explicit `--from` -> `HASNA_CONVERSATIONS_AGENT_ID` -> session binding under the app home; no silent fallback (IdentityError)

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

`watch` and the TUI poll the hosted API (`startPolling()` seeds `lastSeenId` from the latest message, then asks for `id > lastSeenId`). The default interval is a client-side setting; a server-side long-poll/SSE route is the planned replacement (fleet alignment PR-G).

### Agent Identity Resolution

Priority chain: explicit `--from` flag or function argument > `HASNA_CONVERSATIONS_AGENT_ID` (legacy alias `CONVERSATIONS_AGENT_ID`) > the session binding file under the app home. There is no `"user"` fallback: `resolveIdentity()` throws `IdentityError` when nothing names the agent.

### JSON Fields

`metadata` on messages and projects, `tags` and `settings` on projects are JSON values on the wire; the hosted API (PostgreSQL) owns their persistence. Clients never serialise them into a local store.

## Storage

Clients hold no data. `conversations-serve` is the only process with a database: PostgreSQL via `HASNA_CONVERSATIONS_DATABASE_URL` (owner DSN `HASNA_CONVERSATIONS_DATABASE_URL_OWNER` for the one-shot `src/server/migrate.ts`), schema in `src/lib/pg-migrations.ts`. Migration 15 plus an explicit `conversations-serve corpus adopt` are required before `/ready` passes on a fresh corpus (see `docs/corpus-ownership.md`).

The station app home `~/.hasna/conversations` (`src/lib/home.ts`) holds only identity and session bindings. Tests never touch the real home: `bunfig.toml` preloads `src/test/preload.ts`, which pins `HOME`/`HASNA_HOME` to a throw-away directory for the whole run, and spawned CLIs inherit it through `hermeticHomeEnv()` / `hermeticSpawnEnv()`.

## MCP Tools

### DM Tools (5)
| Tool | Description |
|------|-------------|
| `send_message` | Send a direct message (sender from the resolved identity: `--from`, `HASNA_CONVERSATIONS_AGENT_ID`, or the session binding) |
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
- `src/client-bundles-sqlite-free.test.ts` -- No client bundle contains `bun:sqlite` / `LocalStore`
- `src/contract.test.ts` -- `hasna.contract.json` matches the shipped bins and the API-key auth mode

The whole run executes against a throw-away HOME (`bunfig.toml` → `src/test/preload.ts`); spawned CLIs inherit it via `hermeticHomeEnv()`. Hosted-path tests use the loopback API fixture (`src/lib/store/test-support/`); the legacy SQLite domain-library tests construct the test-only `LocalStore` (`src/lib/store/local-store.ts`) against a disposable database path and never the station home.

## Publishing

```bash
bun run build                          # prepublishOnly runs this automatically
npm publish --access public            # Publish to npm
```

Package is `@hasna/conversations` on npm (member of the `hasna/apps` monorepo). Binaries, all declared in `hasna.contract.json`: `conversations` (CLI), `conversations-mcp` (MCP server), `conversations-serve` (HTTP API server), `conversations-hook` (Claude Code PreToolUse blocker hook), `conversations-inbox` (station inbox monitor). Do not register the MCP server in a coding agent on a Hasna station — the native CLI is the supported surface.

## TypeScript

Strict mode with `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`. JSX uses `react-jsx` transform for Ink components. Types: `bun-types` and `react`.
