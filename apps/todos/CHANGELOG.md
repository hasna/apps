# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.1] - 2026-02-15

### Added
- Full detail pages for tasks, plans, and projects at `/todos/:id`, `/plans/:id`, `/projects/:id`
- Breadcrumb navigation on detail pages
- Tabbed editing interface (Edit, Details, Relations, Comments)
- Clickable entity names in tables navigate to detail pages
- `GET /api/projects/:id` and `PATCH /api/projects/:id` endpoints

### Removed
- Edit Task, Edit Plan, and Task Detail dialogs (replaced by detail pages)

## [0.5.0] - 2026-02-15

### Added
- API key authentication system with SHA-256 hashed keys
- API keys management card on dashboard home page
- Bearer token middleware (auto-enables when first key is created)
- Combobox component (Popover + Command) for searchable dropdowns
- Tabs component for tabbed interfaces
- Task detail dialog with tabs (Overview, Details, Relations, Comments)
- Group-by dropdown on tasks table (group by Project or Plan)
- Date Added and Last Updated columns in tasks table
- Docs page redesign with sticky sidebar nav and copyable code blocks
- "Copy page" button on docs (exports as markdown)
- Footer with About, Contact, Legal, GitHub links
- About, Contact, Legal pages with URL routing
- "todos.md" branding (replaced Hasna Todos logo)
- Sticky header with backdrop blur
- Create Project dialog with task_list_id field
- Edit Task and Edit Plan dialogs
- Searchable combobox for project/plan selects in dialogs
- Refresh buttons with outline variant
- Primary (black) "New X" buttons in page headers

### Changed
- Page title + action button on same row (normalized layout)
- Removed page descriptions for cleaner look
- Removed "Dashboard" from nav (logo click navigates to dashboard)
- CORS headers now include Authorization

## [0.4.1] - 2026-02-15

### Added
- Docs page with cards, sticky sidebar, copy-to-clipboard code blocks
- "Copy page" markdown export button on docs
- Create Project dialog
- Edit Task dialog with status, priority, plan, tags editing
- Edit Plan dialog
- Edit options in task and plan dropdown menus

### Changed
- Page layout normalized: title + add button in same row
- "New X" buttons moved from header to page content
- Sticky header with backdrop blur
- Branding changed to "todos.md"

## [0.4.0] - 2026-02-15

### Added
- Plans as a first-class entity (database, types, CRUD)
- Plans table with `active`, `completed`, `archived` statuses
- `plan_id` field on tasks (SET NULL on plan delete)
- 5 MCP tools: `create_plan`, `list_plans`, `get_plan`, `update_plan`, `delete_plan`
- `todos plans` CLI command with `--add`, `--show`, `--delete`, `--complete`
- `--plan <id>` option on `todos add` command
- Plans page in dashboard with row selection and bulk actions
- Create Plan dialog
- Plan column in tasks table
- Plan select in create task dialog
- Plans section in docs
- URL-based routing (`/`, `/todos`, `/projects`, `/plans`, `/docs`)
- Dashboard home page with stats cards
- Project bulk actions (row selection + delete)
- `DELETE /api/projects/:id` endpoint
- Plan API endpoints (GET/POST/PATCH/DELETE)
- 20 new API tests (plans CRUD, project delete, task plan_id)

### Changed
- `plan` CLI command replaced with `plans` command

## [0.3.7] - 2026-02-14

### Added
- Initial release with CLI, MCP server, and web dashboard
- Task management with optimistic locking and versioning
- Project management with auto-detection
- Full-text search across tasks
- SQLite database with WAL mode
- Bidirectional sync with Claude Code, Codex, Gemini
- Claude Code hooks integration
- Interactive TUI mode
