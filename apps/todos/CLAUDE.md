# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install                       # Install dependencies
bun test                          # Run all tests
bun test src/db/tasks.test.ts     # Run a single test file
bun run typecheck                 # TypeScript type checking (tsc --noEmit)
bun run build                     # Build all three entry points to dist/
bun run dev:cli                   # Run CLI in dev mode (bun run src/cli/index.tsx)
bun run dev:mcp                   # Run MCP server in dev mode
```

## Architecture

Universal task management system with three surfaces sharing a common SQLite database layer:

```
src/types/     → TypeScript types, enums, and custom error classes
src/db/        → SQLite data layer (database.ts, tasks.ts, projects.ts, comments.ts, sessions.ts)
src/lib/       → Business logic (search.ts - full-text search across task fields)
src/cli/       → Commander.js CLI (index.tsx) + React/Ink TUI components (components/)
src/mcp/       → MCP server with stdio transport (index.ts)
src/index.ts   → Library re-exports for external consumers (@hasna/todos)
```

All three surfaces (CLI, MCP server, library) call directly into `src/db/` functions — there is no intermediate service layer. The database module uses a singleton pattern via `getDatabase()`.

### Build Outputs

Three separate `bun build` invocations produce independent entry points:
- `dist/cli/index.js` — CLI executable (`todos` bin)
- `dist/mcp/index.js` — MCP server executable (`todos-mcp` bin)
- `dist/index.js` — Library entry point with `dist/index.d.ts` types

## Key Patterns

- **Optimistic locking**: Every task has a `version` integer. Updates require passing the current version; the UPDATE query includes `WHERE version = ?` and increments atomically. Mismatch throws `VersionConflictError`.
- **Exclusive task locking**: Tasks can be locked by an agent (`locked_by`/`locked_at`). Locks auto-expire after 30 minutes. Re-locking by the same agent is idempotent. Expired locks can be taken over by any agent.
- **Partial IDs**: All surfaces accept first 8+ characters of UUIDs via `resolvePartialId()` which does a `LIKE` prefix match and requires a unique result.
- **JSON fields**: `tags` (string array) and `metadata` (object) are stored as JSON strings in SQLite, serialized on write and parsed on read via `rowToTask()`.
- **Dependency cycle detection**: Uses BFS traversal before inserting a dependency to prevent circular task graphs.
- **Auto-project detection**: CLI detects git root directory and auto-creates/associates a project unless `TODOS_AUTO_PROJECT=false`.
- **Cascade behavior**: Subtask deletion cascades (`ON DELETE CASCADE` via `parent_id`), but project deletion orphans tasks (`ON DELETE SET NULL`).

## Database

bun:sqlite with WAL mode, foreign keys enabled, 5-second busy timeout.

**Schema migrations** are version-tracked in a `migrations` table with forward-only upgrades applied in `getDatabase()`.

**Location priority**: `TODOS_DB_PATH` env var → `.todos/todos.db` in cwd → `~/.todos/todos.db` global.

**Core tables**: `projects`, `tasks` (with self-referencing `parent_id` for subtasks), `task_dependencies`, `task_comments`, `sessions`.

## Testing

Tests use `TODOS_DB_PATH=:memory:` with `resetDatabase()` + `getDatabase()` in `beforeEach` and `closeDatabase()` in `afterEach` for full isolation. CLI integration tests spawn subprocesses with temp DB files created via `mkdtemp`.

## Validation

- **MCP layer**: Zod schemas validate all incoming tool parameters at runtime, with `.describe()` strings generating MCP parameter descriptions
- **Database layer**: SQL CHECK constraints enforce status/priority enums and prevent self-referential dependencies
- **CLI**: Commander.js handles argument parsing; no explicit Zod validation

## Error Classes

Custom errors in `src/types/`: `VersionConflictError`, `TaskNotFoundError`, `ProjectNotFoundError`, `LockError`, `DependencyCycleError`. All three surfaces catch and format these consistently.

## TypeScript

Strict mode with `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`. JSX uses `react-jsx` transform for Ink components.
