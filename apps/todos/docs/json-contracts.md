# JSON Contracts

`@hasna/todos` treats machine-readable JSON as a public integration surface for
the CLI, local HTTP API, SDK, and MCP server. The canonical machine-readable
manifest is exported from `@hasna/todos/contracts` as:

- `TODOS_JSON_CONTRACTS`
- `TODOS_JSON_CONTRACTS_MANIFEST`
- `createJsonContractsManifest()`
- `getJsonContract()`
- `validateJsonContract()`

## Covered Objects

The stable contracts cover these object IDs:

- `task`
- `project`
- `local_review_queue_item`
- `review_routing_rule`
- `local_roadmap`
- `local_milestone`
- `roadmap_summary`
- `roadmap_bundle`
- `capacity_profile`
- `planning_forecast`
- `local_audit_ledger`
- `local_audit_ledger_checkpoint`
- `release_compatibility_report`
- `local_usage_ledger`
- `terminal_dashboard_snapshot`
- `scale_performance_report`
- `scale_compaction_result`
- `mention_resolution_report`
- `project_knowledge_record`
- `project_knowledge_export`
- `project_risk_record`
- `risk_register_export`
- `project_health_report`
- `retrospective_record`
- `retrospective_report`
- `retrospective_export`
- `agent_reliability_scorecard`
- `agent_reliability_export`
- `local_task_fields`
- `retention_cleanup_report`
- `duplicate_task_candidate`
- `task_merge_result`
- `external_issue_import_report`
- `verification_provider`
- `verification_provider_result`
- `agent`
- `handoff`
- `template`
- `task_list`
- `comment`
- `checkpoint`
- `dispatch`
- `audit_history`
- `local_activity_timeline_entry`
- `status_summary`
- `context_pack`
- `source_todo_comment`
- `source_code_index`
- `calendar_event`
- `ics_export_result`
- `task_board`
- `board_snapshot`
- `focus_session`
- `time_report_entry`
- `local_event_hook`
- `local_event_hook_delivery`
- `terminal_notification_rule`
- `terminal_notification_evaluation`
- `local_notification_check`
- `local_encryption_profile`
- `local_encryption_envelope`
- `encrypted_local_bridge_bundle`
- `structured_error`
- `api_error`
- `onboarding_fixture`
- `local_snapshot`
- `local_snapshot_poll_result`
- `sdk_integration_fixture_pack`
- `local_bridge_bundle`
- `local_bridge_import_result`
- `cli_mcp_parity_manifest`
- `project_bootstrap_result`
- `saved_search_view`
- `saved_search_run_result`

## Evolution Rules

JSON contracts are additive by default.

- Adding a new field is allowed.
- Adding an optional field is allowed.
- Removing a required field is breaking.
- Renaming a required field is breaking.
- Changing a required field type is breaking.
- Changing a nullable required field to non-nullable is breaking.
- Narrowing enum values used by a required field is breaking.

Callers should ignore unknown fields and pin behavior to required fields in the
manifest. Optional fields may be absent on older command, API, SDK, or MCP
surfaces.

## Error Shapes

Two error shapes are stable:

- `structured_error` for MCP and SDK style errors with `code` and `message`.
- `api_error` for CLI and HTTP API JSON errors with `error`.

New machine-readable fields may be added to either error object. Existing
clients should keep displaying the string message and use stable `code` values
when present.

## Mention Resolution

`mention_resolution_report` is returned by `todos references resolve --json`
and `resolve_mentions`. It reports each input mention, whether it resolved
locally, the canonical reference key, and validated backlinks for files, line
anchors, symbols, commits, branches, pull request refs present in local git
refs, plans, runs, tasks, and agents. It uses only the local workspace, local
git refs, and local todos state.

## Local Review Queues

`local_review_queue_item` is returned by `todos reviews list`,
`todos reviews request`, `todos reviews claim`, `todos reviews return`,
`todos reviews approve`, `todos reviews reopen`, and matching MCP review queue
tools. It captures the task identity, queue, review state, requester, reviewer,
claim holder, requested changes, route provenance, timestamps, and linked local
task review contract.

