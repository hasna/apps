# Open Uptime Operational Tracking

Created on 2026-06-28 from `spark01`.

This file is the repo-local pointer to the operational records for the hosted
Open Uptime buildout. The CLI stores remain the working ledger until the cloud
stores are repaired and preflighted.

## Canonical Records

- Codewith goal plan: `2c0724a2-39dd-453c-8b88-714ab2f0601d`
- Active bootstrap goal: `4041c050-637f-48b7-9308-0669bde26cb1`
- Projects workspace: `open-uptime` / `wks_2tyysw05cwap`
- GitHub repo: `hasna/uptime` private
- Todos project: `e65d26fa-7cb6-4d4f-a709-bf3cc8d6d616`
- Todos task-list slug: `todos-open-uptime`
- Todos task-list id: `66dbbbf5-36cb-4c99-9f0c-f873034c5efb`
- Todos plan: `070aeb46-71a8-41a3-bd7b-18846ad7e5c3`
- Hosted exposure guard task: `faa2c0d0-7564-46a9-a25c-f49de9d52043`
- Hosted guard review queue: `open-uptime-hosted-gate`
- Knowledge item: `k_mqxlegt7_0gva4g`
- Notes project: `7f4afdce-e728-4098-9b60-3de1a5d7351e`
- Note: `5e6e1625-e14e-414c-a692-ec8877b9ddcb`
- Memento: `open-uptime.cloud-buildout.bootstrap` / `cad5c140-0fee-4c31-a931-78f28f2dd234`
- Conversation channel: `open-uptime-cloud`

## Source Documents

- `docs/cloud-source-of-truth.md`
- `docs/aws-runtime-security.md`
- `docs/monitoring-product-contract.md`
- `docs/operational-tracking.md`

## Cloud-Primary Status

Spark01 must not be treated as cloud-primary yet.

Known blockers:

- `cloud` is configured in hybrid/local posture and previously reported a stale
  non-resolving RDS endpoint.
- `projects` storage is not configured for cloud storage.
- no Open Uptime per-project store DB exists yet at
  `~/.hasna/projects/by-id/wks_2tyysw05cwap/project.db`.
- `knowledge` is in local mode.
- `todos` has unresolved sync conflicts.
- `mementos` warns that no primary machine is configured.
- Open Uptime itself is still local SQLite-first.

Until the Spark01 preflight task passes, local CLI records and this repo document
are the durable working ledger. Do not use local/private records as cloud
authority.

`projects show open-uptime` can report Spark01 as the primary local workspace
location. That is only a local repo-location marker; it is not cloud-primary
authority and must not be used as cloud sync evidence.

The current bridge is repo docs plus cross-service IDs. It is not a Projects
per-project store record until the Projects store/canvas work creates and
cloud-backs `~/.hasna/projects/by-id/wks_2tyysw05cwap/project.db`.

## Hard Hosted Gate

Do not expose hosted dashboard, API, MCP, report delivery, JSON Render/canvas
specs, artifacts, browser evidence, or check execution until these are tested:

- hosted auth/RBAC and workspace scoping
- Postgres persistence with migrations, tombstones, audit, and no hidden SQLite
  fallback
- shared target policy with SSRF protections
- scheduler `check_jobs` and probe lease fencing
- report delivery through open-mailery/open-telephony/open-logs channel refs
- JSON Render and canvas redaction
- browser evidence isolation
- private probe identity, revocation, and isolation
- AWS IAM/RDS/S3/ALB/ECS runtime boundaries
- Apache-2.0 OSS release readiness
- four independent adversarial review lanes

The critical todos task `faa2c0d0-7564-46a9-a25c-f49de9d52043` is the explicit
action item for enforcing this gate across every hosted surface. It gates report
delivery, JSON Render/canvas, private probes, browser checks, artifacts, and
hosted check execution even when those feature tasks are separately prioritized.

## Todos Contracts

All 13 active tasks in plan `070aeb46-71a8-41a3-bd7b-18846ad7e5c3` are assigned
to task list `66dbbbf5-36cb-4c99-9f0c-f873034c5efb` and have structured
`todos contracts` records with acceptance criteria, verification commands,
relevant files, expected artifacts, risk levels, and done definitions.

The hosted guard task has local review records in:

- `todos reviews request faa2c0d0-7564-46a9-a25c-f49de9d52043`
- `todos contracts request-review faa2c0d0-7564-46a9-a25c-f49de9d52043`

Recorded verification evidence:

- `todos contracts show faa2c0d0-7564-46a9-a25c-f49de9d52043 --json`
- plan task-list and contract coverage readback for all 13 tasks

## Idempotency Keys

Use stable idempotency keys for delegated or replayable work:

- `open-uptime:hosted-exposure-guard:v1`
- `open-uptime:hosted-auth-rbac:v1`
- `open-uptime:target-policy:v1`
- `open-uptime:postgres-cloud-store:v1`
- `open-uptime:check-jobs-probe-lease:v1`
- `open-uptime:monitor-schemas:v1`
- `open-uptime:inventory-import:v1`
- `open-uptime:incident-workflow:v1`
- `open-uptime:report-delivery:v1`
- `open-uptime:json-render-canvases:v1`
- `open-uptime:aws-runtime:v1`
- `open-uptime:spark01-private-probe:v1`
- `open-uptime:release-validation:v1`

## Validation Commands

Use these as baseline readback checks before resuming implementation:

```bash
projects show open-uptime --json
todos --project /home/hasna/workspace/hasna/opensource/open-uptime plans --show 070aeb46-71a8-41a3-bd7b-18846ad7e5c3 --json
todos --project /home/hasna/workspace/hasna/opensource/open-uptime list --json
knowledge get --id k_mqxlegt7_0gva4g --json
notes --json show 5e6e1625-e14e-414c-a692-ec8877b9ddcb
mementos --json recall open-uptime.cloud-buildout.bootstrap
conversations channel read open-uptime-cloud --json
todos contracts show faa2c0d0-7564-46a9-a25c-f49de9d52043 --json
todos trace faa2c0d0-7564-46a9-a25c-f49de9d52043
git status --short
```

After implementation work starts, extend validation with the repo commands:

```bash
bun run build
bun run typecheck
bun test
uptime --version
uptime mcp --help
```

AWS plan and smoke tests are allowed only after the `hasna-xyz-infra` repository
is located or checked out, reviewed, and updated with least-privilege infra
changes.

## Reviewer Lanes

Completed earlier review lanes:

- inventory/cloud/app review: local SQLite-only product, unauthenticated local
  dashboard/API reads, SSRF exposure, and no deployable AWS runtime
- cloud source-of-truth review: explicit cloud Postgres/object-store authority,
  service data boundaries, leases, tombstones, and cloud-sync blockers
- AWS runtime review: ECS/Fargate, RDS/S3, IAM, private/public probe separation,
  rollback, alarms, and current account gaps
- product contract review: hosted monitor taxonomy, import workflow, incidents,
  reports, JSON Render/canvas gates, and hard hosted exposure gate

Active bootstrap review lanes:

- source-of-truth integrity
- cloud-primary truthfulness and sync risk
- hosted security and release gates
- operational recoverability and future delegation readiness

Reconciled review findings:

- Hosted security/release review found that the gate was explicit in docs but
  not equally actionable in todos and knowledge. Fixed by creating critical
  task `faa2c0d0-7564-46a9-a25c-f49de9d52043` and updating the memory layer to
  carry the full hosted gate.
- Cloud-primary truthfulness review found no cloud-primary overclaim, but
  flagged that Spark01's Projects `is_primary` location can be confused with
  cloud-primary authority and that compressed records need the concrete cloud
  blockers. Fixed by carrying that distinction and blocker list into the short
  memory/conversation records.
- Operational recoverability review found that Projects-to-Todos routing was
  ambiguous and that acceptance, validation, review, and idempotency were mostly
  prose-only. Fixed by creating task list
  `66dbbbf5-36cb-4c99-9f0c-f873034c5efb`, assigning all 13 plan tasks to it,
  linking Projects to that list, adding structured contracts for every plan
  task, and recording review/verification evidence for the hosted guard task.
- Source-of-truth integrity review found the docs were untracked, the task-list
  slug/id distinction was muddy, `todos plans --json` was a misleading readback,
  no per-project store DB exists yet, conversation/memento ownership is loose,
  and `.project.json` was stale. Fixed by clarifying slug/id naming, replacing
  the plan readback with `plans --show`, documenting the missing project store
  as a blocker, updating `.project.json`, and committing the bridge docs.
