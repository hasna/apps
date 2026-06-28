# @hasna/todos

Universal task management for AI coding agents - CLI + MCP server + interactive TUI

[![npm](https://img.shields.io/npm/v/@hasna/todos)](https://www.npmjs.com/package/@hasna/todos)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

## Install

```bash
bun install -g @hasna/todos
```

## CLI Usage

```bash
todos --help
```

Generate shell completions directly from the registered CLI command tree:

```bash
todos completions bash > ~/.local/share/bash-completion/completions/todos
todos completions zsh > ~/.zsh/completions/_todos
todos completions fish > ~/.config/fish/completions/todos.fish
```

Print the local CLI manual when you need install/update commands, examples,
JSON output contracts, error behavior, and the command catalog:

```bash
todos manual
todos manual --json
```

Deterministic loops can upsert a task by stable fingerprint without creating
duplicates. The fingerprint is stored as `metadata.fingerprint`, and later
upserts shallow-merge metadata so expectation fields can be refreshed safely:

```bash
todos --json task upsert \
  --fingerprint "loop:expectation:key" \
  --title "Expectation failed" \
  --metadata-json '{"expectation_id":"exp-1"}' \
  --evidence-paths "logs/loop.txt" \
  --expected '{"status":"ok"}' \
  --observed '{"status":"failed"}'
```

## Terminal Dashboard

`todos dashboard` launches a local Ink TUI with keyboard tabs for overview,
projects, tasks, plans, runs, dependencies, inbox, and search. It reads only the
local SQLite database and can also print deterministic snapshots for scripts or
tests:

```bash
todos dashboard
todos dashboard --snapshot --view tasks --search "release" --json
```

Keyboard hints are shown in the interface: `h`/left and `l`/right move between
tabs, `1`-`8` jumps to a tab, `/` opens local search, `r` refreshes, and `q`
quits.

## Local Project Bootstrap

Bootstrap discovers the current local workspace, registers a project identity,
creates the default task list, records local source metadata, and works for
monorepo package roots without contacting hosted services:

```bash
todos project-bootstrap .
todos project-bootstrap packages/cli --name todos-cli --task-list todos-cli
todos project-bootstrap . --dry-run --json
```

MCP clients can use `bootstrap_project` for the same local-only workflow. The
command is idempotent, so running it again refreshes machine-local paths without
duplicating projects, task lists, or source records.

## Local Machine Topology

Machine registry state stays in local SQLite. Machines can record identity,
last-seen heartbeats, workspace paths, git roots, and user-provided Tailscale
or LAN addresses without probing the network:

```bash
todos machines register spark01 --ssh hasna@spark01 --tailscale-name spark01.tailnet --tailscale-ip 100.64.0.10 --lan-address 192.168.8.10 --workspace ~/workspace
todos machines heartbeat spark01 --workspace ~/workspace
todos machines topology --json
todos machines sync --machine spark01 --dry-run --json
todos machines sync --machine spark01 --push
todos machines sync --ssh hasna@spark01 --dry-run
todos projects-path set <project-id> ~/workspace/my-project
```

`todos machines topology` reports stale machines, missing local path overrides,
missing local paths, and projects whose machine-local paths differ across
registered machines. MCP clients can use `machines_register`,
`machines_heartbeat`, `machines_topology`, and `machines_list` for the same
offline diagnostics.

`todos machines sync` exchanges the same local bridge bundles used by
`todos export --format bridge` over SSH. Pulls import remote projects, task
lists, plans, tasks, comments, run evidence, boards, calendar items, and stored
artifact contents with dry-run-first reporting and safe conflict recording.
`--push` sends the local bundle back to the peer and asks the peer's installed
`todos bridge-import` to apply or preview it. No hosted service is contacted;
use `--ssh` for a one-off bootstrap peer before it has a registered machine
address.

## Local Workspace Trust

Workspace trust profiles live in `~/.hasna/todos/config.json` and keep agent
permissions local. Profiles declare trusted roots, command allowlists and
denylists, tool permissions, write scopes, environment-key redaction patterns,
and whether unsafe checks should require an explicit prompt:

```bash
todos trust add . --preset standard --allow-command bun,git,todos --write-scope src,tests --redact-env API_KEY,TOKEN
todos trust status .
todos trust check . --command "bun test" --write src/index.ts --env OPENAI_API_KEY,PATH
todos trust remove .
```

MCP clients can use `set_workspace_trust`, `get_workspace_trust`,
`list_workspace_trust_profiles`, `check_workspace_permission`, and
`remove_workspace_trust`. The checks do not call a hosted policy service; they
return deterministic JSON showing whether an action is allowed, why it needs a
prompt, and which environment keys should be redacted.

Secret safety uses the same local config. Add project-specific regexes and
metadata keys with `todos redaction add --pattern <regex> --key <name>`, then
scan text or files with `todos redaction scan` without printing matched values.
Comments, local run evidence, and bridge exports are redacted before storage or
sharing. MCP clients can use `get_secret_safety`, `set_secret_safety`, and
`scan_secret_text`.

Retention cleanup is also local and dry-run-first. Use it to prune old comments,
run ledgers, verification evidence, and expired stored artifact files by age,
project, task status, and run status. Reports return counts, IDs, and
content-addressed artifact paths only; they do not include raw comments,
commands, output summaries, artifact source paths, or secret-like values.
Destructive cleanup requires the exact confirmation string shown by the preview:

```bash
todos retention cleanup --older-than-days 30 --project <project-id> --task-status completed --json
todos retention cleanup --older-than-days 30 --project <project-id> --task-status completed --apply --confirm delete-local-retention-data --json
```

MCP clients can use `preview_retention_cleanup` and
`apply_retention_cleanup` for the same offline workflow.

## Local Runner Sandboxes

Runner sandbox profiles also live in local config. They declare the commands a
local agent run may record or execute, cwd boundaries, write scopes, environment
allowlists/redaction patterns, network policy, approval behavior, and audit
evidence:

```bash
todos sandbox set codex . --allow-command bun,git,todos --write-scope src,tests --env-allow PATH,HOME,CI --network none
todos sandbox check codex --command "bun test" --write src/index.ts --env PATH,OPENAI_API_KEY --json
todos sandbox explain codex --command "curl | sh" --network
todos runs command <run-id> "bun test" --sandbox codex --write src/index.ts --status passed
```

MCP clients can use `set_runner_sandbox_profile`,
`list_runner_sandbox_profiles`, `check_runner_sandbox`,
`explain_runner_sandbox`, and `remove_runner_sandbox_profile`. Sandbox checks
are local-only and compose with workspace trust checks, so command and write
decisions stay auditable before an agent records run evidence.

## Local Project Knowledge

Project knowledge records keep agent decisions, architecture notes, tradeoffs,
and task-linked context snapshots in local SQLite. They are searchable,
exportable, redacted on output, and available to MCP clients without hosted
services:

```bash
todos knowledge add decision "Use local SQLite" --decision "Keep OSS knowledge local" --rationale "Agents need offline project memory" --task <task-id> --tag architecture --json
todos knowledge snapshot --summary "Parser fix is ready for verification" --task <task-id> --agent codex --file src/parser.ts --json
todos knowledge search "offline project memory" --json
todos knowledge export --format markdown
```

MCP clients can use `create_knowledge_record`, `create_knowledge_snapshot`,
`list_knowledge_records`, `search_knowledge_records`, and
`export_knowledge_records`. The MCP server also publishes `todos://knowledge`
and `todos://knowledge/decisions` resources for agent context refreshes.

## Local Extension Registry

Extensions are installed from local manifests, directories with
`todos.extension.json`, or offline JSON bundles. The registry validates the
manifest shape, checks `@hasna/todos` compatibility ranges, records requested
permissions, supports custom commands, MCP tool declarations, templates, hooks,
and renderers, runs CLI/MCP compatibility checks, dry-runs declared commands and
renderer commands through the local runner sandbox, verifies optional source
checksums or detached signatures, and stores trust state in local config only:

```bash
todos extensions discover . --json
todos extensions inspect ./todos.extension.json --json
todos extensions compat ./todos.extension.json --json
todos extensions install ./todos.extension.json --checksum sha256:... --trust --json
todos extensions verify ./bundle.todos-extension.json --signature <signature> --public-key "$PUBLIC_KEY"
todos extensions list
todos extensions remove my-extension
```

Unsigned extensions are allowed but installed as local records with warnings.
Without `--trust`, installs remain in `needs_review` so agents can discover
custom commands, MCP tools, hooks, and permissions without treating them as
approved. MCP clients can use `inspect_local_extension`,
`test_local_extension_compatibility`, `install_local_extension`,
`list_local_extensions`, and `remove_local_extension` for the same offline
workflow.

## Local Workflow Prompts

The package includes bundled MCP prompts for common agent workflows:
`goal_planning`, `task_claiming`, `review`, `verification`, `handoff`,
`release_prep`, `import_triage`, and `incident_response`. They are static,
local-only prompt resources that can be listed or rendered without a model call:

```bash
todos workflows list
todos workflows show goal_planning --objective "Ship release" --task 1234abcd --json
todos workflows export --format markdown
```

MCP clients can discover the same catalog at `todos://workflow-prompts` and call
the matching prompt by ID. Prompt output is deterministic and is intended for
Codex, Claude Code, Takumi, and other agent-native clients that need reusable
local guidance for planning, claiming, review, verification, handoff, release,
triage, and incident workflows.

Agent setup recipes for MCP registration, `/goal` planning, task
claim/update/complete loops, evidence comments, and no-cloud verification live
in [docs/agent-adapters.md](docs/agent-adapters.md).

## Local Policy Packs

Policy packs are project-local done gates for agents. They validate task status,
passed verification commands, prohibited commands, linked commits and pull
requests, approvals, branch names, run ledgers, artifacts, changed paths, and
minimum evidence counts from the local SQLite database and config only:

```bash
todos policies set release . \
  --required-status completed \
  --required-command "bun test,bun run typecheck" \
  --prohibited-command "npm install -g,git reset --hard" \
  --require-passed-verification \
  --require-commit \
  --require-pr \
  --require-run \
  --require-artifact
todos policies validate release <task-id> --json
todos policies explain release <task-id>
```

MCP clients can use `set_policy_pack`, `list_policy_packs`,
`validate_policy_pack`, `explain_policy_pack`, and `remove_policy_pack`.
Validation is a dry local read of recorded task evidence; it never calls a
hosted enforcement service.

## Local Source TODO Index

Source extraction scans local code for `TODO`, `FIXME`, `HACK`, `BUG`, `XXX`,
and `NOTE` comments, respects `.gitignore` plus explicit excludes, records
source files, line anchors, nearby symbols, and stable dedupe fingerprints, and
can run as a finite local watcher:

```bash
todos extract . --dry-run --index --json
todos extract . --exclude fixtures/** --tags tech-debt
todos extract-watch . --dry-run --max-runs 1 --json
```

Created tasks are tagged with `extracted` and linked back to the source file.
MCP clients can call `extract_todos` and `watch_source_todos` for the same
offline workflow; no hosted code search, cloud sync, or telemetry is used.

## Local Editor Integrations

Editor recipes live in `docs/editor-integrations.md` and
`examples/editor-integrations/`. They include VS Code task definitions,
JetBrains external tool recipes, Neovim Lua helpers, a shell statusline snippet,
and a Bun task picker. Every example uses only `todos` CLI JSON output or MCP
tool names, so editors can claim tasks, inspect local queues, build context
packs, and link source files without importing private modules or hosted code.

## Task Contracts and Reviews

Task contracts make acceptance criteria, required verification, expected
artifacts, relevant files, risk, and review state machine-readable for agents:

```bash
todos contracts set <task-id> \
  --criteria "Parser handles quotes;Parser rejects malformed checkboxes" \
  --verify "bun test src/parser.test.ts" \
  --artifact logs/parser.txt \
  --file src/parser.ts \
  --risk medium \
  --done "review approved" \
  --json
todos contracts request-review <task-id> --requester codex --reviewer reviewer
todos record-verification <task-id> "bun test src/parser.test.ts" --status passed --artifact logs/parser.txt
todos contracts review <task-id> --state approved --reviewer reviewer
todos contracts check <task-id> --json
```

Contracts are stored in local task metadata, mirror acceptance criteria for
context packs, and are checked only against local status, review state, and
recorded verification evidence. MCP clients can use `set_task_contract`,
`get_task_contract`, `request_task_review`, `record_task_review`, and
`check_task_done_contract`.

## Local Approval Gates

Approval gates are manual checkpoints stored in the local task database. Agents
can require, approve, reject, expire, list, and check gates before risky plan or
run work. Blocked checks exit nonzero, including JSON mode, so local automation
cannot silently bypass a missing or denied checkpoint:

```bash
todos approvals require <task-id> deploy --requester codex --reviewer reviewer --run <run-id> --reason "production-affecting action"
todos approvals check <task-id> deploy --json
todos approvals approve <task-id> deploy --reviewer reviewer --note "safe to proceed"
todos approvals list <task-id> --json
```

MCP clients can use `require_approval_gate`, `approve_approval_gate`,
`reject_approval_gate`, `expire_approval_gate`, `check_approval_gate`, and
`list_approval_gates`. Gate events are written to task audit history and, when
a run is linked, to the local run ledger.

### OpenAutomations Approval And Evidence Handoff

OpenAutomations approval gates can be mirrored to Todos approval gates when an
automation action affects external systems, spends money, mutates production
state, or needs human consent. Use the automation run id as the linked run or
metadata reference, and keep the approval decision id in task/run evidence:

```bash
todos approvals require <task-id> automation:<action-id> \
  --requester automations \
  --reviewer operator \
  --reason "OpenAutomations action requires consent"
todos approvals approve <task-id> automation:<action-id> \
  --reviewer operator \
  --note "Approved action execution"
todos record-verification <task-id> "automations queue complete <action-id>" \
  --status passed \
  --summary "Action completed by runner open-loops:<worker-id>"
```

Todos owns task approvals, task comments, verification evidence, audit-ledger
checkpoints, and release evidence. OpenAutomations owns automation specs,
action queue leases, DLQ/replay, and action approval state. Store only redacted
summaries, action ids, run ids, decision ids, artifact paths, and verification
commands in Todos; do not store raw event payloads, secret values, connector
tokens, or full action inputs unless the task explicitly requires them and they
have been redacted.

## Local Review Queues

Review queues turn local task review into an explicit agent workflow: request a
review, route it to a queue, claim it, return it with changes, reopen it, or
approve it. Routing rules live in local config and can match tags, priorities,
and projects without hosted users, orgs, or cloud services:

```bash
todos reviews rules set security --queue security-review --reviewers reviewer --tags security --priorities high
todos reviews request <task-id> --requester codex --reason "security-sensitive change"
todos reviews claim <task-id> --reviewer reviewer
todos reviews return <task-id> --reviewer reviewer --changes "Add tests;Record verification"
todos reviews approve <task-id> --reviewer reviewer
todos reviews list --queue security-review --json
```

MCP clients can use `list_review_queue`, `request_review_queue`,
`claim_review_item`, `return_review_item`, `approve_review_item`,
`reopen_review_item`, `set_review_routing_rule`, `list_review_routing_rules`,
and `remove_review_routing_rule`. Queue transitions are written to audit
history and emitted to local event hooks as `review.requested`,
`review.claimed`, `review.returned`, `review.approved`, and `review.reopened`.

## Local Roadmaps

Roadmaps group local tasks, plans, runs, milestones, and release labels into a
portable planning view. They live in local config, summarize dependency
readiness from the task graph, and export deterministic JSON or Markdown
bundles:

```bash
todos roadmaps create "Public package launch" --release v1 --json
todos roadmaps milestones add <roadmap-id> "Docs and examples" --tasks <task-id> --due 2026-06-01 --release v1 --json
todos roadmaps releases set <roadmap-id> v1 --milestones <milestone-id> --release-version 1.0.0 --json
todos roadmaps show <roadmap-id> --format markdown
todos roadmaps export <roadmap-id> --out roadmap.json
todos roadmaps import roadmap.json --apply --json
```

MCP clients can use `create_roadmap`, `list_roadmaps`,
`get_roadmap_summary`, `update_roadmap`, `delete_roadmap`,
`create_milestone`, `update_milestone`, `delete_milestone`,
`set_release_group`, `export_roadmap`, and `import_roadmap`.

## Local Event Hooks

Event hooks are local subscriptions for task, plan, run, approval, import, and
export events. They can append redacted JSONL to a file, deliver to a Unix
socket, expose a stdout test payload, or run a sandbox-checked local script with
retry/backoff and SHA-256 integrity metadata:

```bash
todos event-hooks set audit --event task.completed,run.failed --target file --file .todos/events.jsonl
todos event-hooks set notify --event task.blocked --target script --command "notify-send \"$TODOS_EVENT_TYPE\"" --sandbox codex --attempts 2
todos event-hooks test audit --event task.completed --payload '{"id":"demo"}' --json
todos event-hooks list --json
```

MCP clients can use `set_local_event_hook`, `list_local_event_hooks`,
`test_local_event_hook`, and `remove_local_event_hook`. Hook delivery is
local-only; it does not call hosted webhooks or cloud automation services.

## Shared Event Webhooks

Task lifecycle changes also emit shared `@hasna/events` events with source
`todos`. Use `todos webhooks` for durable command or webhook subscriptions. This
is the preferred bridge for automation that should react to new tasks without
polling:

```bash
todos webhooks add loops \
  --id openloops-task-created \
  --transport command \
  --source todos \
  --type task.created \
  --metadata 'project_path=/home/hasna/workspace/hasna/opensource/*' \
  --metadata-json 'route_enabled=true' \
  --metadata-json 'automation.no_auto!=true' \
  --metadata-json 'automation.manual_required!=true' \
  --metadata-json 'automation.requires_approval!=true' \
  --metadata-json 'automation.approval_required!=true' \
  --arg=events \
  --arg=handle \
  --arg=todos-task \
  --arg=--provider \
  --arg=codewith \
  --arg=--auth-profile-pool \
  --arg=account004,account005,account006 \
  --arg=--permission-mode \
  --arg=bypass \
  --arg=--sandbox \
  --arg=danger-full-access \
  --arg=--worktree-mode \
  --arg=required \
  --timeout-ms 900000 \
  --json
```

When a task is created, `@hasna/events` sends the event JSON on stdin and in
`HASNA_EVENT_JSON`. OpenLoops uses that event to create a deduped one-shot
worker/verifier workflow for the task. Use account-profile pools instead of a
single pinned profile, and require isolated worktrees for repo-mutating routes.
The event data includes task identity,
title, description, project/list ids, working directory, tags, metadata, status,
priority, approval state, and timestamps. Event metadata includes routing-safe
project/list/path fields, `route_enabled` when the task metadata opts in, and an
`automation` object containing only boolean routing gates such as `no_auto`,
`manual_required`, `requires_approval`, and `approval_required`.

Production task-created routes should fail closed:

- Require one explicit opt-in, either task metadata `route_enabled=true` or an
  approved routing tag such as `auto:route`.
- Add negative automation predicates so `no_auto`, manual, and approval-gated
  tasks do not invoke the route.
- Scope by project path, task list, tags, or repo metadata before invoking
  OpenLoops.
- Avoid overlapping opt-in channels for the same task family unless the target
  handler is idempotent. `loops events handle todos-task` dedupes by task id and
  event type, but a narrower subscription still avoids wasted invocations.

For tag opt-in, use a second route with the same deny predicates and
`--data 'tags=auto:route'` instead of `--metadata-json 'route_enabled=true'`.
Tasks without one of those opt-ins are intentionally no-route. Local event hooks
remain available for local-only JSONL/socket/script integrations.

## Local Terminal Notifications

Terminal notification rules are local watch rules for agents that want concise
event signals in a shell, tmux pane, or editor terminal. Rules match task, run,
plan, approval, import, and export events by severity, agent, project, priority,
status, and payload text, then render deterministic line or JSON notifications:

```bash
todos terminal-notifications set blocked --event task.blocked,task.failed --min-severity warning --agent codex --priority high --contains deploy --bell
todos terminal-notifications set due --event task.due,task.sla_breached --min-severity warning --quiet-hours 22:00-07:00
todos notifications check --emit-hooks --terminal --quiet-hours 22:00-07:00 --json
todos terminal-notifications test blocked --event task.failed --payload '{"id":"demo","title":"Deploy failed","agent_id":"codex","priority":"high"}' --json
todos terminal-notifications list --json
```

MCP clients can use `set_terminal_notification_rule`,
`list_terminal_notification_rules`, `test_terminal_notification_rule`,
`evaluate_terminal_watch_rules`, `check_local_notifications`, and
`remove_terminal_notification_rule`. Notifications are evaluated from local
event payloads, can respect quiet hours, and do not require a desktop
notification daemon, hosted queue, or cloud webhook service.

## Local Encryption Profiles

Encryption profiles are optional local config entries for sensitive fields and
secure bridge exports. Profiles store algorithm metadata, a nonsecret salt, and
the name of the environment variable that contains key material. The key itself
is never written to config, bundles, artifacts, or logs:

```bash
export TODOS_ENCRYPTION_KEY="use a strong local passphrase from your secret manager"
todos encryption set default --key-env TODOS_ENCRYPTION_KEY
todos encryption status default --json
todos encryption test default --json
todos export --format bridge --encrypt --output todos-bridge.enc.json
todos bridge-import todos-bridge.enc.json --decrypt --json
todos bridge-import todos-bridge.enc.json --decrypt --apply
```

Plain bridge exports are still supported for compatibility, but the CLI prints
a warning because bridge bundles may contain task metadata, evidence summaries,
comments, and stored artifact content. MCP clients can use
`set_encryption_profile`, `list_encryption_profiles`,
`get_encryption_status`, `encrypt_local_value`, `decrypt_local_value`, and
`remove_encryption_profile` for local-only encrypted field workflows.

## Local Agent Run Queue

Agent run adapters and queue entries are local. Queueing a task creates a run
ledger immediately, then `run-next` launches the configured command template
with `{task_id}`, `{run_id}`, and `{agent_id}` placeholders. Dry-runs show the
command without execution, and cancellation/retry are recorded in the same local
run ledger:

```bash
todos agent-runs adapter-set codex --command "codex exec --task {task_id}" --sandbox codex
todos agent-runs queue <task-id> --adapter codex --agent codex --claim --json
todos agent-runs run-next --dry-run --json
todos agent-runs run-next --json
todos agent-runs retry <run-id>
```

MCP clients can use `set_agent_run_adapter`, `queue_agent_run`,
`list_agent_run_queue`, `run_next_agent_dispatch`,
`cancel_agent_run_dispatch`, and `retry_agent_run_dispatch`. These commands
launch only local processes and do not call hosted runners.

## Local Agent Replay Simulation

Replay simulation turns a recorded context pack or run fixture into a
deterministic dry-run snapshot without opening the project database or mutating
tasks. Use it to debug agent plans, verification commands, task transitions,
failures, touched files, artifacts, and approval decisions offline:

```bash
todos context-pack <task-id> --format json > replay.json
todos runs simulate replay.json --agent codex --scenario parser-failure --json
todos runs simulate replay.json --format markdown
```

MCP clients can use `simulate_agent_replay` with a fixture object and optional
`agent_id` or `scenario`. The simulator redacts fixture values before hashing
or rendering, reports `mutates_database: false`, and emits stable command,
approval, failure, file, artifact, and warning summaries for local debugging.

## Local Dependency Workflows

Dependencies are stored in the local SQLite database and never require hosted
services. Use them to keep agents from starting blocked work:

```bash
todos deps <task-id> --needs <blocking-task-id>
todos deps <task-id> --graph
todos blocked
todos ready
```

The same workflow is available to MCP clients through
`add_task_dependency`, `remove_task_dependency`, `get_task_dependencies`, and
`get_blocked_tasks`. Dependency writes reject cycles, `ready` omits locked or
blocked pending tasks, and startup schema repair recreates the local dependency
table for older databases.

## Local Risk Register And Health

Risks are stored in local SQLite and can be linked to projects, plans, or tasks
with an owner, mitigation, due date, severity, probability, tags, and metadata:

```bash
todos risks add "Release blocker" --plan 1234abcd --severity high --owner codex --mitigation "Ship fallback" --json
todos risks list --plan 1234abcd --json
todos risks score --plan 1234abcd --json
todos risks export --project my-project --json
```

Health reports score a plan or project from local evidence only: blocked tasks,
overdue open work, failed verification records, failed run ledgers, dependency
depth, and open risks. MCP clients get the same surface through `create_risk`,
`list_risks`, `update_risk`, `close_risk`, `score_plan_health`,
`score_project_health`, and `export_risk_register`.

## Local Retrospectives

Retrospectives summarize a project or plan using local evidence: completed
plans, missed estimates, repeated blockers, failed verification records,
lessons learned, and suggested follow-up tasks.

```bash
todos retrospectives create --plan 1234abcd --json
todos retrospectives list --project my-project --json
todos retrospectives export --plan 1234abcd --format markdown
```

Use `--create-followups` to create the suggested follow-up tasks locally. MCP
clients get the same reports through `create_retrospective`,
`list_retrospectives`, and `export_retrospectives`.

## Local Agent Reliability Scorecards

Reliability scorecards summarize each agent from local evidence only: completed
and failed tasks, passed and failed verification records, failed run ledgers,
stale task/resource locks, retry history, and handoff quality.

```bash
todos reliability show codex --json
todos reliability list --project my-project --json
todos reliability export --format markdown
```

MCP clients get the same summaries through `get_agent_reliability_scorecard`,
`export_agent_reliability_scorecards`, and the `todos://agents/reliability`
resource.

## Local Agent Reports

Agent reports compose the local planning surfaces into one report for standups,
handoffs, and agent run planning: ready tasks, blocked tasks, overdue work,
plan progress, run outcomes, verification evidence, and per-agent summaries.

```bash
todos reports local --agent codex --format markdown
todos reports local --project <project-id> --json
```

MCP clients can list sections with `list_local_report_types` and build the
same local-only `local_report` contract with `build_local_report`. The report
uses the local SQLite store only and does not call hosted analytics or external
services.

## Local Agent Locking

Task claims and locks are local SQLite leases. Agents can claim the next ready
task, renew their lock by re-locking it during long work, inspect stale work,
and safely steal or redistribute stale tasks without hosted coordination:

```bash
todos claim codex
todos --agent codex lock <task-id>
todos stale --minutes 30
todos claim codex --steal-stale --stale-minutes 30
todos redistribute codex --max-age 60
```

MCP clients get the same local coordination through `claim_next_task`,
`lock_task`, `unlock_task`, `check_task_lock`, and `get_stale_tasks`.
`claim_next_task` can opt into stale recovery with `steal_stale` and
`stale_minutes`.

## Local Plan Templates

Reusable plan templates live in the local SQLite database. The package also
ships a marketplace-free local library for bug fixes, feature implementation,
security review, releases, migrations, incidents, docs refreshes, QA, and open
source package bootstraps. Templates can create one task or a full ordered plan
with dependencies, variables, priorities, tags, and descriptions:

```bash
todos template-library --json
todos template-library --write .todos/templates
todos template-init
todos template-preview <template-id> --var name=api
todos templates --use <template-id> --var name=api
todos template-export <template-id> > plan-template.json
todos template-import plan-template.json
```

`todos template-library --write` writes editable JSON files that use the same
shape as `todos template-import`, so teams can fork a built-in workflow without
contacting any hosted marketplace. `todos templates --use` creates every task in
a multi-task template and wires its local dependency graph, so agents can
immediately run `todos ready`, `todos blocked`, or
`todos deps <task-id> --graph` against the generated plan. The same local-only
workflow is available to MCP clients through `list_template_library`,
`write_template_library`, `init_templates`, `create_template`, `list_templates`,
`create_task_from_template`, `preview_template`, `export_template`, and
`import_template`.

## Local Git Traceability

Tasks can be linked to local git evidence without contacting hosted services:

```bash
todos link-commit <task-id> <sha> --message "fix parser" --files src/parser.ts
todos link-ref <task-id> task/parser-fix --type branch
todos link-ref <task-id> 42 --type pr --url https://github.com/hasna/todos/pull/42
todos record-verification <task-id> "bun test" --status passed --summary "1522 pass"
todos trace <task-id>
todos find-commit <sha-prefix>
todos find-ref <branch-or-pr>
todos blame src/parser.ts
```

MCP clients get the same local data through `link_task_to_commit`,
`find_task_by_commit`, `link_task_git_ref`, `find_tasks_by_git_ref`,
`add_task_verification`, and `get_task_traceability`, so agents can explain
which task changed a commit, branch, PR, file, or verification command.

## Local Mention Resolution

Agents can resolve task references before adding them to descriptions, plans, or
handoffs. The resolver validates local files and line anchors, scans local source
declarations for symbols, checks local git commits, branches, and fetched pull
request refs, and resolves plans, runs, tasks, and agents from the local SQLite
state:

```bash
todos references resolve file:src/index.ts:12 symbol:createTask branch:main --json
todos refs resolve plan:release run:abc123 agent:marcus --workspace .
```

The JSON output includes canonical reference keys and validated backlinks such
as `file:src/index.ts:12`, `symbol:createTask@src/index.ts:40`, `commit:<sha>`,
`plan:<id>`, and `run:<id>`. MCP clients can call `resolve_mentions` for the
same local-only report; pull request refs are validated only when present in
local git refs, and the resolver never calls hosted code search.

## Local Branch-Safe Work Plans

Before an agent starts a branch, it can ask for a local branch work plan that
checks the task or plan scope, planned files, active file conflicts, local git
status, and suggested branch/traceability commands:

```bash
todos branch-plan 1234abcd --branch task/parser-fix --path src/parser.ts --json
todos branch-plan --plan <plan-id> --branch task/release-plan --no-git-status --json
```

MCP clients can call `create_branch_work_plan` with `task_id` or `plan_id`.
The result is local-only: it does not create a branch, fetch from a remote, or
contact hosted code review services. Agents can inspect `safe_to_start`,
`conflicts`, `reasons`, and `commands` before running any git operation.

## Local Release Notes

Generate changelogs from completed local tasks and their linked plans, commits,
verification records, breaking-change notes, and migration notes:

```bash
todos release-notes --project . --format markdown
todos release-notes --tag release --since 2026-01-01T00:00:00.000Z --json
```

Tasks can add release metadata through `metadata.breaking_change`,
`metadata.breaking_changes`, `metadata.migration_note`, or
`metadata.migration_notes`. MCP clients use `generate_release_notes` for the
same deterministic JSON or Markdown output without hosted release tooling.

## Local Verification Providers

Optional provider adapters let agents standardize local verification without a
hosted dependency. Providers can classify CI logs, verify browser/screenshot
artifacts, or run explicitly configured command, script, and testbox-style
commands with retry and redacted evidence capture:

```bash
todos verify-providers set local --kind command --command "bun test" --attempts 2 --json
todos verify-providers set ci --kind ci_log --json
todos verify-providers capabilities local --json
todos verify-providers run local --task <task-id> --agent codex --json
todos verify-providers run ci --task <task-id> --log-file /tmp/ci.log --json
```

Blacksmith/testbox-style providers are inert until a local command is explicitly
configured, so the package never calls a cloud runner by default. MCP clients
use `set_verification_provider`, `list_verification_providers`,
`get_verification_provider_capabilities`, `run_verification_provider`, and
`remove_verification_provider` for the same local-only workflow.

## Local Agent Handoffs

Handoffs let one local agent leave continuation context for another without a
hosted inbox. A handoff records the session, referenced tasks, relevant files,
run ids, completed work, current blockers, and next steps. Readers can filter
for unread handoffs and acknowledge them per agent:

```bash
todos handoff --create --agent codex --session codex-42 --summary "Parser work ready for review" --tasks <task-id> --files src/parser.ts --runs <run-id> --next "Review failing fixture" --json
todos handoff --unread-for claude --json
todos handoff --read <handoff-id> --json
todos handoff --ack <handoff-id> --agent claude --json
todos handoff --recover --agent codex --session codex-42 --json
todos handoff --export <handoff-id> --output handoff.json --json
todos handoff --import handoff.json --json
todos handoff --import handoff.json --apply --json
```

MCP clients can use `create_handoff`, `list_handoffs`, `read_handoff`,
`export_handoff`, `import_handoff`, `acknowledge_handoff`,
`recover_stale_session_handoff`, and `get_latest_handoff`. Recovery handoffs
inspect local in-progress tasks, file links, and run evidence for the
agent/session and create a deterministic continuation packet; no hosted queue
or cloud service is involved. Handoff imports default to a dry-run preview;
`--apply` writes the local handoff and preserves per-agent acknowledgement
state.

## Local Run Ledger

Agent runs can record local evidence without uploading artifacts or calling a
hosted API:

```bash
RUN_ID=$(todos runs start <task-id> --agent codex --title "Parser fix" --claim --json | jq -r .id)
todos runs event "$RUN_ID" progress "writing regression tests"
todos runs command "$RUN_ID" "bun test src/parser.test.ts" --status passed --summary "14 pass"
todos runs file "$RUN_ID" src/parser.ts --status modified
todos runs artifact "$RUN_ID" logs/parser-test.txt --type log --description "focused test output" --require-file
todos runs artifact-verify "$RUN_ID"
todos runs finish "$RUN_ID" --status completed --summary "parser fixed and verified"
todos runs show "$RUN_ID"
```

Run command evidence is also mirrored into task verification evidence, file
events are linked to task file tracking, and comments can be recorded into the
task timeline. Sensitive-looking tokens, keys, passwords, and bearer values are
redacted before evidence is stored. Artifact files are copied into a local
content-addressed store beside the SQLite database, with SHA-256 integrity
metadata, redaction status, retention metadata, and metadata-only fallback when
the original path is unavailable. Use `--no-store` to record only artifact
metadata.

Loops that need bounded, idempotent JSON can use the transaction commands
instead of scripting around comments and run lookup:

```bash
todos runs begin <task-id> --key nightly:parser:42 --agent codex --title "Nightly parser loop"
RUN_ID=$(todos runs begin <task-id> --key nightly:parser:42 --agent codex --title "Nightly parser loop" --apply | jq -r .run.id)
todos findings upsert --task <task-id> --run "$RUN_ID" --fingerprint parser-timeout --title "Parser timeout" --severity high --source nightly-parser --artifact logs/parser-loop.txt --apply
todos findings resolve-missing --task <task-id> --source nightly-parser --fingerprints parser-timeout --run "$RUN_ID"
todos findings resolve-missing --task <task-id> --source nightly-parser --fingerprints parser-timeout --run "$RUN_ID" --apply
todos runs finish "$RUN_ID" --status completed --summary "nightly loop complete"
```

`runs begin` is dry-run by default and only creates a run when `--apply` is
provided. Reusing the same `--key`, `--loop-run-id`, or `--loop-id` returns the
existing compact run summary instead of creating duplicates. `runs finish` is
idempotent for already-finished runs and can resolve a run by `--key --task`.
Finding upserts are deduped by task and fingerprint, redacted before storage,
and expose only artifact paths/references by default. `findings upsert` and
`findings resolve-missing` are dry-run by default; add `--apply` to mutate local
state. MCP clients use `begin_task_run_transaction`, `finish_task_run`,
`upsert_task_finding`, `list_task_findings`, and
`resolve_missing_task_findings`; these compact loop tools are included in the
default `TODOS_PROFILE=minimal` surface.

## Local Time Tracking

Manual time logs and focus sessions stay in the local SQLite database and roll
up into `task.actual_minutes` for planning and retrospectives:

```bash
todos time log <task-id> 25 --agent codex --notes "reviewed parser"
SESSION=$(todos time start <task-id> --agent codex --idle-after 30 --json | jq -r .id)
todos time pause "$SESSION"
todos time resume "$SESSION"
todos time stop "$SESSION" --notes "implemented and tested"
todos time report --include-open --json
```

Focus sessions can be linked to tasks, plans, or run ledgers. Stopping a
completed task-linked session writes a time log with the session id and run id,
then recalculates actual minutes from all local logs. `todos time idle` and the
`get_idle_focus_prompts` MCP tool report active sessions that exceeded their
local idle threshold; no desktop notification service or hosted telemetry is
required.

## Local Capacity Forecasts

Capacity profiles give agents a local way to forecast whether a project or plan
is realistic from task estimates, actual minutes, due dates, and available
minutes per day:

```bash
todos capacity set codex --minutes-per-day 240 --days 1,2,3,4,5 --json
todos capacity forecast --plan <plan-id> --agent codex --start-date 2026-06-01 --json
todos capacity forecast --project <project-id> --format markdown
todos capacity list --json
```

Forecasts report remaining estimated minutes, logged actual minutes, forecast
work days, projected completion date, missing estimates, overdue open tasks,
and risk flags. MCP clients use `set_capacity_profile`,
`list_capacity_profiles`, `remove_capacity_profile`, and
`get_planning_forecast`.

## Local Audit Ledger

Audit ledger checkpoints hash local evidence into a deterministic chain so an
agent can seal task, run, verification, approval, and handoff records and verify
later that the local evidence still matches:

```bash
todos audit-ledger show --task <task-id> --entries --json
todos audit-ledger seal release-checkpoint --task <task-id> --json
todos audit-ledger verify release-checkpoint --json
todos audit-ledger list --json
```

The ledger stores only local checkpoint metadata in config. It does not call a
hosted service and it does not claim to prevent local deletion; it detects
changes against a previously sealed root hash. MCP clients use
`get_audit_ledger`, `seal_audit_ledger`, `list_audit_ledger_checkpoints`, and
`verify_audit_ledger`.

## Release Compatibility

Release compatibility checks give agents a local dry-run report before publish
or update work. They verify the package stays `@hasna/todos`, public, pointed at
`hasna/todos`, export-stable, migration-compatible from recent local schema
levels, and ready for Bun global install smoke tests:

```bash
todos release-compat check --json
todos release-compat check --format markdown
```

The report also includes changelog surfaces and rollback commands. MCP clients
use `check_release_compatibility` for the same `release_compatibility_report`
JSON contract.

## Local Usage Ledger

Usage reports summarize local tasks, projects, runs, commands, durations,
agent-provided token and cost metadata, and run artifact storage. Quota flags
are simulated locally so agents can check free/pro limits or project budgets
without sending data anywhere:

```bash
todos usage report --agent codex --max-tasks 1000 --max-projects 10 --json
todos usage report --project <project-id> --format markdown
```

The report is aggregate-only: raw command strings and artifact paths are not
included. MCP clients use `get_usage_ledger` for the same
`local_usage_ledger` JSON contract.

## Local Scale Hardening

Scale reports benchmark common local queries, count archive-ready terminal
tasks, check expected SQLite indexes, run integrity diagnostics, and preview
database compaction without network access:

```bash
todos scale report --older-than-days 30 --json
todos scale report --format markdown
todos scale compact --json
```

`todos scale compact --apply` runs `PRAGMA optimize` and `VACUUM` against the
local SQLite database. The default is a dry run.

## Local Activity Timeline

The timeline command gives agents one ordered, redacted view of local comments,
task history, run events, command evidence, and artifacts:

```bash
todos timeline --task <task-id> --json
todos timeline --project <project-id> --limit 50
todos timeline --run <run-id> --order asc
```

MCP clients can call `get_activity_timeline` with `entity_type`, `entity_id`,
`limit`, `offset`, `since`, and `until`. Timeline entries are derived from the
local SQLite store and local bridge exports already include the underlying
comments, runs, run evidence, files, commits, and verification records needed to
rebuild the same timeline after import.

## Local Scheduling and SLA Escalation

Tasks can carry local due dates, recurrence rules, and SLA thresholds without a
hosted scheduler. Recurring tasks spawn their next local task from the previous
scheduled due date, preserving cadence even when completion happens late:

```bash
todos add "Weekly review" --due 2026-06-01 --recurrence "every week" --sla-minutes 120 --json
todos update <task-id> --due 2026-06-08 --recurrence "every monday" --sla 90 --json
todos overdue --json
todos sla --json
todos notifications check --due-within-minutes 60 --stale-minutes 30 --terminal --json
```

`todos overdue` returns unfinished tasks past `due_at`. `todos sla` returns
unfinished tasks that are past `due_at` or whose `sla_minutes` threshold has
elapsed from `started_at` when present, otherwise `created_at`. MCP clients use
`create_task` and `update_task` with `deadline`, `recurrence_rule`, and
`sla_minutes`, and can call `get_sla_breaches` for the same local escalation
view. `todos notifications check` turns due, due-soon, SLA, stale task,
completed run, and local reminder records into redacted local alerts; it can
emit configured file/socket/script/stdout event hooks, evaluate terminal watch
rules, and suppress delivery during quiet hours without contacting an external
notification service.

## Local Task Fields

Tasks can carry local labels, severity, owner, area, and custom metadata while
keeping canonical priority on the task itself:

```bash
todos fields set <task-id> --labels bug,cli --priority high --severity s1 --owner codex --area parser --field component=parser --json
todos fields show <task-id> --json
todos fields query --labels bug,cli --severity s1 --field component=parser --json
```

Custom values are redacted before storage, labels are mirrored into task tags
for existing filters, and the metadata is included in local bridge exports.
MCP clients use `get_task_fields`, `set_task_fields`, and
`query_tasks_by_fields` for the same local-only workflow.

## Local Workflow States

Projects can define local workflow states such as review, blocked, verifying,
failed, or released while keeping storage compatible with the canonical task
statuses:

```bash
todos workflow states --json
todos workflow set <task-id> review --json
todos workflow tasks review --json
todos workflow migrate --apply --json
```

Workflow states live in local config under `workflow_states.states`. Each state
maps to a canonical `canonical_status`, can declare aliases, and can restrict
allowed transitions. The selected local state is stored in task metadata and is
included in local bridge exports. MCP clients use `list_workflow_states`,
`set_task_workflow_state`, `query_tasks_by_workflow_state`, and
`migrate_workflow_states`.

## Local Calendar And ICS

Calendar events are derived from local tasks, SLA thresholds, run ledgers, and
authored local reminders, milestones, or work blocks. Exported ICS files are
deterministic and can be redacted before sharing:

```bash
todos calendar list --from 2026-06-01T00:00:00.000Z --json
todos calendar add "Release milestone" --kind milestone --start 2026-06-01T09:00:00.000Z --json
todos calendar export --redact --out todos.ics
todos calendar import team.ics --json
```

Recurring task rules are mapped into ICS `RRULE` values when possible, and task
SLA thresholds appear as local calendar events without any Google Calendar,
hosted API, or cloud sync dependency. MCP clients use `create_calendar_item`,
`list_calendar_events`, `export_calendar_ics`, and `import_calendar_ics`.

## Local Saved Search Views

Saved views are local SQLite records for repeatable task, project, plan, run,
comment, and cross-entity searches. They can filter by query text, project,
task list, plan, task, status, priority, assignee, agent, tags, local fields,
dependency direction, and time windows:

```bash
todos views save active-cli --query parser --status pending,in_progress --tag cli --field-area parser --json
todos views list --json
todos views run active-cli --json
todos search parser --scope all --limit 50 --json
```

View output is stable JSON with `{ view, scope, filters, count, results }`.
Local bridge exports include saved views, so explicit backups and machine moves
preserve the filters without any hosted service. MCP clients use
`save_search_view`, `list_search_views`, `run_search_view`, and
`delete_search_view`.

## Local Kanban Boards

Boards are local SQLite records for task and plan workflow views. Lanes map to
workflow statuses, can carry WIP limits, and render blocked/ready badges for
agent planning:

```bash
todos board create local-flow --lane "Ready=pending" "Doing=in_progress:3" --json
todos board show local-flow
todos board tui local-flow --json
todos board move local-flow <task-id> --lane Doing --json
todos board export local-flow --json
```

Task boards render tasks; plan boards use `--scope plans` and render plans by
plan status. Board snapshots include terminal key bindings for keyboard/TUI
clients, but the state is still just local data and can be exported or imported
without a hosted web UI. MCP clients use `create_board`, `list_boards`,
`get_board_snapshot`, and `move_board_card`.

## Local Duplicate Detection

Agents can scan local tasks for likely duplicates from imported issue URLs,
stack traces, exact titles, and similar task text, then merge duplicate evidence
without deleting either task record:

```bash
todos dedupe scan --threshold 0.8 --json
todos dedupe merge <primary-task-id> <duplicate-task-id> --reason "same imported issue" --json
```

Merges archive the duplicate as `cancelled`, add a `duplicates` relationship,
and preserve comments, dependencies, dependents, run ledgers, files, inbox
items, verification evidence, history, git refs, commits, and checklist rows on
the primary task. MCP clients use `find_duplicate_tasks` and
`merge_duplicate_task` for the same local-only workflow.

## Local Agent Context Packs

Context packs create deterministic run-start bundles for Codex, Claude Code,
Takumi, or any local agent. A pack selects task, project, plan, dependencies,
acceptance criteria, recent comments, relevant files, verification history,
traceability, and run-ledger evidence from the local SQLite database only:

```bash
todos context-pack <task-id> --profile codex --format markdown
todos context-pack <task-id> --profile claude --format json
todos context-pack <task-id> --profile takumi --run <run-id> --comments 12 --files 40
todos context-pack <task-id> --profile codex --token-budget 1800 --exclude runs --compact
```

MCP clients can call `build_agent_context_pack` with the same limits and choose
JSON, Markdown, compact JSON, or compact Markdown output. Long text and evidence
are redacted and size-limited, and stale or omitted local data is surfaced as
warnings in the pack.

Budget-aware context packing is local and deterministic. Use `--token-budget`
for an approximate character-based token budget, `--include` or `--exclude` to
shape sections, and `--summary-chars` to cap the redacted summaries generated
for omitted evidence. When the pack is too large, lower-priority evidence such
as runs, traceability, comments, files, dependencies, and plan context is
summarized in a stable `context_budget` block so agents still know what was left
out.

## Local External Issue Imports

Import issue records from pasted JSON, files, stdin, or explicit URLs without
depending on any hosted Hasna service. Imports default to a dry-run preview;
`--apply` creates local tasks, stores redacted source metadata, creates linked
inbox evidence, and skips existing tasks that already have the same source URL,
GitHub owner/repo/number, or external issue key:

```bash
todos issues import --file issues.json --provider github --json
todos issues import --file issues.json --provider github --apply --json
todos issues import --provider linear --apply < linear-export.json
todos issues import "Title: Fix parser\nURL: https://tracker.example/BUG-42" --apply --json
```

GitHub, Linear, Jira, and plain URL records are normalized into local task
metadata and tags. Network access is off unless `--allow-network` is passed; for
GitHub that explicitly shells out through the authenticated `gh` CLI, while
offline files and pasted exports work without tokens. MCP clients use
`import_external_issues` with the same dry-run, apply, inbox, and dedupe
controls.

## Local Inbox Intake

Paste failures, CI logs, GitHub issue URLs, files, or local git context into a
deduped inbox and create a linked task:

```bash
todos inbox add "bun test failed: parser regression" --source-type ci_log
todos inbox add --file /tmp/ci.log --source-name "local CI"
todos inbox add https://github.com/hasna/todos/issues/42 --source-url https://github.com/hasna/todos/issues/42
todos inbox parse "Add task fix parser priority high @codex #cli due tomorrow" --json
todos inbox parse --file plan-notes.txt --apply --json
todos inbox git --diff
todos inbox list
```

Inbox bodies and metadata are redacted before storage. Repeated input resolves
to the existing inbox item instead of creating duplicate tasks. Natural-language
intake parsing is deterministic and local-only; it defaults to a dry-run preview
and creates projects, plans, tasks, dependencies, and acceptance criteria only
with `--apply`.

## Bundled Onboarding Fixtures

The package ships deterministic local demo fixtures for first-run onboarding and
agent integration tests. The default `agent-project-demo` fixture shows the
simple flow used by the public demo: create a project, add todos, generate a
plan, run an agent, record command/artifact/verification evidence, review the
remaining task, and prove export/import with the local bridge bundle.

```bash
todos onboarding --json
todos onboarding --show agent-project-demo > agent-project-demo.bridge.json
todos onboarding --import agent-project-demo --json
todos onboarding --import agent-project-demo --apply
```

Fixtures are bundled with `@hasna/todos`, redacted, offline, and local-only.
Imports default to dry-run mode and use the same bridge importer as normal
exports, so CLI, MCP, and SDK consumers can test against the exact project,
tasks, plan, run ledger, evidence, saved view, and board records.

MCP clients can read `todos://onboarding/fixtures` or
`todos://onboarding/demo`, then use `list_onboarding_fixtures`,
`get_onboarding_fixture`, and `import_onboarding_fixture`.

## Local Agent Snapshots

Agents can refresh context through stable local snapshots for projects, tasks,
plans, runs, dependencies, activity events, and evidence. Snapshots are
redacted, deterministic, and include cursors plus fingerprints so MCP clients
can poll for changes without a hosted event stream.

```bash
todos snapshots --json
todos snapshots --show tasks --json
todos snapshots --show evidence --markdown
todos snapshots --poll --types tasks,evidence --since 2026-05-22T00:00:00.000Z --json
```

MCP clients can read `todos://snapshots/catalog` and
`todos://snapshots/tasks` through `todos://snapshots/evidence`, or use
`list_local_snapshots`, `get_local_snapshot`, and `poll_local_snapshots` for
JSON or Markdown payloads.

## SDK Integration Fixtures

Downstream SDK, CLI JSON, MCP, and agent-adapter tests can generate a complete
local fixture pack from the bundled demo project:

```bash
todos sdk-fixtures --json
todos sdk-fixtures --show > sdk-fixture-pack.json
todos sdk-fixtures --write .todos/sdk-integrations --json
```

The pack includes a local bridge fixture, stable JSON contract snapshots,
project/task/plan/run/evidence snapshots, and a context pack. Copy-pasteable
examples live in `examples/sdk-integrations/`, and the full guide is in
`docs/sdk-integrations.md`.

## Local Bridge Import/Export

Export a versioned local bridge bundle for migration, backup, or explicit
hand-off to another local store:

```bash
todos export --format bridge --output todos-bridge.json
todos export --format bridge --encrypt --output todos-bridge.enc.json
todos bridge-import todos-bridge.json --json
todos bridge-import todos-bridge.json --apply
todos bridge-import todos-bridge.json --apply --resolve-conflicts
```

Bridge bundles include local projects, task lists, plans, tasks, dependencies,
comments, run ledgers, command evidence, file evidence, artifacts, stored
artifact contents, commits, refs, verification records, saved views, local board
definitions, and local calendar items. Imports default to dry-run mode and
report conflicts before writing. The package does not upload bundles or call
hosted services; machine sync transports these bundles over SSH, and any hosted
sync must consume the exported JSON explicitly.

For multi-machine local work, `--resolve-conflicts` performs a safe task merge
instead of overwriting local edits. It fills blank local fields from the
incoming bundle, unions tags, merges non-conflicting metadata keys, and records
unresolved divergent fields in `metadata.sync_conflicts` for manual review.
Local non-empty title, status, priority, and metadata values win when both sides
changed.

## Local Backups and Integrity

Create a checksum-protected local backup wrapper around the bridge bundle when
you need a restorable snapshot with manifest counts and SQLite integrity
metadata:

```bash
todos backup create --output todos-backup.json
todos backup verify todos-backup.json --json
todos backup restore todos-backup.json --json
todos backup restore todos-backup.json --apply --resolve-conflicts
todos backup integrity --json
```

Backups include the same local projects, task lists, plans, tasks, comments,
runs, commands, files, commits, refs, verification records, saved views, boards,
calendar items, and stored artifact contents as bridge exports. The backup
manifest adds SHA-256 checksums for the full payload, embedded bridge bundle,
and each bridge section. Restore defaults to dry-run mode and refuses corrupted
or schema-incompatible bundles before importing.

## todos.md Markdown Import/Export

`todos.md` files are readable Markdown checklists with an embedded local bridge
bundle for lossless round trips. Export keeps the visible tasks, projects, and
plans easy to inspect while preserving local ids, comments, run ledgers,
dependencies, files, commits, and verification evidence in a hidden metadata
block:

```bash
todos export --format todos.md --output todos.md
todos todos-md-import todos.md --json
todos todos-md-import todos.md --apply
todos todos-md-import todos.md --apply --resolve-conflicts
```

Existing plain checklists also import locally. Use `# Project: Name`, `## Plan:
Name`, checkbox items, optional `priority: high`, `comment: ...`, `depends_on:
Other task title`, `run: completed smoke`, `#tags`, and `@agent` markers to
migrate older files without a hosted service.

## Local Doctor and Repair

`todos doctor` audits the local SQLite database without calling hosted services.
By default it is a dry-run and reports schema/migration drift, orphaned rows,
duplicate indexes, invalid JSON metadata, missing project roots, and unsafe
database file permissions:

```bash
todos doctor
todos doctor --json
```

Safe repairs require explicit apply mode. Before any mutation, the command
creates a local backup next to the database when the database is file-backed:

```bash
todos doctor --apply
```

Repairs are limited to local integrity fixes such as running the migration
safety net, clearing missing parent references, pruning orphaned dependency/run
rows, resetting invalid metadata JSON to `{}`, dropping duplicate non-primary
indexes, and tightening database file permissions.

## MCP Server

```bash
todos-mcp
```

## HTTP mode

Shared Streamable HTTP transport for long-lived local MCP (stdio remains the default). MCP is mounted on the existing `todos-serve` HTTP server — no second server:

```bash
todos-mcp --http              # starts todos-serve with MCP mounted; or MCP_HTTP=1
todos serve --port 8842       # default MCP HTTP port 8842
```

- Bind: `127.0.0.1` only
- Health: `GET /health` → `{"status":"ok","name":"todos"}`
- MCP: `POST /mcp` on the same server as the dashboard/API (Streamable HTTP, stateless)

The MCP server defaults to the token-saving `TODOS_PROFILE=minimal` profile.
Use `TODOS_PROFILE=standard` for broader task/project/resource tools, or
`TODOS_PROFILE=full` when you explicitly need every tool. You can add groups
with `TODOS_TOOL_GROUPS=templates`.

High-volume tools return compact payloads by default. Pass `detail: "full"` to
MCP calls such as `get_task`, `get_status`, `get_context`, `bootstrap`, and
`task_context` when you need full data.

## REST API

```bash
todos-serve
```

Generate an API key before exposing the REST API to another app. Once at least one
generated key exists, all `/api/*` requests require `x-api-key` or
`Authorization: Bearer`.

```bash
todos api-keys create "My app"
todos-serve --host 0.0.0.0
```

Pass the generated key from your app as `x-api-key` or set `TODOS_API_KEY` for
the SDK client.

Agent callers can trim REST responses with field selectors:

```bash
curl "http://localhost:19427/api/tasks?fields=id,title,status,priority"
curl "http://localhost:19427/api/tasks/<id>?fields=id,title,status"
curl "http://localhost:19427/api/tasks/<id>/history?limit=20"
```

## Data Directory

Data is stored in `~/.hasna/todos/`.

## Local-Only Security Boundary

`@hasna/todos` is an open source, local-first package. The CLI, MCP server, SDK,
and local dashboard read and write local state by default and do not require a
hosted API, cloud account, billing provider, or remote model provider.

Release checks enforce that boundary before publishing:

- package metadata must stay public and point at `hasna/todos`
- install snippets must use `bun install -g @hasna/todos`
- package dependencies and generated tarballs are scanned for private or hosted
  service coupling
- public text surfaces and packed files are scanned for secret-like values
- local runtime tests use a no-network fixture for local-only workflows
- `bun run verify:release` builds, packs, validates provenance, and runs a clean
  Bun global install smoke test from the candidate tarball
- the install smoke plan itself is covered by tests: it installs only with Bun,
  verifies `todos`, `todos-mcp`, and `todos-serve`, and rejects private or
  hosted endpoint references

## License

Apache-2.0 -- see [LICENSE](LICENSE)