`review_routing_rule` is returned by `todos reviews rules set`,
`todos reviews rules list`, `set_review_routing_rule`, and
`list_review_routing_rules`. It stores local queue routing by name with enabled
state, queue, reviewers, tags, priorities, and optional project scope. Rules
are local config only and never imply hosted users, orgs, or cloud routing.

## Local Roadmaps

`local_roadmap` is returned by `todos roadmaps create`,
`todos roadmaps list`, `todos roadmaps update`, `create_roadmap`,
`list_roadmaps`, and `update_roadmap`. It captures local roadmap identity,
status, project scope, owner, agent owner, default release label, milestone
links, and timestamps.

`local_milestone` is returned by `todos roadmaps milestones add`,
`todos roadmaps milestones update`, `create_milestone`, and
`update_milestone`. It captures local due dates, owner assignment, linked task,
plan, run, release, and tag metadata.

`roadmap_summary` is returned by `todos roadmaps show --json` and
`get_roadmap_summary`. It includes milestone summaries, release groups, task
progress, blocker counts, and readiness derived from local dependencies.

`roadmap_bundle` is returned by `todos roadmaps export --json` and
`export_roadmap`. It is the import/export envelope consumed by
`todos roadmaps import` and `import_roadmap`.

## Local Capacity Forecasts

`capacity_profile` is returned by `todos capacity set`,
`todos capacity list`, `set_capacity_profile`, and
`list_capacity_profiles`. It stores local agent capacity in minutes per day,
working days, optional project scope, and effective date metadata.

`planning_forecast` is returned by `todos capacity forecast --json` and
`get_planning_forecast`. It combines task estimates, actual minutes, capacity
profiles, due dates, projected completion date, and risk flags for local
planning.

## Local Audit Ledgers

`local_audit_ledger` is returned by `todos audit-ledger show --json` and
`get_audit_ledger`. It contains the local-only hash algorithm, scoped evidence
filters, source counts, entry count, root hash, and optional per-entry chain
hashes.

`local_audit_ledger_checkpoint` is returned by
`todos audit-ledger seal --json`, `todos audit-ledger list --json`,
`seal_audit_ledger`, and `list_audit_ledger_checkpoints`. It stores the sealed
root hash and source counts used by `verify_audit_ledger`.

## Release Compatibility

`release_compatibility_report` is returned by
`todos release-compat check --json` and `check_release_compatibility`. It
summarizes local package identity, public access metadata, export keys, CLI
binaries, in-memory migration simulations, Bun install smoke commands,
changelog surfaces, rollback steps, warnings, and blocking issues.

## Local Usage Ledger

`local_usage_ledger` is returned by `todos usage report --json` and
`get_usage_ledger`. It summarizes aggregate local task, project, run, command,
duration, token, cost, and evidence-storage usage with optional quota
simulation. Raw commands and artifact paths are omitted from this report.

## Terminal Dashboard Snapshot

`terminal_dashboard_snapshot` is returned by
`todos dashboard --snapshot --json`. It captures the local terminal dashboard
tabs for projects, tasks, plans, runs, dependencies, inbox, and search with
keyboard hints and no hosted service calls.

## Project Knowledge

`project_knowledge_record` is returned by `todos knowledge add`,
`todos knowledge snapshot`, `todos knowledge list`, `todos knowledge search`,
and matching MCP knowledge tools. It stores local decisions, architecture notes,
tradeoffs, and context snapshots with task, project, plan, agent, tag, and
snapshot links.

`project_knowledge_export` is returned by `todos knowledge export --json` and
`export_knowledge_records`. It contains local-only export metadata, normalized
filters, count, and redacted knowledge records. The export never calls hosted
services or network APIs.

## Risk Register And Health

`project_risk_record` is returned by `todos risks add`, `todos risks list`,
`todos risks show`, and matching MCP risk tools. It captures local risk status,
severity, probability, owner, mitigation, due date, and optional project, plan,
task, tag, and metadata links.

`risk_register_export` is returned by `todos risks export --json` and
`export_risk_register`. It contains local-only export metadata, normalized
filters, count, and redacted risk records.

