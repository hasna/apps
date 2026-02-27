# @hasna/todos

Universal task management for AI coding agents. CLI + MCP server + web dashboard + library, all sharing a single SQLite database.

## Features

- **CLI** with interactive TUI (React/Ink) and JSON output
- **MCP server** for Claude, Codex, Gemini, and any MCP-compatible agent
- **Library** for programmatic access from Node.js/Bun
- **SQLite** with WAL mode, optimistic locking, and automatic migrations
- Task dependencies with cycle detection
- Exclusive agent locking with auto-expiry
- Full-text search across tasks
- Project auto-detection from git repositories
- Subtask hierarchies with cascade deletion

## Installation

```bash
bun add -g @hasna/todos
```

## Quick Start

```bash
# Create a task
todos add "Fix login bug" --priority high --tags bug,auth

# List tasks
todos list

# Start working on a task
todos start <id>

# Mark complete
todos done <id>

# Launch interactive TUI
todos

# Register MCP server with AI agents
todos mcp --register all
```

## MCP Server

Register with your AI coding agents:

```bash
todos mcp --register claude    # Claude Code
todos mcp --register codex     # Codex CLI
todos mcp --register gemini    # Gemini CLI
todos mcp --register all       # All agents
```

Or start manually via stdio:

```bash
todos-mcp
```

## Sync (Optional)

Claude supports a native task list. Other agents use JSON task lists under `~/.todos/agents/<agent>/<task_list_id>/`.

```bash
todos sync --agent claude --task-list <id>
todos sync --agent codex --task-list default
todos sync --all --task-list <id>
todos sync --prefer local
```

Env overrides:
- `TODOS_SYNC_AGENTS` (comma-separated list for `--all`)
- `TODOS_TASK_LIST_ID` or `TODOS_<AGENT>_TASK_LIST`
- `TODOS_AGENT_TASKS_DIR` or `TODOS_<AGENT>_TASKS_DIR`

Config file: `~/.todos/config.json`

```json
{
  "sync_agents": ["claude", "codex", "gemini"],
  "task_list_id": "default",
  "agent_tasks_dir": "/Users/you/.todos/agents",
  "agents": {
    "claude": { "task_list_id": "session-or-project-id" },
    "codex": { "task_list_id": "default", "tasks_dir": "/Users/you/.todos/agents" }
  }
}
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `todos add <title>` | Create a task |
| `todos list` | List tasks (active by default) |
| `todos show <id>` | Show full task details |
| `todos update <id>` | Update task fields |
| `todos start <id>` | Claim and start a task |
| `todos done <id>` | Mark task completed |
| `todos delete <id>` | Delete a task |
| `todos plan <title>` | Create a plan with subtasks |
| `todos comment <id> <text>` | Add a comment |
| `todos search <query>` | Search tasks |
| `todos deps <id>` | Manage dependencies |
| `todos projects` | List/manage projects |
| `todos export` | Export tasks (JSON or Markdown) |
| `todos mcp` | Start MCP server |

Use `--json` for JSON output on any command. Use `--agent <name>` to identify the calling agent.

## Library Usage

```typescript
import { createTask, listTasks, completeTask } from "@hasna/todos";

const task = createTask({ title: "My task", priority: "high" });
const tasks = listTasks({ status: "pending" });
completeTask(task.id);
```

## Database

SQLite database with automatic location detection:

1. `TODOS_DB_PATH` environment variable (`:memory:` for testing)
2. Nearest `.todos/todos.db` in current directory or any parent
3. `~/.todos/todos.db` global fallback

Set `TODOS_DB_SCOPE=project` to force project-level DB at the git root (if found).

## Development

```bash
git clone https://github.com/hasna/todos.git
cd todos
bun install
bun test                    # Run 112 tests
bun run typecheck           # TypeScript checking
bun run dev:cli             # Run CLI in dev mode
```

## Architecture

```
src/
  types/     TypeScript types, enums, custom errors
  db/        SQLite data layer (tasks, projects, comments, sessions)
  lib/       Business logic (search, sync)
  cli/       Commander.js CLI + React/Ink TUI
  mcp/       MCP server (stdio transport)
  index.ts   Library re-exports
```

All surfaces (CLI, MCP, library) call directly into `src/db/` — no intermediate service layer.

## License

[Apache License 2.0](LICENSE)
