# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install                       # Install dependencies
bun test                          # Run all 172 tests
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
src/db/        → SQLite data layer
                 database.ts   — schema, migrations, singleton, helpers
                 tasks.ts      — task CRUD, locking, dependencies
                 projects.ts   — project CRUD, prefix generation, counter
                 agents.ts     — agent registration (8-char UUID identity)
                 task-lists.ts — task list containers
                 plans.ts      — plan CRUD
                 comments.ts   — task comments
                 sessions.ts   — agent session tracking
src/lib/       → Business logic
                 search.ts     — full-text search across task fields
                 sync.ts       — bidirectional sync with agent task lists
                 config.ts     — config loading (~/.todos/config.json)
                 claude-tasks.ts — Claude Code task list sync
                 agent-tasks.ts  — Other agent task list sync
src/cli/       → Commander.js CLI (index.tsx) + React/Ink TUI components (components/)
src/mcp/       → MCP server with stdio transport (index.ts) — 29 tools, 4 resources
src/index.ts   → Library re-exports for external consumers (@hasna/todos)
```

All three surfaces (CLI, MCP server, library) call directly into `src/db/` functions — there is no intermediate service layer. The database module uses a singleton pattern via `getDatabase()`.

### Build Outputs

Three separate `bun build` invocations produce independent entry points:
- `dist/cli/index.js` — CLI executable (`todos` bin)
- `dist/mcp/index.js` — MCP server executable (`todos-mcp` bin)
- `dist/index.js` — Library entry point with `dist/index.d.ts` types

## Data Model

### Core Entities

| Entity | Key Fields | Notes |
|--------|-----------|-------|
| **Task** | id, short_id, title, status, priority, project_id, task_list_id, plan_id, parent_id, agent_id, assigned_to, version | short_id auto-generated from project prefix (e.g., "APP-00001") |
| **Project** | id, name, path (UNIQUE), task_prefix, task_counter | Prefix auto-generated from name, counter increments per task |
| **TaskList** | id, project_id, slug, name | Slug unique per project. Containers/folders for tasks |
| **Agent** | id (8-char), name (UNIQUE) | Registered via `init` command. Idempotent by name |
| **Plan** | id, project_id, name, status | Execution groups (active/completed/archived) |
| **TaskComment** | id, task_id, content, agent_id | Notes on tasks |
| **Session** | id, agent_id, project_id, metadata | Agent session tracking |

### Relationships

- Task → Project (FK, ON DELETE SET NULL)
- Task → TaskList (FK, ON DELETE SET NULL)
- Task → Plan (FK, ON DELETE SET NULL)
- Task → Task (parent_id, ON DELETE CASCADE — subtasks deleted with parent)
- TaskList → Project (FK, ON DELETE SET NULL)
- Plan → Project (FK, ON DELETE CASCADE)
- TaskDependency: task_id depends_on task_id (no self-deps, cycle detection via BFS)

## Key Patterns

- **Task short IDs**: When a task is created with a `project_id`, the project's `task_prefix` and `task_counter` generate a short_id (e.g., "APP-00001") that's prepended to the title. Projects without a prefix (created before migration 6) get one auto-assigned via `ensureProject()`.
- **Agent registration**: `registerAgent()` is idempotent — same name returns existing agent with updated `last_seen_at`. IDs are 8 characters from `crypto.randomUUID().slice(0, 8)`.
- **Optimistic locking**: Every task has a `version` integer. Updates require passing the current version; the UPDATE query includes `WHERE version = ?` and increments atomically. Mismatch throws `VersionConflictError`.
- **Exclusive task locking**: Tasks can be locked by an agent (`locked_by`/`locked_at`). Locks auto-expire after 30 minutes. Re-locking by the same agent is idempotent. Expired locks can be taken over by any agent.
- **Partial IDs**: All surfaces accept first 8+ characters of UUIDs via `resolvePartialId()` which does a `LIKE` prefix match and requires a unique result.
- **JSON fields**: `tags` (string array) and `metadata` (object) are stored as JSON strings in SQLite, serialized on write and parsed on read via `rowToTask()`.
- **Dependency cycle detection**: Uses BFS traversal before inserting a dependency to prevent circular task graphs.
- **Auto-project detection**: CLI detects git root directory and auto-creates/associates a project unless `TODOS_AUTO_PROJECT=false`.
- **Cascade behavior**: Subtask deletion cascades (`ON DELETE CASCADE` via `parent_id`), but project deletion orphans tasks (`ON DELETE SET NULL`).

## Database

bun:sqlite with WAL mode, foreign keys enabled, 5-second busy timeout.

**Schema migrations** (6 total) are version-tracked in a `_migrations` table with forward-only upgrades applied in `getDatabase()`. Migration 5+ uses `ensureTableMigrations()` for backward compatibility with databases that had old SaaS migration IDs.

**Location priority**: `TODOS_DB_PATH` env var → `.todos/todos.db` in cwd → `~/.todos/todos.db` global.

**Core tables**: `projects`, `tasks`, `task_lists`, `agents`, `plans`, `task_dependencies`, `task_comments`, `task_tags`, `sessions`.

## Testing

172 tests across 11 files. Tests use `TODOS_DB_PATH=:memory:` with `resetDatabase()` + `getDatabase()` in `beforeEach` and `closeDatabase()` in `afterEach` for full isolation. CLI integration tests spawn subprocesses with temp DB files created via `mkdtemp`.

Test files: `tasks.test.ts` (49), `projects.test.ts` (17), `agents.test.ts` (12), `task-lists.test.ts` (16), `plans.test.ts` (16), `comments.test.ts` (12), `sessions.test.ts` (13), `database.test.ts` (14), `search.test.ts` (9), `mcp.test.ts` (11), `cli.test.ts` (4).

## MCP Tools (29)

Tasks: `create_task`, `list_tasks`, `get_task`, `update_task`, `delete_task`, `start_task`, `complete_task`, `lock_task`, `unlock_task`
Dependencies: `add_dependency`, `remove_dependency`
Comments: `add_comment`
Projects: `create_project`, `list_projects`
Plans: `create_plan`, `list_plans`, `get_plan`, `update_plan`, `delete_plan`
Agents: `register_agent`, `list_agents`, `get_agent`
Task Lists: `create_task_list`, `list_task_lists`, `get_task_list`, `update_task_list`, `delete_task_list`
Search: `search_tasks`
Sync: `sync`

Resources: `todos://tasks`, `todos://projects`, `todos://agents`, `todos://task-lists`

## Validation

- **MCP layer**: Zod schemas validate all incoming tool parameters at runtime, with `.describe()` strings generating MCP parameter descriptions
- **Database layer**: SQL CHECK constraints enforce status/priority enums and prevent self-referential dependencies
- **CLI**: Commander.js handles argument parsing; no explicit Zod validation

## Error Classes

Custom errors in `src/types/`: `VersionConflictError`, `TaskNotFoundError`, `ProjectNotFoundError`, `PlanNotFoundError`, `LockError`, `DependencyCycleError`, `AgentNotFoundError`, `TaskListNotFoundError`. All three surfaces catch and format these consistently.

## TypeScript

Strict mode with `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`. JSX uses `react-jsx` transform for Ink components.