`project_health_report` is returned by `todos risks score --json`,
`score_plan_health`, and `score_project_health`. The score is derived only from
local blockers, overdue work, failed verification records, failed run ledgers,
dependency depth, and open risks. It never calls hosted services or network
APIs.

## Retrospectives

`retrospective_record` is returned by `todos retrospectives create`,
`todos retrospectives list`, and matching MCP tools. It stores a local
lessons-learned report for a project or plan.

`retrospective_report` contains the deterministic local summary: completed
plans, missed estimates, recurring blockers, failed verifications, lessons, and
suggested or created follow-up tasks.

`retrospective_export` is returned by `todos retrospectives export --json` and
`export_retrospectives`. It exports stored retrospectives with local-only
metadata and never calls hosted services or network APIs.

## Agent Reliability

`agent_reliability_scorecard` is returned by `todos reliability show --json`
and `get_agent_reliability_scorecard`. It scores one local agent from completed
and failed tasks, verification records, run ledgers, stale locks, retry counts,
and handoffs.

`agent_reliability_export` is returned by `todos reliability export --json` and
`export_agent_reliability_scorecards`. It contains local-only export metadata,
normalized filters, count, and scorecards. The export never calls hosted
services or network APIs.

## Local Task Fields

`local_task_fields` is the stable object returned by `todos fields show`,
`todos fields set --json`, `get_task_fields`, and `set_task_fields`. It keeps
labels, priority, severity, owner, area, and custom local metadata in task
metadata so bridge exports and imports carry it without any hosted dependency.

## Retention Cleanup

`retention_cleanup_report` is returned by `todos retention cleanup`,
`preview_retention_cleanup`, and `apply_retention_cleanup`. It captures the
local-only dry-run/apply state, normalized filters, cutoff timestamp, required
confirmation string, candidate counts, deleted counts, candidate IDs, expired
content-addressed artifact files, and warnings. It intentionally excludes raw
comments, commands, output summaries, artifact source paths, and secret-bearing
metadata.

## Saved Search Views

`saved_search_view` is the stable object returned by `todos views save`,
`todos views list`, `save_search_view`, and `list_search_views`. It stores a
local name, scope, description, and filter object for repeatable task, project,
plan, run, comment, or cross-entity searches.

`saved_search_run_result` is returned by `todos views run`, cross-entity
`todos search --scope ... --json`, and `run_search_view`. It contains the
applied scope, filters, result count, and an array of `{ entity_type, entity }`
records. Saved views are included in local bridge bundles and require no hosted
service.

## Source Index

`source_todo_comment` and `source_code_index` are emitted by
`todos extract --dry-run --index --json`, `todos extract-watch --json`,
`extract_todos`, and `watch_source_todos`. They describe local code comments,
dedupe fingerprints, nearest symbol context, checksums, and gitignore/exclude
behavior without calling hosted code search or telemetry.

## Duplicate Tasks

`duplicate_task_candidate` is the stable object returned in each item from
`todos dedupe scan --json` and `find_duplicate_tasks`. It includes the primary
task, duplicate task, score, and human-readable reasons for the match.

`task_merge_result` is returned by `todos dedupe merge --json` and
`merge_duplicate_task`. It includes the updated primary task, archived duplicate
task, duplicate relationship id, and moved evidence counts.

`external_issue_import_report` is returned by `todos issues import --json` and
`import_external_issues`. It records dry-run/apply mode, whether explicit
network access was used, normalized GitHub/Linear/Jira/URL records, created
tasks, linked inbox evidence, source-metadata matches that were skipped,
duplicate candidates, warnings, and follow-up local commands.

## Verification Providers

`verification_provider` is the stable local adapter config returned by
`todos verify-providers set --json`, `todos verify-providers list --json`,
`set_verification_provider`, and `list_verification_providers`.

`verification_provider_result` is returned by `todos verify-providers run --json`
and `run_verification_provider`. It includes provider name, kind, status,
attempt count, redacted output summary, optional artifact path, and task id when
evidence was recorded.

`local_extension_compatibility` is returned by `todos extensions compat --json`
and `test_local_extension_compatibility`. It includes normalized manifest
metadata, permission declaration checks, CLI/MCP naming checks, runner sandbox
dry-run diagnostics for declared commands, and install-time warnings/errors.

