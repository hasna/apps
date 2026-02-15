# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
bun run build        # Build CLI (bin/), MCP (bin/), library (dist/), and .d.ts files
bun run dev          # Run CLI directly from source: bun run ./src/cli/index.tsx
bun run typecheck    # Type-check without emitting: tsc --noEmit
bun test             # Run tests with Bun
```

The build produces three separate bundles:
- `bin/index.js` — CLI binary (externals: ink, react, chalk)
- `bin/mcp.js` — MCP server binary
- `dist/index.js` — Library for programmatic use + TypeScript declarations

## Architecture

Three entry points share one core library and one SQLite database:

```
src/cli/index.tsx  ──┐
src/mcp/index.ts  ───┼──→  src/lib/*  ──→  ~/.conversations/messages.db
src/index.ts      ──┘
```

**`src/lib/`** — All business logic. Every data operation lives here.
- `db.ts` — Singleton SQLite connection, WAL mode, schema creation, auto-migration
- `messages.ts` — sendMessage, readMessages, markRead, markSessionRead, markChannelRead
- `sessions.ts` — Sessions derived from messages via GROUP BY (no sessions table)
- `channels.ts` — Channel CRUD + membership (channels and channel_members tables)
- `poll.ts` — `startPolling()` (plain JS) and `useMessages()`/`useChannelMessages()` (React hooks)
- `identity.ts` — Agent identity: explicit flag → `CONVERSATIONS_AGENT_ID` env → `"user"` fallback

**`src/cli/index.tsx`** — Commander CLI with subcommands + default action renders Ink TUI. The `mcp` subcommand does a dynamic import of `src/mcp/index.ts` to avoid loading MCP deps for other commands.

**`src/mcp/index.ts`** — MCP server with 11 tools (5 DM + 6 channel) on stdio transport. Exports `startMcpServer()` for the CLI's dynamic import, and also runs directly when invoked as `conversations-mcp`.

**`src/cli/components/`** — Ink 5 + React 18 TUI. App.tsx routes between SessionList (polls every 1s), ChatView (polls messages every 200ms), and a "new conversation" prompt.

## Key Design Decisions

**DMs vs Channels**: DMs use `to_agent` for direct addressing, `channel` field is null. Channels set the `channel` field and use `session_id: "channel:{name}"`. The SessionList filters out `channel:*` sessions to avoid duplicates since channels appear as their own items.

**Session IDs**: Auto-generated as `${[from, to].sort().join("-")}-${uuid8}` for DMs. For channels, always `channel:{name}`. Sessions are derived from messages — there is no sessions table.

**Polling, not subscriptions**: 200ms `setInterval` polling on indexed `created_at` column. This is intentional — SQLite doesn't support LISTEN/NOTIFY, and the query is microsecond-fast on the indexed column.

**Database**: Single file at `~/.conversations/messages.db`. WAL mode for concurrent cross-process reads/writes. `busy_timeout = 5000` for lock contention. The `getDb()` function auto-creates the directory, database, tables, indexes, and runs migrations (e.g., adding `channel` column to existing DBs).

## Publishing

```bash
npm publish --access public   # prepublishOnly runs build automatically
npm access set status=public @hasna/conversations   # ensure public visibility
```

Package is `@hasna/conversations` on npm. Binaries: `conversations` and `conversations-mcp`.
