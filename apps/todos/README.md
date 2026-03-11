# @hasna/todos

[![npm version](https://img.shields.io/npm/v/@hasna/todos)](https://www.npmjs.com/package/@hasna/todos)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-295%20passing-brightgreen)]()

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

### MCP Tools (40)

**Tasks:** `create_task`, `list_tasks`, `get_task`, `update_task`, `delete_task`, `start_task`, `complete_task`, `lock_task`, `unlock_task`, `approve_task`
**Dependencies:** `add_dependency`, `remove_dependency`
**Comments:** `add_comment`
**Projects:** `create_project`, `list_projects`
**Plans:** `create_plan`, `list_plans`, `get_plan`, `update_plan`, `delete_plan`
**Agents:** `register_agent`, `list_agents`, `get_agent`
**Task Lists:** `create_task_list`, `list_task_lists`, `get_task_list`, `update_task_list`, `delete_task_list`
**Search:** `search_tasks`
**Sync:** `sync`
**Audit:** `get_task_history`, `get_recent_activity`
**Webhooks:** `create_webhook`, `list_webhooks`, `delete_webhook`
**Templates:** `create_template`, `list_templates`, `create_task_from_template`, `delete_template`

### MCP Resources

| URI | Description |
|-----|-------------|
| `todos://tasks` | All active tasks (pending + in_progress) |
| `todos://projects` | All registered projects |
| `todos://agents` | All registered agents |
| `todos://task-lists` | All task lists |

## Web Dashboard

Start the web dashboard to manage tasks visually:

```bash
todos serve
# or
todos-serve --port 19427
```

Features:
- **Dashboard** — stats cards, completion rate, recent activity
- **Tasks** — data table with search, filters, sorting, pagination, kanban board view
- **Projects** — project management with task breakdown
- **Agents** — agent monitoring with completion rates, online status, role management
- **Help** — keyboard shortcuts, CLI reference, MCP configuration

The dashboard auto-refreshes every 30 seconds, supports dark mode, and includes keyboard shortcuts (`/` search, `n` new task, `0-4` navigate pages).

## REST API

Start the server with `todos serve` or `todos-serve`. Default port: 19427.

### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tasks` | List tasks. Query: `?status=`, `?project_id=`, `?limit=` |
| POST | `/api/tasks` | Create task. Body: `{ title, description?, priority?, project_id?, estimated_minutes?, requires_approval? }` |
| GET | `/api/tasks/:id` | Get task details |
| PATCH | `/api/tasks/:id` | Update task. Body: `{ title?, status?, priority?, description?, assigned_to?, tags?, due_at?, estimated_minutes?, requires_approval?, approved_by? }` |
| DELETE | `/api/tasks/:id` | Delete task |
| POST | `/api/tasks/:id/start` | Start task (sets in_progress, locks) |
| POST | `/api/tasks/:id/complete` | Complete task |
| GET | `/api/tasks/:id/history` | Get task audit log |
| POST | `/api/tasks/bulk` | Bulk ops. Body: `{ ids: [...], action: "start" | "complete" | "delete" }` |
| GET | `/api/tasks/export?format=csv` | Export as CSV |
| GET | `/api/tasks/export?format=json` | Export as JSON |

### Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/projects` | List all projects |
| POST | `/api/projects` | Create project. Body: `{ name, path, description? }` |
| DELETE | `/api/projects/:id` | Delete project |
| POST | `/api/projects/bulk` | Bulk delete. Body: `{ ids: [...], action: "delete" }` |

### Plans

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/plans` | List plans. Query: `?project_id=` |
| POST | `/api/plans` | Create plan. Body: `{ name, description?, project_id?, task_list_id?, agent_id?, status? }` |
| GET | `/api/plans/:id` | Get plan with its tasks |
| PATCH | `/api/plans/:id` | Update plan |
| DELETE | `/api/plans/:id` | Delete plan |
| POST | `/api/plans/bulk` | Bulk delete |

### Agents

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/agents` | List all agents |
| POST | `/api/agents` | Register agent. Body: `{ name, description?, role? }` |
| PATCH | `/api/agents/:id` | Update agent. Body: `{ name?, description?, role? }` |
| DELETE | `/api/agents/:id` | Delete agent |
| POST | `/api/agents/bulk` | Bulk delete |

### Webhooks, Templates, Activity

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/webhooks` | List webhooks |
| POST | `/api/webhooks` | Create webhook. Body: `{ url, events?, secret? }` |
| DELETE | `/api/webhooks/:id` | Delete webhook |
| GET | `/api/templates` | List task templates |
| POST | `/api/templates` | Create template. Body: `{ name, title_pattern, description?, priority?, tags? }` |
| DELETE | `/api/templates/:id` | Delete template |
| GET | `/api/activity` | Recent audit log. Query: `?limit=50` |
| GET | `/api/stats` | Dashboard statistics |

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

## CLI Reference

```bash
# Task management
todos add "title" [-d desc] [-p priority] [--tags t1,t2] [--plan id] [--estimated 30] [--approval]
todos list [-s status] [-p priority] [--assigned agent] [--project-name name] [--agent-name name] [--sort field] [-a]
todos show <id>                    # Full task details with relations
todos update <id> [--title t] [-s status] [-p priority] [--tags t1,t2] [--estimated 30]
todos done <id>                    # Complete a task
todos start <id>                   # Claim, lock, and start
todos delete <id>
todos approve <id>                 # Approve a task requiring approval
todos history <id>                 # Show task audit log
todos search <query>
todos bulk <done|start|delete> <id1> <id2> ...
todos comment <id> <text>
todos deps <id> --add <dep_id>     # Manage dependencies

# Plans
todos plans [--add name] [--show id] [--delete id] [--complete id]

# Templates
todos templates [--add name --title pattern] [--delete id] [--use id]

# Projects & Agents
todos projects [--add name --path /path]
todos agents
todos init <name>                  # Register an agent
todos lists                        # Manage task lists

# Utilities
todos count [--json]               # Quick stats
todos watch [-s status] [-i 5]     # Live-updating task list
todos config [--get key] [--set key=value]
todos export [--format csv|json]
todos sync [--task-list id]        # Sync with Claude Code
todos serve [--port 19427]         # Start web dashboard
todos interactive                  # Launch TUI
todos upgrade                      # Update to latest version
```

All output supports `--json` for machine-readable format.

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
git clone https://github.com/hasna/open-todos.git
cd open-todos
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
