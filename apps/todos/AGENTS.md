# AGENTS.md — How AI Agents Should Use @hasna/todos

This document explains how AI agents (Claude Code, Codex, Gemini) can best use the todos task management system.

## Quick Start

```bash
# Install
bun install -g @hasna/todos

# Register MCP server with Claude Code
todos mcp --claude

# Or run standalone
todos serve  # starts REST API + dashboard at http://localhost:19427
```

## MCP Integration (Recommended)

`TODOS_PROFILE` defaults to `minimal`, which loads the compact agent loop tools
instead of every admin, template, and machine tool at session start:

```bash
# In your Claude Code config or CLAUDE.md:
TODOS_PROFILE=minimal    # compact default: claim/create/list/get/start/complete/fail/status/context/agent heartbeat
TODOS_PROFILE=standard   # task/project/resource/agent/metadata tools
TODOS_PROFILE=agent      # core + task/project/resource tools
TODOS_TOOL_GROUPS=templates  # add one group to the selected profile
TODOS_PROFILE=full       # all 65+ tools
```

High-volume MCP tools are compact by default. Pass `detail: "full"` to
`get_task`, `get_status`, `get_context`, `bootstrap`, or `task_context` when you
need the larger payload. Set `TODOS_MCP_TOKEN_TELEMETRY=1` to append approximate
response token counts for profiling.

## Recommended Agent Session Pattern

```bash
# === SESSION START ===
todos claim <your-agent-name>              # Atomically: find + lock + start best pending task
todos status                               # See: counts, active work, next task, stale/overdue

# === DURING WORK ===
todos log-progress <id> "Investigating..." # Record intermediate state (pct optional)
todos log-progress <id> "Fix written, testing" 80  # With percent complete

# === SESSION END ===
todos done <id> \
  --commit-hash <hash> \                   # Link git commit
  --notes "All tests pass"                 # Completion notes

# === IF SOMETHING GOES WRONG ===
todos fail <id> --reason "Auth bug in middleware" --retry  # Auto-creates retry copy
```

## Key MCP Tools for Agents

| Tool | What it does |
|------|-------------|
| `get_status` | Single call: counts + active work + next task + stale/overdue |
| `claim_next_task` | Atomic pick + lock + start — no race conditions |
| `get_next_task` | See what you'd get without claiming |
| `complete_task` | Mark done, auto-spawns next if recurring |
| `fail_task` | Structured failure with retry option |
| `log_progress` | Record intermediate state (content + pct_complete) |
| `decompose_task` | Break task into subtasks (with optional sequential chain) |
| `set_task_status` | Change status without needing version number |
| `explain_blocked` | Pass `explain_blocked: true` to get_status to see why queue is empty |

## REST API (for cross-process use)

Default port: **19427** — set `TODOS_URL=http://localhost:19427`

```typescript
import { createClient } from "@hasna/todos";
const todos = createClient(); // reads TODOS_URL

await todos.claimNextTask("my-agent");
await todos.getStatus();
await todos.listTasks({ due_today: true });
await todos.logProgress(taskId, "50% done", 50);
```

## Real-Time Events (SSE)

Subscribe to task events instead of polling:
```bash
todos stream --agent my-agent --events task.assigned,task.completed
```

Or from code:
```
GET http://localhost:19427/api/tasks/stream?agent_id=my-agent
```

Events: `task.created`, `task.started`, `task.completed`, `task.failed`, `task.assigned`, `task.status_changed`

## Cross-Tool Integration

- **Evidence on completion**: `todos done <id> --attach-ids <attachment-id>` (from @hasna/attachments)
- **Session linking**: set `TODOS_URL` in sessions; `sessions show --tasks` surfaces task IDs
- **Email notifications**: `todos webhook create --url <emails-webhook-url> --events task.assigned`
- **Memory context**: Use the default `TODOS_PROFILE=minimal` + mementos `format=compact` for minimum context overhead

## Anti-patterns to Avoid

❌ **Don't poll** — use `todos stream` or `GET /api/tasks/stream` SSE  
❌ **Don't pass `version` manually** — use `set_task_status`/`set_task_priority` instead of `update_task`  
❌ **Don't load all tools** — use `TODOS_PROFILE=minimal` for coding sessions  
❌ **Don't forget to claim** — use `claim_next_task` instead of `get_next_task` + `start_task` (race condition)
