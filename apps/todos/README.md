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

Reusable plan templates also live in the local SQLite database. They can create
one task or a full ordered plan with dependencies, variables, priorities, tags,
and descriptions:

```bash
todos template-init
todos template-preview <template-id> --var name=api
todos templates --use <template-id> --var name=api
todos template-export <template-id> > plan-template.json
todos template-import plan-template.json
```

`todos templates --use` creates every task in a multi-task template and wires
its local dependency graph, so agents can immediately run `todos ready`,
`todos blocked`, or `todos deps <task-id> --graph` against the generated plan.
The same local-only workflow is available to MCP clients through
`create_template`, `list_templates`, `create_task_from_template`,
`preview_template`, `export_template`, and `import_template`.

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

## Local Inbox Intake

Paste failures, CI logs, GitHub issue URLs, files, or local git context into a
deduped inbox and create a linked task:

```bash
todos inbox add "bun test failed: parser regression" --source-type ci_log
todos inbox add --file /tmp/ci.log --source-name "local CI"
todos inbox add https://github.com/hasna/todos/issues/42 --source-url https://github.com/hasna/todos/issues/42
todos inbox git --diff
todos inbox list
```

Inbox bodies and metadata are redacted before storage. Repeated input resolves
to the existing inbox item instead of creating duplicate tasks.

## Local Bridge Import/Export

Export a versioned local bridge bundle for migration, backup, or explicit
hand-off to another local store:

```bash
todos export --format bridge --output todos-bridge.json
todos bridge-import todos-bridge.json --json
todos bridge-import todos-bridge.json --apply
```

Bridge bundles include local projects, task lists, plans, tasks, dependencies,
comments, run ledgers, command evidence, file evidence, artifacts, stored
artifact contents, commits, refs, and verification records. Imports default to
dry-run mode and report conflicts before writing. The package does not upload
bundles or call hosted services; any hosted sync must consume the exported JSON
explicitly.

## MCP Server

```bash
todos-mcp
```

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

## License

Apache-2.0 -- see [LICENSE](LICENSE)
