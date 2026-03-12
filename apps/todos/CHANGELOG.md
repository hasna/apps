# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.29] - 2026-03-12

### Performance
- Eliminate redundant `getTask()` re-fetches in `updateTask`, `startTask`, `completeTask` — saves 1 SELECT per mutation (33% fewer DB queries)

## [0.9.28] - 2026-03-12

### Performance
- Strip all 119 `.describe()` strings from MCP tool params (lean stubs pattern) — 90% cold start token reduction

## [0.9.27] - 2026-03-11

### Added
- CLI `--format=compact|csv|json|table` on `todos list` — compact is 95% fewer tokens than JSON

## [0.9.26] - 2026-03-11

### Changed
- MCP mutation responses (create/update/start/complete) now return compact 1-line format instead of 10-line detail — 80% smaller

## [0.9.25] - 2026-03-11

### Added
- REST API field filtering: `GET /api/tasks?fields=id,title,status` returns only requested fields — 60-80% smaller responses

## [0.9.24] - 2026-03-11

### Added
- `search_tools` and `describe_tools` MCP meta-tools for dynamic tool discovery (90-96% input token reduction)
- Trimmed 14 MCP tool descriptions to ≤60 chars

## [0.9.23] - 2026-03-11

### Added
- `@hasna/todos-sdk` — universal agent SDK package (TodosClient, OpenAI-compatible schemas)
- Agent discovery: `GET /api/agents/me` with auto-register, stats, assigned tasks
- Agent task queue: `GET /api/agents/:id/queue` sorted by priority
- Smart task claiming: `POST /api/tasks/claim` — atomically claim next available task
- Blocking dependency checks: `startTask` rejects tasks with unmet deps
- Completion evidence: `completeTask` accepts `{ files_changed, test_results, commit_hash, notes }`
- SSE event stream: `GET /api/events` for real-time task change notifications
- Auto-assignment: `findBestAgent()` assigns to least-loaded agent with role=agent
- `get_my_tasks` MCP tool for agent self-discovery

## [0.9.22] - 2026-03-11

### Changed
- README: comprehensive REST API docs (30+ endpoints), MCP tools reference (40 tools), CLI reference

## [0.9.21] - 2026-03-10

### Added
- Server API endpoints for audit log, webhooks, templates
- Dashboard activity feed showing audit log entries
- 61 new tests for audit, webhooks, templates, auto-audit

## [0.9.20] - 2026-03-10

### Added
- 11 new MCP tools: `get_task_history`, `get_recent_activity`, `create_webhook`, `list_webhooks`, `delete_webhook`, `create_template`, `list_templates`, `create_task_from_template`, `delete_template`, `approve_task`
- Auto-audit: task mutations (start/complete/update) automatically log to task_history
- CLI commands: `todos history`, `todos approve`, `todos templates`
- `--estimated` and `--approval` flags on `todos add` and `todos update`

## [0.9.19] - 2026-03-10

### Fixed
- Bulletproof migration system: `ensureSchema()` individually checks every table, column, and index on startup — handles fresh install, any upgrade path, partial migration recovery

## [0.9.18] - 2026-03-10

### Added
- Migration 10: audit log (`task_history`), webhooks, task templates, estimated time, approval workflow, agent permissions
- `logTaskChange`, `getTaskHistory`, `getRecentActivity` for audit trail
- `createWebhook`, `listWebhooks`, `deleteWebhook`, `dispatchWebhook` with HMAC signatures
- `createTemplate`, `listTemplates`, `deleteTemplate`, `taskFromTemplate`
- `estimated_minutes`, `requires_approval`, `approved_by`, `approved_at` on tasks
- `permissions` on agents (default `["*"]`)

## [0.9.17] - 2026-03-10

### Added
- Plans page in web dashboard with data table, markdown description, create/edit dialogs
- Plans can be attached to projects, task lists, or be free-standing
- Plans have owner agent (`agent_id`)
- Full REST API for plans: GET/POST/PATCH/DELETE /api/plans

## [0.9.16] - 2026-03-10

### Changed
- npm package published with public access
- Added `publishConfig.access: "public"` to package.json

