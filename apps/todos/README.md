# @hasna/todos

Universal task management for AI coding agents. CLI + MCP server + library, all sharing a single SQLite database.

## Features

- **CLI** with interactive TUI (React/Ink) and JSON output mode
- **MCP server** (29 tools) for Claude, Codex, Gemini, and any MCP-compatible agent
- **Library** for programmatic access from Node.js/Bun
- **Agent registration** with short UUID identity system
- **Task lists** for organizing tasks into named containers (backlog, sprint-1, bugs)
- **Task prefixes** with auto-incrementing short IDs per project (e.g., `APP-00001`)
- **Plans** as execution groups, separate from task list containers
- **SQLite** with WAL mode, optimistic locking, and automatic migrations
- Task dependencies with cycle detection
- Exclusive agent locking with 30-minute auto-expiry
- Full-text search across tasks
- Project auto-detection from git repositories
- Subtask hierarchies with cascade deletion
- Bidirectional sync with Claude Code, Codex, Gemini task lists

## Installation

```bash
bun add -g @hasna/todos
```

Or with npm:

```bash
npm install -g @hasna/todos
```

## Quick Start

```bash
# Register your agent (get a short UUID for identity)
todos init my-agent

# Create a task
todos add "Fix login bug" --priority high --tags bug,auth

# List active tasks
todos list

# Start working on a task (claims + locks it)
todos start <id>

# Mark complete
todos done <id>

# Create a task list
todos lists --add "sprint-1"

# Add task to a list
todos add "Build search" --list <list-id>

# Register MCP server with AI agents
todos mcp --register all

# Launch interactive TUI
todos
```

## Agent Registration

Agents register once to get a persistent 8-character UUID. This ID is used to track task ownership, locking, and activity.

```bash
# Register (idempotent — same name returns same ID)
todos init claude
# Agent registered:
#   ID:   56783129
#   Name: claude

# Use the ID on future commands
todos add "Fix bug" --agent 56783129

# List all registered agents
todos agents
```

Registration is idempotent: calling `init` with the same name returns the existing agent and updates `last_seen_at`.

## Task Lists

Task lists are named containers for organizing tasks (like folders). They're separate from plans.

```bash
# Create a task list
todos lists --add "backlog"
todos lists --add "sprint-1" --slug sprint-1 -d "Current sprint"

# List all task lists
todos lists

# Add tasks to a list
todos add "Build feature" --list <list-id>

# Filter tasks by list
todos list --list <list-id>

# Move a task to a different list
todos update <task-id> --list <list-id>

# Delete a list (tasks keep their data, just lose the list association)
todos lists --delete <list-id>
```

Task lists can be project-scoped or standalone. Slugs must be unique within a project.

## Task Prefixes & Short IDs

Every project gets an auto-generated prefix (e.g., "APP" from "My App"). When tasks are created under a project, they get a short ID prepended to the title:

```bash
# Project "My App" has prefix "MYA"
todos add "Fix login bug"
# Creates: "MYA-00001: Fix login bug"

todos add "Add dark mode"
# Creates: "MYA-00002: Add dark mode"
```

Custom prefixes can be set when creating a project. Counters auto-increment per project.

## Plans

Plans are execution groups for organizing work. A task can belong to both a task list AND a plan.

```bash
# Create a plan
todos plans --add "v2.0 Release"

# Show plan details
todos plans --show <plan-id>

# Complete a plan
todos plans --complete <plan-id>

# Assign tasks to a plan
todos add "Build API" --plan <plan-id>
```

## MCP Server

Register the MCP server with AI coding agents:

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

### MCP Tools (29)

| Category | Tools |
|----------|-------|
| **Tasks** | `create_task`, `list_tasks`, `get_task`, `update_task`, `delete_task`, `start_task`, `complete_task` |
| **Locking** | `lock_task`, `unlock_task` |
| **Dependencies** | `add_dependency`, `remove_dependency` |
| **Comments** | `add_comment` |
| **Projects** | `create_project`, `list_projects` |
| **Plans** | `create_plan`, `list_plans`, `get_plan`, `update_plan`, `delete_plan` |
| **Agents** | `register_agent`, `list_agents`, `get_agent` |
| **Task Lists** | `create_task_list`, `list_task_lists`, `get_task_list`, `update_task_list`, `delete_task_list` |
| **Search** | `search_tasks` |
| **Sync** | `sync` |

### MCP Resources

| URI | Description |
|-----|-------------|
| `todos://tasks` | All active tasks (pending + in_progress) |
| `todos://projects` | All registered projects |
| `todos://agents` | All registered agents |
| `todos://task-lists` | All task lists |

## Sync

Bidirectional sync with agent-specific task lists.

```bash
todos sync --agent claude --task-list <id>
todos sync --agent codex --task-list default
todos sync --all --task-list <id>
todos sync --prefer local          # Resolve conflicts favoring local
todos sync --push                  # One-way: local → agent
todos sync --pull                  # One-way: agent → local
```