## Agent Handoffs

`handoff` is the stable local continuation record returned by
`todos handoff --json`, `create_handoff`, `list_handoffs`, `read_handoff`,
`acknowledge_handoff`, and `recover_stale_session_handoff`. It includes the
session id, summary, completed/in-progress/blocker/next-step lists, referenced
task ids, relevant local files, run ids, and per-agent acknowledgement state.

## Agent Context Packs

`context_pack` is the stable local bundle shape returned by
`todos context-pack --format json` and `build_agent_context_pack`. It includes
selected task, project, plan, dependency, comment, file, verification, and run
evidence plus a profile-specific prompt bundle for local agents.

Context packs also include a `context_budget` object. It records the local
token estimate, optional requested token budget, included/excluded sections,
omitted sections, and deterministic redacted summaries for any evidence removed
by `--include`, `--exclude`, or budget pruning. The estimate is intentionally
simple and offline (`chars_div_4`) so CLI and MCP callers get repeatable compact
JSON or Markdown without hosted summarization.

## Release Notes

`release_notes` is the stable local changelog document returned by
`todos release-notes --json` and `generate_release_notes`. It is generated from
completed local tasks plus linked plans, commits, verification records,
breaking-change metadata, and migration-note metadata. Markdown rendering uses
the same JSON object, so CLI, MCP, and SDK consumers can compare outputs
deterministically without hosted release tooling.

## Local Calendar And ICS

`calendar_event` is the stable event object returned by `todos calendar list
--json` and `list_calendar_events`. Events are derived locally from task due
dates, SLA thresholds, run ledgers, and authored reminders, milestones, or work
blocks.

`ics_export_result` is returned by `todos calendar export --json` and
`export_calendar_ics`. It contains the generated `text/calendar` content plus
the deterministic event list used to build it. Redacted exports replace event
summaries and descriptions without calling hosted calendar services.

## Kanban Boards

`task_board` is the stable local board definition returned by
`todos board create --json`, `todos board list --json`, and `create_board`.
It stores the board scope, local filters, workflow lanes, and WIP limits in
SQLite, with no hosted web dependency.

`board_snapshot` is returned by `todos board show --json`, `todos board tui
--json`, and `get_board_snapshot`. It includes rendered lane cards,
blocked/ready badges, WIP limit state, totals, and terminal key bindings for
agent-native board navigation.

## Time Tracking And Focus Sessions

`focus_session` is the stable local timer object returned by `todos time start`,
`todos time pause`, `todos time resume`, `todos time stop`,
`list_focus_sessions`, and related MCP focus tools. A completed task-linked
focus session writes a task time log and rolls up `task.actual_minutes`.

`time_report_entry` is returned by `todos time report --json` and
`get_time_report` with `format=json`. It combines task estimates, rolled-up
actual minutes, manual time logs, and linked focus sessions for local planning
and retrospective reports.

## Environment Snapshots

`environment_snapshot` is the stable local reproducibility bundle returned by
`todos env-snapshot capture` and `capture_environment_snapshot`. It includes
Bun and Node versions, package-manager state, git status, config hashes,
command environment metadata, and redacted dependency manifests.

`environment_snapshot_comparison` is returned by `todos env-snapshot compare`
and `compare_environment_snapshots` to explain drift between two local task or
run verification contexts.

## Local Event Hooks

`local_event_hook` is the stable config object returned by
`todos event-hooks list`, `todos event-hooks set`, `list_local_event_hooks`,
and `set_local_event_hook`. `local_event_hook_delivery` is the stable delivery
result returned by `todos event-hooks test` and `test_local_event_hook`.

## Terminal Notification Rules

`terminal_notification_rule` is the stable config object returned by
`todos terminal-notifications list`, `todos terminal-notifications set`,
`list_terminal_notification_rules`, and `set_terminal_notification_rule`.
`terminal_notification_evaluation` is returned by terminal notification tests
and watch-rule evaluation tools, including skipped reasons and generated local
terminal notification payloads.

