export const meta = {
  name: 'tasks-consolidation',
  description: 'Move all tasks from the 15 open-* todos projects into the apps project (3bbc22e0) under per-app task lists (apps-<name>) + apps-general, verify counts, archive the emptied open-* projects',
  phases: [
    { title: 'Census', detail: 'per open-* project: task count, statuses, target list name; edge-case classification (monorepo app vs standalone vs legacy)' },
    { title: 'Migrate', detail: 'create apps-<name> lists; todos move each task preserving id/history; verify moved == census' },
    { title: 'Verify', detail: 'counts reconcile; no task lost; old projects empty' },
    { title: 'Archive', detail: 'archive the emptied open-* projects (never delete)' },
    { title: 'Report', detail: 'final state + edge-case dispositions' },
  ],
}

const APPS_PROJECT = '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'
const TASK = 'dc7c1f58'

const CONST = `
You are a lane of the tasks-consolidation workflow (owner-authorized 2026-08-18). Owner decision: all tasks from the 15 open-* todos projects move into the apps project (${APPS_PROJECT}) under per-app task lists named apps-<name> (e.g. apps-bridge, apps-loops, apps-logs, apps-signatures, apps-testers, apps-identities, apps-gateway, apps-deployment, apps-changelog, apps-clip, apps-computer) plus an apps-general list for cross-app/misc tasks. Edge cases: open-researcher is a STANDALONE repo (not a monorepo app) — its tasks stay in their own project (do NOT move, record); open-alumia-legacy1, open-cloud-primary-sync, open-deployment-compact-cli are LEGACY — their live tasks move to apps-general, then the projects archive. Migration uses 'todos move <id> --project <apps> --list <apps-<name>>' which KEEPS id and history. After a project is empty, archive it with 'todos projects --deregister <project>' only if it refuses on incomplete tasks the archive path is 'todos projects --archive' or equivalent — NEVER delete a project or task. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- The todos CLI is the ONLY tool for this migration — no direct DB writes, no MCP fallback.
- No secrets: never print/capture credential values. Capture path: redirect to files, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the tracking task, posts to #board. English. Lineage identity 'conversations agents register' named tasks-consolidation-<your-role>.
- Every move is VERIFIED: after moving, the task resolves in the apps project with the same id (todos show <id> --project ${APPS_PROJECT}); counts reconcile per project (census count == moved count).
`

const CENSUS = CONST + `
ROLE: census lane (Sonnet). For EACH of the 15 open-* projects (aa03ac17 bridge, 7868cd2e loops, c2750edb changelog, 668bd42f clip, 3214b3e7 cloud-primary-sync, 00010fb8 alumia-legacy1, 7283df03 computer, 2818dc7b deployment, d1239efe deployment-compact-cli, 7cb7c1f6 gateway, 8dc21efa identities, 5fe1a2d9 logs, f3afeeee researcher, 35184f82 signatures, 6ec37fde testers):
1. todos list --project <id> --json (redirect to a file, parse the array) — count tasks, statuses, and list ids.
2. Classify: {app: <name>, projectId, taskCount, statuses: {pending, in_progress, completed, failed, cancelled}, targetList: 'apps-<name>' | 'apps-general' | 'KEEP' (researcher), action: 'move' | 'keep' | 'move-general'}.
Return (JSON): { projects: [{app, projectId, taskCount, statuses, targetList, action}] }
`

const MIGRATE = CONST + `
ROLE: migrate lane (Sonnet). Your batch: {BATCH} (each: {app, projectId, taskCount, targetList, action}). For EACH:
1. SKIP 'keep' (researcher — standalone repo, stays).
2. Ensure the target list exists in ${APPS_PROJECT}: 'todos --project ${APPS_PROJECT} lists --add <targetList>' (if it already exists, record; idempotent).
3. Move EVERY task: 'todos move <id> --project ${APPS_PROJECT} --list <targetList>' for each task id from the census (redirect output to a file; record any move error verbatim — a failed move is a finding, not a skip).
4. VERIFY per task: 'todos show <id> --project ${APPS_PROJECT} --json' resolves with the same id (quote one representative output line).
Return (JSON): { projects: [{app, moved: number, failed: [{taskId, error}]}] }
`

const VERIFY = CONST + `
ROLE: verify lane (Sonnet). Re-run the census for every project the migrate lanes touched: todos list --project <id> — remaining task count MUST be 0 for moved projects (except researcher). Then confirm in ${APPS_PROJECT}: per target list, the moved task count matches (todos --project ${APPS_PROJECT} list --list <apps-<name>> --json count). Any discrepancy = finding with exact numbers.
Return (JSON): { projects: [{app, remainingInSource: number, movedIntoApps: number, reconciled: bool}], discrepancies: [string] }
`

const ARCHIVE = CONST + `
ROLE: archive lane (Sonnet). For EACH project verified empty (remainingInSource == 0, action != keep): archive it — 'todos projects --deregister <projectId>' if that is the supported archive/retire path and it does not refuse, else the CLI's archive verb. NEVER delete. Record the archive result. Projects that refuse (incomplete tasks remain) are findings.
Return (JSON): { archived: [{projectId, app, result}], refused: [string] }
`

const REPORT = CONST + `
ROLE: report. Aggregate: per project (moved count, list, archived), the researcher keep, the legacy dispositions, any discrepancies or refusals. Comment the tracking task, post to #board.
Return (JSON): { projects: [{app, moved, targetList, archived, action}], discrepancies: [string], followUps: [string] }
`

const CENSUS_SCHEMA = { type: 'object', properties: { projects: { type: 'array', items: { type: 'object' } } }, required: ['projects'] }
const MIGRATE_SCHEMA = { type: 'object', properties: { projects: { type: 'array', items: { type: 'object' } } }, required: ['projects'] }
const VERIFY_SCHEMA = { type: 'object', properties: { projects: { type: 'array' }, discrepancies: { type: 'array' } }, required: ['projects'] }
const ARCHIVE_SCHEMA = { type: 'object', properties: { archived: { type: 'array' }, refused: { type: 'array' } }, required: ['archived'] }
const REPORT_SCHEMA = { type: 'object', properties: { projects: { type: 'array' }, discrepancies: { type: 'array' }, followUps: { type: 'array' } }, required: ['projects'] }

phase('Census')
const census = await agent(CENSUS, { label: 'tc-census', phase: 'Census', schema: CENSUS_SCHEMA, model: 'sonnet' })
const projects = (census && census.projects) || []
log(`census: ${projects.length} projects`)

phase('Migrate')
const migrateResults = await parallel(projects.filter(p => p.action !== 'keep').map((p, i) => () =>
  agent(MIGRATE.replace('{BATCH}', JSON.stringify([p])), { label: `tc-migrate-${i + 1}`, phase: 'Migrate', schema: MIGRATE_SCHEMA, model: 'sonnet' }),
))
log(`migrate: ${migrateResults.filter(Boolean).length} lanes`)

phase('Verify')
const verify = await agent(VERIFY, { label: 'tc-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'sonnet' })

phase('Archive')
const archive = await agent(ARCHIVE, { label: 'tc-archive', phase: 'Archive', schema: ARCHIVE_SCHEMA, model: 'sonnet' })

phase('Report')
const report = await agent(REPORT, { label: 'tc-report', phase: 'Report', schema: REPORT_SCHEMA, model: 'sonnet' })

return { census, migrates: migrateResults.filter(Boolean), verify, archive, report }
