# CLI/MCP Parity

`@hasna/todos` exposes the same local task system through the `todos` CLI and
the `todos-mcp` stdio server. The side-effect-free parity manifest is exported
from the root package as:

- `TODOS_CLI_MCP_PARITY`
- `TODOS_CLI_MCP_PARITY_MANIFEST`
- `createCliMcpParityManifest()`

The manifest is local-only and does not need network access. Each entry maps a
supported workflow domain to CLI commands, MCP tools, stable JSON contracts, and
structured error contracts.

## Covered Domains

- `tasks`: create, list, read, update, lifecycle, assignment, queue, lock
  leases, stale recovery, and bulk workflows.
- `references`: local file, line, symbol, commit, branch, pull request ref,
  plan, run, task, and agent mention resolution with validated backlinks and no
  hosted code search.
- `knowledge`: local decision records, architecture notes, tradeoffs, context
  snapshots, search, export, and MCP resources for agent project memory.
- `risks`: local project and plan risk register entries, owner/mitigation due
  dates, deterministic exports, and local health scoring from task evidence.
- `retrospectives`: local lessons-learned reports from completed plans, missed
  estimates, recurring blockers, failed verifications, and follow-up tasks.
- `agent-reliability`: local agent scorecards from task completion, failed run
  ledgers, verification evidence, stale locks, retry history, and handoffs.
- `local-fields`: local labels, priority, severity, owner, area, and custom
  fields with query support for agent-native task selection.
- `dedupe`: local duplicate scans and merge workflows that preserve comments,
  dependencies, run ledgers, files, inbox links, and verification evidence.
- `verification-providers`: optional local command, testbox-style, CI log,
  browser artifact, and script adapters for recording verification evidence.
- `projects`: project bootstrap, project registration, project updates, task
  lists, path resolution, and focus.
- `plans`: plan create, list, read, update, complete, and delete workflows.
- `roadmaps`: local roadmap, milestone, release grouping, progress summary,
  dependency readiness, Markdown/JSON export, and import workflows.
- `capacity`: local agent capacity profiles and planning forecasts from task
  estimates, actual minutes, due dates, and risk flags.
- `audit-ledger`: tamper-evident local hash-chain checkpoints for task, run,
  verification, approval, and handoff evidence.
- `release-compatibility`: local package, migration, export, Bun install,
  changelog, and rollback checks before publishing or updating.
- `templates`: bundled marketplace-free local template library, editable JSON
  template files, template import/export, preview, version history, and task
  creation from templates.
- `workspace-trust`: local trusted roots, permission presets, command checks,
  write scopes, env redaction declarations, and prompt-required decisions.
- `secret-safety`: local secret redaction config and scans that return finding
  counts without exposing matched values.
- `retention-cleanup`: dry-run-first local pruning for old comments, runs,
  verification evidence, and expired artifact files with explicit destructive
  confirmation.
- `runner-sandbox`: local runner command allowlists, cwd boundaries, write
  scopes, env allowlists, network policy, audit evidence, and dry-run explains.
- `extensions`: local extension manifests, compatibility checks, checksum or
  signature verification, trust review state, offline bundles, and registry
  install/list/remove workflows.
- `workflow-prompts`: bundled local prompt resources for goal planning, task
  claiming, review, verification, handoff, release prep, import triage, and
  incident response.
- `policy-packs`: local done-gate policies for required commands, forbidden
  evidence, commits, pull requests, approvals, runs, and artifacts.
- `approval-gates`: local manual checkpoints for risky task, plan, and run work
  with approve, reject, expire, check, and list flows.
- `review-queues`: local review queues, reviewer claims, requested changes,
  approvals, and routing rules for human or agent review without hosted users.
- `local-event-hooks`: local-only event hooks for task, plan, run, approval,
  import, and export events with stdout, file, socket, and script targets.
- `terminal-notifications`: local terminal watch rules for task, run, plan,
  approval, import, export, due-date, SLA, stale-task, run, and reminder events
  with severity, agent, project, priority, status, payload text, quiet-hours,
  and bell filters.