`local_notification_check` is returned by `todos notifications check --json` and
`check_local_notifications`. It includes due, due-soon, SLA, stale task,
completed run, and local calendar reminder alerts plus optional local event hook
delivery results, terminal rule evaluations, quiet-hours state, counts, and
warnings.

## Branch Work Plans

`branch_work_plan` is returned by `todos branch-plan` and
`create_branch_work_plan`. It captures the local task or plan scope, branch and
base branch, planned files, active local file conflicts, git status, safety
reasons, and suggested local commands for branch setup and traceability.

## Natural-Language Intake

`natural_language_intake_preview` is returned by `todos inbox parse` and
`preview_natural_language_intake`. It captures the redacted source text, parsed
project and plan proposals, task previews, dependency edges, acceptance
criteria, dry-run/apply state, created records when applied, parser warnings,
and equivalent local CLI commands. Parsing is deterministic and local-only.

## Local Encryption

`local_encryption_profile` is the stable config object returned by
`todos encryption list`, `todos encryption set`, `list_encryption_profiles`,
and `set_encryption_profile`. Profiles store algorithm metadata, a nonsecret
salt, and the environment variable name that supplies key material.

`local_encryption_envelope` is the encrypted JSON value shape returned by local
field encryption helpers and MCP value tools. `encrypted_local_bridge_bundle`
wraps a bridge export so tasks, evidence, artifact content, and metadata are not
stored as plaintext JSON.

## Local Bridge Bundles

`onboarding_fixture` describes bundled local demo fixtures that are safe for
CLI, MCP, and SDK smoke tests. Each fixture summary declares that it is
local-only, no-network, and redacted, lists the workflow steps it demonstrates,
and exposes bridge-bundle stats so consumers can assert project, task, plan,
run, evidence, saved-view, and board coverage before importing.

`local_snapshot` is the stable context refresh shape returned by
`todos snapshots --show`, `get_local_snapshot`, and
`todos://snapshots/<type>` resources. Snapshot types cover projects, tasks,
plans, runs, dependencies, local activity events, and evidence summaries.
Every snapshot includes local-only/no-network flags, redaction status, filters,
a cursor, a stable fingerprint, and resource hints.

`local_snapshot_poll_result` is returned by `todos snapshots --poll` and
`poll_local_snapshots`. It lets agent clients pass the last cursor and receive
only snapshots whose local cursor advanced, without a hosted event stream.

`sdk_integration_fixture_pack` is returned by `todos sdk-fixtures --show` and
`createSdkIntegrationFixturePack`. It includes local package metadata,
seeded fixture database identifiers, copy-pasteable example inventory, stable
JSON contract snapshots, CLI/MCP parity metadata, local snapshot resources,
project/task/plan/run/evidence snapshots, and one agent context pack.

`local_bridge_bundle` is the stable offline import/export shape for moving local
`@hasna/todos` data between stores. It contains versioned package metadata,
source scope, grouped records for projects, task lists, plans, tasks,
dependencies, comments, runs, run evidence, file evidence, git refs, commits,
verification records, saved search views, local board definitions, and local
calendar items.

`local_bridge_import_result` is returned by dry-run and applied imports. It
reports inserted counts, skipped counts, conflicts, and validation issues so a
caller can inspect what would change before writing to local SQLite.

When bridge or embedded `todos.md` imports run with safe conflict resolution,
the result also reports `merged` counts. Divergent task conflicts include the
affected `fields` and a `resolution` of `manual_required`; the importer fills
blank local fields, unions tags, merges non-conflicting metadata, and records a
`metadata.sync_conflicts` note without overwriting local edits.

## CLI/MCP Parity Manifest

`cli_mcp_parity_manifest` is the stable machine-readable shape for the
side-effect-free CLI/MCP parity registry. It records local-only package metadata,
the covered task/project/plan/run/comment/search/import/export domains, matching
MCP tools, JSON contracts, error contracts, and intentional gaps.

## Project Bootstrap Result

`project_bootstrap_result` is returned by local workspace bootstrap commands.
It includes dry-run status, workspace discovery, the registered project, the
default task list, source records, and created flags. Dry-runs return null for
the project and task list because no local SQLite rows are written.