Claude uses native Claude Code task lists. Other agents use JSON files under `~/.todos/agents/<agent>/<task_list_id>/`.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `TODOS_DB_PATH` | Database file path (`:memory:` for testing) |
| `TODOS_DB_SCOPE` | Set to `project` to force project-level DB |
| `TODOS_AUTO_PROJECT` | Set to `false` to disable auto-project detection |
| `TODOS_SYNC_AGENTS` | Comma-separated agent list for `--all` |
| `TODOS_TASK_LIST_ID` | Default task list ID for sync |
| `TODOS_<AGENT>_TASK_LIST` | Agent-specific task list ID |
| `TODOS_AGENT_TASKS_DIR` | Base directory for agent task files |

### Config File

`~/.todos/config.json`:

```json
{
  "sync_agents": ["claude", "codex", "gemini"],
  "task_list_id": "default",
  "agent_tasks_dir": "/Users/you/.todos/agents",
  "agents": {
    "claude": { "task_list_id": "session-or-project-id" },
    "codex": { "task_list_id": "default" }
  }
}
```

## CLI Commands

### Task Operations

| Command | Description |
|---------|-------------|
| `todos add <title>` | Create a task (`-p` priority, `--tags`, `--list`, `--plan`, `--assign`, `--parent`) |
| `todos list` | List tasks (`-s` status, `-p` priority, `--list`, `--tags`, `-a` all) |
| `todos show <id>` | Show full task details with relations |
| `todos update <id>` | Update fields (`--title`, `-s`, `-p`, `--tags`, `--list`, `--assign`) |
| `todos start <id>` | Claim task, lock it, set to in_progress |
| `todos done <id>` | Mark task completed, release lock |
| `todos delete <id>` | Delete permanently |
| `todos lock <id>` | Acquire exclusive lock |
| `todos unlock <id>` | Release lock |

### Organization

| Command | Description |
|---------|-------------|
| `todos lists` | List task lists (`--add`, `--delete`, `--slug`, `-d`) |
| `todos plans` | List plans (`--add`, `--show`, `--delete`, `--complete`) |
| `todos projects` | List projects (`--add`, `--name`, `--task-list-id`) |
| `todos deps <id>` | Manage dependencies (`--needs`, `--remove`) |
| `todos comment <id> <text>` | Add a comment to a task |
| `todos search <query>` | Full-text search across tasks |

### Agent & System

| Command | Description |
|---------|-------------|
| `todos init <name>` | Register agent, get short UUID (`-d` description) |
| `todos agents` | List registered agents |
| `todos sync` | Sync with agent task lists |
| `todos mcp` | MCP server (`--register`, `--unregister`) |
| `todos hooks install` | Install Claude Code auto-sync hooks |
| `todos export` | Export tasks (`-f json\|md`) |
| `todos upgrade` | Self-update to latest version |

### Global Options

All commands support: `--project <path>`, `--json`, `--agent <name>`, `--session <id>`.

Partial IDs work everywhere — use the first 8+ characters of any UUID.

## Library Usage

```typescript
import {
  createTask,
  listTasks,
  completeTask,
  registerAgent,
  createTaskList,
  createProject,
  searchTasks,
} from "@hasna/todos";

// Register an agent
const agent = registerAgent({ name: "my-bot" });

// Create a project
const project = createProject({ name: "My App", path: "/app" });

// Create a task list
const backlog = createTaskList({ name: "Backlog", project_id: project.id });

// Create a task (gets short_id like "MYA-00001" auto-prepended)
const task = createTask({
  title: "Fix login bug",
  priority: "high",
  project_id: project.id,
  task_list_id: backlog.id,
  agent_id: agent.id,
  tags: ["bug", "auth"],
});

// List and filter
const pending = listTasks({ status: "pending", task_list_id: backlog.id });

// Search
const results = searchTasks("login", project.id);

// Complete
completeTask(task.id);
```

## Database

SQLite with automatic location detection:

1. `TODOS_DB_PATH` environment variable (`:memory:` for testing)
2. Nearest `.todos/todos.db` in current directory or any parent
3. `~/.todos/todos.db` global fallback

**Schema** (6 migrations, auto-applied):

| Table | Purpose |
|-------|---------|
| `projects` | Project registry with task prefix and counter |
| `tasks` | Main task table with short_id, versioning, locking |
| `task_lists` | Named containers for tasks |
| `agents` | Registered agent identities |
| `plans` | Execution groups |
| `task_dependencies` | DAG edges between tasks |
| `task_comments` | Notes on tasks |
| `task_tags` | Tag index for filtering |
| `sessions` | Agent session tracking |

## Development

```bash
git clone https://github.com/hasna/todos.git
cd todos
bun install
bun test                    # Run 172 tests
bun run typecheck           # TypeScript checking
bun run dev:cli             # Run CLI in dev mode
bun run dev:mcp             # Run MCP server in dev mode
```

## Architecture

```
src/
  types/     TypeScript types, enums, custom errors
  db/        SQLite data layer (tasks, projects, agents, task-lists, plans, comments, sessions)
  lib/       Business logic (search, sync, config)
  cli/       Commander.js CLI + React/Ink TUI
  mcp/       MCP server (stdio transport, 29 tools)
  index.ts   Library re-exports
```

All surfaces (CLI, MCP, library) call directly into `src/db/` — no intermediate service layer.

## License

[Apache License 2.0](LICENSE)