## [0.9.15] - 2026-03-10

### Changed
- Open-source release polish: badges, dashboard/API docs in README
- Fix git clone URL, MCP server version, SECURITY.md versions
- Add repository, homepage, bugs, engines to package.json
- Remove self-dependency and postinstall

## [0.9.14] - 2026-03-09

### Added
- 27 new tests: lock expiry, partial ID resolution, updateAgent, getTaskListBySlug, ensureTaskList, server CRUD, export, bulk ops

## [0.9.13] - 2026-03-09

### Added
- Agent role field (migration 8) with admin/agent/observer roles
- `updateAgent()` function and `PATCH /api/agents/:id` endpoint
- Agents page: online/offline status, detail dialog, edit mode, role badges, last task, merge duplicates, comparison
- shadcn NavigationMenu for header navigation
- Help page moved to top-right as `?` icon button

## [0.9.12] - 2026-03-09

### Added
- Kanban view QoL: drag-and-drop, collapse/expand columns, priority filter, sort within columns, group by project, cancelled toggle, compact/detailed mode, inline actions, assignee avatars, hover preview, show more pagination

## [0.9.11] - 2026-03-09

### Added
- Auto-find free port when default 19427 is in use (scans up to 100 ports)

## [0.9.10] - 2026-03-09

### Added
- CLI: `todos count`, `todos bulk`, `todos watch`, `todos config`
- CLI: `--project-name`, `--agent-name`, `--sort` on `todos list`
- Better error messages with "Did you mean?" suggestions
- JSON error output when `--json` is active
- Kanban board view with table/kanban toggle

## [0.9.9] - 2026-03-09

### Added
- Card shadows removed across dashboard
- shadcn Select, Dialog, DatePicker components
- Task detail opens in dialog instead of inline
- Delete confirmation dialog
- CRUD endpoints for agents and projects in server
- Bulk delete for agents and projects
- Projects and agents pages: data tables with checkboxes, create dialogs, dropdown menus

## [0.9.8] - 2026-03-09

### Added
- Web dashboard (React/Vite/Tailwind/shadcn) served by Bun HTTP server
- Dashboard page with stats cards, completion rate, recent activity
- Tasks data table with search, filters, sorting, pagination
- Projects and agents data tables
- Task detail with markdown rendering
- Create/edit task dialogs
- Dark/light/system theme toggle
- Auto-refresh every 30 seconds
- Keyboard shortcuts (n, /, 0-4, r, Esc)
- Export CSV/JSON
- `todos-serve` binary and `todos serve` CLI command

### Changed
- Removed default LIMIT 100 from `listTasks()` — returns all by default

## [0.9.7] - 2026-03-08

### Added
- Completion guard: configurable throttling to prevent AI agents from faking task completions
  - 4 guards: status check, min work duration, rate limit, cooldown
  - Per-project overrides via config
  - `CompletionGuardError` with `retryAfterSeconds`

## [0.9.0] - 2026-02-28

### Added
- Agents with 8-char UUID identity system (migration 5)
- Task lists as named containers (migration 5)
- Task prefixes with auto-incrementing short IDs per project (migration 6)
- Comprehensive test coverage (295 tests across 14 files)

### Changed
- Integrated agents and task lists across CLI, MCP, and library surfaces

## [0.5.1] - 2026-02-15

### Added
- Full detail pages for tasks, plans, and projects
- Breadcrumb navigation on detail pages
- Tabbed editing interface

## [0.5.0] - 2026-02-15

### Added
- API key authentication with SHA-256 hashed keys
- Dashboard redesign with docs page, about/contact/legal pages
- Combobox, Tabs components
- Task detail dialog with tabs

## [0.4.0] - 2026-02-15

### Added
- Plans as first-class entity with CRUD across all surfaces
- URL-based routing in dashboard
- Dashboard home page with stats cards

## [0.3.7] - 2026-02-14

### Added
- Initial release with CLI, MCP server, and web dashboard
- Task management with optimistic locking
- Project management with auto-detection
- Full-text search, SQLite WAL mode
- Bidirectional sync with Claude Code, Codex, Gemini