- `branch-work-plans`: local branch-safe work plans with task/plan scope,
  planned files, active file conflicts, git status, and suggested traceability
  commands.
- `natural-language-intake`: deterministic local parsing for projects, plans,
  tasks, dependencies, and acceptance criteria with dry-run previews and
  explicit apply mode.
- `encryption`: local encryption profiles, encrypted JSON values, and secure
  bridge export/import workflows.
- `agent-runs`: local adapter definitions, queued agent runs, dry-run launch
  previews, cancellation, retries, and run-ledger evidence.
- `source-index`: local TODO/FIXME/HACK/BUG/XXX/NOTE source extraction,
  gitignore-aware codebase indexing, symbol context, dedupe fingerprints, and
  finite watcher scans.
- `calendar`: local task due dates, SLA threshold events, run-ledger events,
  reminders, milestones, work blocks, deterministic ICS export, and ICS import.
- `kanban-boards`: local task and plan board definitions, workflow lanes, WIP
  limits, blocked/ready badges, board snapshots, terminal/TUI rendering, and
  card moves.
- `time-tracking`: local manual time logs, focus sessions, idle prompts,
  actual-minute rollups, and estimate reports.
- `handoffs`: local session continuation records with referenced tasks, files,
  runs, next steps, blockers, stale-session recovery, and per-agent
  acknowledgement state.
- `runs`: local task-run ledgers, events, commands, files, artifacts, and
  finish records.
- `comments`: task comments, progress notes, and unified local activity
  timelines across task history and run evidence.
- `search`: task search, saved views, cross-entity search, status, standup,
  report, graph, context, and recent activity workflows.
- `context-packs`: deterministic Markdown/JSON local context bundles for agent
  run starts.
- `release-notes`: local changelog generation from completed tasks, plans,
  linked commits, verification records, breaking changes, and migration notes.
- `onboarding`: bundled deterministic local demo fixtures for project, task,
  plan, run, evidence, review, and bridge import/export smoke tests.
- `local-snapshots`: local project, task, plan, run, dependency, event, and
  evidence snapshots with cursors, fingerprints, JSON, Markdown, MCP resources,
  and polling.
- `imports`: template imports, external issue imports, inbox intake, and local
  bridge imports.
- `exports`: template exports, traceability exports, verification records, and
  local bridge exports.

## Examples

CLI task creation:

```bash
todos add "Fix flaky parser" --priority high --json
```

Matching MCP tool:

```json
{ "tool": "create_task", "arguments": { "title": "Fix flaky parser", "priority": "high" } }
```

CLI reference resolution:

```bash
todos references resolve file:src/index.ts:12 symbol:createTask branch:main --json
```

Matching MCP tool:

```json
{ "tool": "resolve_mentions", "arguments": { "mentions": ["file:src/index.ts:12", "symbol:createTask", "branch:main"] } }
```

CLI knowledge decision:

```bash
todos knowledge add decision "Use local SQLite" --decision "Keep OSS knowledge local" --json
```

Matching MCP tool:

```json
{ "tool": "create_knowledge_record", "arguments": { "record_type": "decision", "title": "Use local SQLite", "decision": "Keep OSS knowledge local" } }
```

CLI risk scoring:

```bash
todos risks add "Release blocker" --plan 1234abcd --severity high --owner codex --json
todos risks score --plan 1234abcd --json
```

Matching MCP tools:

```json
{ "tool": "create_risk", "arguments": { "title": "Release blocker", "plan_id": "1234abcd", "severity": "high", "owner": "codex" } }
{ "tool": "score_plan_health", "arguments": { "plan_id": "1234abcd" } }
```

CLI retrospective:

```bash
todos retrospectives create --plan 1234abcd --json
```

Matching MCP tool:

```json
{ "tool": "create_retrospective", "arguments": { "plan_id": "1234abcd" } }
```

CLI agent reliability:

```bash
todos reliability show codex --project 1234abcd --json
```

Matching MCP tool:

```json
{ "tool": "get_agent_reliability_scorecard", "arguments": { "agent_id": "codex", "project_id": "1234abcd" } }
```

CLI local fields update:

```bash
todos fields set 1234abcd --labels bug,cli --severity s1 --field component=parser --json
```

Matching MCP tool:

```json
{ "tool": "set_task_fields", "arguments": { "task_id": "1234abcd", "labels": ["bug", "cli"], "severity": "s1", "custom": { "component": "parser" } } }
```

CLI board snapshot:

```bash
todos board show local-flow --json
```

Matching MCP tool:

```json
{ "tool": "get_board_snapshot", "arguments": { "board_id": "local-flow" } }
```

CLI calendar export:

```bash
todos calendar export --redact --json
```

Matching MCP tool:

```json
{ "tool": "export_calendar_ics", "arguments": { "redact": true } }
```

CLI focus session:

```bash
todos time start 1234abcd --agent codex --idle-after 30 --json
```

Matching MCP tool:

```json
{ "tool": "start_focus_session", "arguments": { "task_id": "1234abcd", "agent_id": "codex", "idle_after_minutes": 30 } }
```

CLI duplicate scan:

```bash
todos dedupe scan --threshold 0.8 --json
```

Matching MCP tool:

```json
{ "tool": "find_duplicate_tasks", "arguments": { "threshold": 0.8 } }
```

CLI duplicate merge:

```bash
todos dedupe merge primary123 duplicate456 --reason "same imported issue" --json
```

Matching MCP tool:

```json
{ "tool": "merge_duplicate_task", "arguments": { "primary_task_id": "primary123", "duplicate_task_id": "duplicate456", "reason": "same imported issue" } }
```

CLI verification provider run:

```bash
todos verify-providers run local --task 1234abcd --json
```

Matching MCP tool:

```json
{ "tool": "run_verification_provider", "arguments": { "name": "local", "task_id": "1234abcd" } }
```

CLI retention cleanup preview:

```bash
todos retention cleanup --older-than-days 30 --json
```

Matching MCP tool:

```json
{ "tool": "preview_retention_cleanup", "arguments": { "older_than_days": 30 } }
```

CLI template library:

```bash
todos template-library --json
todos template-library --write .todos/templates --json
todos template-init --json
```

Matching MCP tools:

```json
{ "tool": "list_template_library", "arguments": {} }
```

```json
{ "tool": "write_template_library", "arguments": { "directory": ".todos/templates" } }
```

CLI saved search view:

```bash
todos views save active-cli --query parser --status pending,in_progress --tag cli --json
todos views run active-cli --json
```

Matching MCP tools:

```json
{ "tool": "save_search_view", "arguments": { "name": "active-cli", "query": "parser", "scope": "tasks", "tags": ["cli"] } }
{ "tool": "run_search_view", "arguments": { "name": "active-cli" } }
```

CLI workspace permission check:

```bash
todos trust check . --command "bun test" --write src/index.ts --json
```

Matching MCP tool:

```json
{ "tool": "check_workspace_permission", "arguments": { "path": ".", "command": "bun test", "write_path": "src/index.ts" } }
```

CLI runner sandbox check:

```bash
todos sandbox check codex --command "bun test" --write src/index.ts --json
```

Matching MCP tool:

```json
{ "tool": "check_runner_sandbox", "arguments": { "name": "codex", "command": "bun test", "write_paths": ["src/index.ts"] } }
```

CLI extension install:

```bash
todos extensions compat ./todos.extension.json --json
todos extensions install ./todos.extension.json --trust --json
```

Matching MCP tool:

```json
{ "tool": "test_local_extension_compatibility", "arguments": { "source": "./todos.extension.json" } }
```

```json
{ "tool": "install_local_extension", "arguments": { "source": "./todos.extension.json", "trust": true } }
```

CLI source TODO index:

```bash
todos extract . --dry-run --index --exclude fixtures/** --json
todos extract-watch . --dry-run --max-runs 1 --json
```

Matching MCP tools:

```json
{ "tool": "extract_todos", "arguments": { "path": ".", "dry_run": true, "include_index": true, "exclude": ["fixtures/**"] } }
{ "tool": "watch_source_todos", "arguments": { "path": ".", "dry_run": true, "max_runs": 1 } }
```

CLI workflow prompt render:

```bash
todos workflows show goal_planning --objective "Ship release" --json
```

Matching MCP surface:

```text
MCP prompt: goal_planning
MCP resource: todos://workflow-prompts
```

CLI policy validation:

```bash
todos policies validate release 1234abcd --json
```

Matching MCP tool:

```json
{ "tool": "validate_policy_pack", "arguments": { "name": "release", "task_id": "1234abcd" } }
```

CLI approval gate check:

```bash
todos approvals check 1234abcd deploy --json
```

Matching MCP tool:

```json
{ "tool": "check_approval_gate", "arguments": { "task_id": "1234abcd", "gate": "deploy" } }
```

CLI local review queue:

```bash
todos reviews list --queue security-review --json
```

Matching MCP tool:

```json
{ "tool": "list_review_queue", "arguments": { "queue": "security-review" } }
```

CLI local roadmap summary:

```bash
todos roadmaps show release-plan --format markdown
```

Matching MCP tool:

```json
{ "tool": "get_roadmap_summary", "arguments": { "roadmap_id": "release-plan", "format": "markdown" } }
```

CLI local capacity forecast:

```bash
todos capacity forecast --plan release-plan --agent codex --json
```

Matching MCP tool:

```json
{ "tool": "get_planning_forecast", "arguments": { "plan_id": "release-plan", "agent_id": "codex" } }
```

CLI audit ledger checkpoint:

```bash
todos audit-ledger seal release-checkpoint --task task-id --json
todos audit-ledger verify release-checkpoint --json
```

Matching MCP tool:

```json
{ "tool": "seal_audit_ledger", "arguments": { "name": "release-checkpoint", "task_id": "task-id" } }
```

CLI release compatibility:

```bash
todos release-compat check --json
```

Matching MCP tool:

```json
{ "tool": "check_release_compatibility", "arguments": { "simulated_levels": [0, 1] } }
```

CLI local event hook:

```bash
todos event-hooks set audit --event task.completed --target file --file .todos/events.jsonl --json
```

Matching MCP tool:

```json
{ "tool": "set_local_event_hook", "arguments": { "name": "audit", "events": ["task.completed"], "target": "file", "file_path": ".todos/events.jsonl" } }
```

CLI terminal notification rule:

```bash
todos terminal-notifications set blocked --event task.blocked,task.failed --min-severity warning --agent codex --json
todos notifications check --terminal --json
```

Matching MCP tool:

```json
{ "tool": "set_terminal_notification_rule", "arguments": { "name": "blocked", "events": ["task.blocked", "task.failed"], "min_severity": "warning", "agent_ids": ["codex"] } }
{ "tool": "check_local_notifications", "arguments": { "due_within_minutes": 60, "evaluate_terminal": true } }
```

CLI branch-safe work plan:

```bash
todos branch-plan 1234abcd --branch task/parser-fix --path src/parser.ts --json
```

Matching MCP tool:

```json
{ "tool": "create_branch_work_plan", "arguments": { "task_id": "1234abcd", "branch": "task/parser-fix", "paths": ["src/parser.ts"] } }
```

CLI natural-language intake preview:

```bash
todos inbox parse "Add task fix parser priority high @codex #cli" --json
```

Matching MCP tool:

```json
{ "tool": "preview_natural_language_intake", "arguments": { "text": "Add task fix parser priority high @codex #cli" } }
```

CLI encryption profile:

```bash
todos encryption set default --key-env TODOS_ENCRYPTION_KEY --json
```

Matching MCP tool:

```json
{ "tool": "set_encryption_profile", "arguments": { "name": "default", "key_env": "TODOS_ENCRYPTION_KEY" } }
```

CLI agent run queue:

```bash
todos agent-runs queue 1234abcd --adapter codex --json
```

Matching MCP tool:

```json
{ "tool": "queue_agent_run", "arguments": { "task_id": "1234abcd", "adapter": "codex" } }
```

CLI agent context pack:

```bash
todos context-pack 1234abcd --profile codex --format markdown
```

Matching MCP tool:

```json
{ "tool": "build_agent_context_pack", "arguments": { "task_id": "1234abcd", "profile": "codex", "format": "markdown" } }
```

CLI agent replay simulation:

```bash
todos runs simulate replay.json --agent codex --scenario parser-failure --json
```

Matching MCP tool:

```json
{ "tool": "simulate_agent_replay", "arguments": { "fixture": { "task": { "id": "1234abcd", "title": "Parser fix", "status": "pending" } }, "agent_id": "codex", "scenario": "parser-failure" } }
```

CLI environment snapshot:

```bash
todos env-snapshot capture --task 1234abcd --json
todos env-snapshot compare before.json after.json --json
```

Matching MCP tools:

```json
{ "tool": "capture_environment_snapshot", "arguments": { "task_id": "1234abcd", "command": "bun test" } }
```

```json
{ "tool": "compare_environment_snapshots", "arguments": { "left_path": "before.json", "right_path": "after.json" } }
```

CLI release notes:

```bash
todos release-notes --project . --format markdown
todos release-notes --tag release --since 2026-01-01T00:00:00.000Z --json
```

Matching MCP tool:

```json
{ "tool": "generate_release_notes", "arguments": { "tag": "release", "format": "json" } }
```

CLI session handoff:

```bash
todos handoff --create --agent codex --summary "Parser work ready for review" --tasks 1234abcd --files src/parser.ts --runs run123 --json
todos handoff --unread-for reviewer --json
todos handoff --ack handoff123 --agent reviewer --json
```

Matching MCP tools:

```json
{ "tool": "create_handoff", "arguments": { "agent_id": "codex", "summary": "Parser work ready for review", "task_ids": ["1234abcd"], "relevant_files": ["src/parser.ts"], "run_ids": ["run123"] } }
```

```json
{ "tool": "acknowledge_handoff", "arguments": { "handoff_id": "handoff123", "agent_id": "reviewer" } }
```

CLI bridge export:

```bash
todos export --format bridge --output todos-bridge.json --json
todos export --format bridge --encrypt --output todos-bridge.enc.json
todos bridge-import todos-bridge.json --apply --resolve-conflicts --json
```

The full local bridge export is intentionally CLI-only because it writes a local
file. MCP callers should use scoped traceability tools such as
`get_task_traceability`, `get_task_commits`, and `get_task_run_ledger` when they
do not need a whole-store bundle.

CLI bridge import:

```bash
todos issues import --file issues.json --provider github --apply --json
todos bridge-import todos-bridge.json --apply --json
todos todos-md-import todos.md --apply --resolve-conflicts --json
```

Matching MCP tool for external issue intake:

```json
{ "tool": "import_external_issues", "arguments": { "provider": "github", "json": { "number": 42, "title": "Parser regression", "html_url": "https://github.com/hasna/todos/issues/42" }, "apply": true } }
```

External issue imports support GitHub, Linear, Jira, and plain URL records from
offline files, pasted JSON, stdin, or explicit source URLs. They default to
dry-run previews, redact bodies and metadata before storage, and dedupe against
existing source metadata. Explicit network fetches are disabled unless the
caller opts in.

The full local bridge import is intentionally CLI-only and dry-run first because
it can write many local records. `--resolve-conflicts` safely merges
multi-machine task edits by filling blank local fields, unioning tags, merging
non-conflicting metadata, and recording unresolved divergent fields in
`metadata.sync_conflicts` for manual review. MCP callers can use scoped intake
tools such as `create_inbox_item`, `import_external_issues`, and
`import_template`.

## Contract Rules

- Stable JSON objects are listed in `docs/json-contracts.md`.
- CLI JSON errors use `api_error`.
- MCP errors use `structured_error`.
- New parity domains, commands, or MCP tools must update
  `TODOS_CLI_MCP_PARITY` and the regression tests before release.
