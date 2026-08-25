export const meta = {
  name: 'tasks-consolidation-v2',
  description: 'Consolidate todos projects: rename oss-apps to apps (canonical), move open-* public-app tasks into apps under apps-<name> lists, move open-* internal-app tasks + iapp-* tasks into internal-apps (737d6687) under iapp-<name> lists, verify counts, archive emptied projects',
  phases: [
    { title: 'Census', detail: 'classify every open-* and iapp-* project by PATH/ROLE: public (opensource/hasna-apps) -> apps; internal (internalapp/hasna-internal) -> internal-apps' },
    { title: 'Rename', detail: 'oss-apps (3bbc22e0) -> apps (canonical name)' },
    { title: 'Migrate', detail: 'todos move each task (keeps id/history) into the right project+list' },
    { title: 'Verify', detail: 'counts reconcile; sources empty; targets match' },
    { title: 'Archive', detail: 'archive emptied source projects (never delete)' },
    { title: 'Report', detail: 'final state + edge-case dispositions' },
  ],
}

const APPS_PROJECT = '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'   // oss-apps, canonical name: apps
const INTERNAL_APPS_PROJECT = '737d6687'                       // internal-apps

const CONST = `
You are a lane of the tasks-consolidation-v2 workflow (owner-authorized 2026-08-18). Owner decisions: (1) the todos project currently named 'oss-apps' (${APPS_PROJECT}, path /home/hasna/workspace/repos/hasna/apps) is renamed to the CANONICAL name 'apps'; (2) tasks from the 15 open-* projects move by ROLE: public monorepo apps (path under opensource/ or repos/hasna/apps) -> the apps project under apps-<name> task lists; INTERNAL apps (path under internalapp/ or hasna-internal/) -> the internal-apps project (${INTERNAL_APPS_PROJECT}) under iapp-<name> task lists; (3) ALL iapp-* projects move to the internal-apps project under iapp-<name> task lists; (4) open-researcher stays (standalone repo); legacy projects drain into apps-general (public) / iapp-general (internal) then archive. Migration uses 'todos move <id> --project <target> --list <list>' which KEEPS id and history. NEVER delete a project or task; archive only after the source is verified empty. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- The todos CLI is the ONLY tool — no direct DB writes.
- No secrets: never print/capture credential values. Capture path: redirect to files, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the tracking task, posts to #board. English. Lineage identity 'conversations agents register' named tc-v2-<your-role>.
- Every move is VERIFIED: 'todos show <id> --project <target>' resolves with the same id; per-project counts reconcile (census == moved).
`

const CENSUS = CONST + `
ROLE: census lane (Sonnet). Enumerate (todos projects, redirect to a file) and classify:
1. The 15 open-* projects (aa03ac17 bridge, 7868cd2e loops, c2750edb changelog, 668bd42f clip, 3214b3e7 cloud-primary-sync, 00010fb8 alumia-legacy1, 7283df03 computer, 2818dc7b deployment, d1239efe deployment-compact-cli, 7cb7c1f6 gateway, 8dc21efa identities, 5fe1a2d9 logs, f3afeeee researcher, 35184f82 signatures, 6ec37fde testers): classify by PATH — contains 'internalapp' or 'hasna-internal' -> INTERNAL (target internal-apps, list iapp-<name>); otherwise PUBLIC (target apps, list apps-<name>); researcher -> KEEP.
2. ALL iapp-* projects (grep 'todos-iapp-' or name starts with iapp-, non-archived): target internal-apps (${INTERNAL_APPS_PROJECT}), list iapp-<name>.
3. Per project: task count + statuses (todos list --project <id> --json, redirect).
Return (JSON): { projects: [{app, projectId, taskCount, statuses, targetProject: 'apps'|'internal-apps'|'KEEP', targetList}] }
`

const RENAME = CONST + `
ROLE: rename lane (Sonnet). Rename the project ${APPS_PROJECT} from 'oss-apps' to the canonical 'apps': 'todos projects --update ${APPS_PROJECT} --name apps' (or the CLI's update verb). Verify: 'todos projects --show ${APPS_PROJECT}' reports name 'apps'. If the rename verb refuses or the name is already 'apps', record and proceed.
Return (JSON): { renamed: bool, name: string }
`

const MIGRATE = CONST + `
ROLE: migrate lane (Sonnet). Your batch: {BATCH} (each: {app, projectId, taskCount, targetProject, targetList}). For EACH project (skip KEEP):
1. Target project id: 'apps' -> ${APPS_PROJECT}; 'internal-apps' -> ${INTERNAL_APPS_PROJECT}.
2. Ensure the target list exists: 'todos --project <targetId> lists --add <targetList>' (idempotent — if exists, record).
3. Move EVERY task: 'todos move <id> --project <targetId> --list <targetList>' for each id (redirect output; a failed move is a FINDING with the verbatim error, not a skip).
4. VERIFY per task: 'todos show <id> --project <targetId> --json' resolves (quote one representative line).
Return (JSON): { projects: [{app, moved, failed: [{taskId, error}]}] }
`

const VERIFY = CONST + `
ROLE: verify lane (Sonnet). For every project the migrate lanes touched: re-run 'todos list --project <sourceId>' — remaining count MUST be 0 (except KEEP). Then per target list: 'todos --project <targetId> list --list <targetList> --json' count matches the census. Any discrepancy = finding with exact numbers.
Return (JSON): { projects: [{app, remainingInSource, movedIntoTarget, reconciled}], discrepancies: [string] }
`

const ARCHIVE = CONST + `
ROLE: archive lane (Sonnet). For each source project verified empty: archive it via the CLI's supported archive/deregister path ('todos projects --deregister <id>' — if it refuses with incomplete tasks, that is a FINDING). NEVER delete. Record results.
Return (JSON): { archived: [{projectId, app, result}], refused: [string] }
`

const REPORT = CONST + `
ROLE: report. Aggregate: the rename result, per project (moved, target, archived), researcher keep, legacy dispositions, discrepancies/refusals. Comment the tracking task, post to #board.
Return (JSON): { rename: {renamed, name}, projects: [{app, moved, targetList, archived, action}], discrepancies: [string], followUps: [string] }
`

const CENSUS_SCHEMA = { type: 'object', properties: { projects: { type: 'array', items: { type: 'object' } } }, required: ['projects'] }
const RENAME_SCHEMA = { type: 'object', properties: { renamed: { type: 'boolean' }, name: { type: 'string' } }, required: ['renamed'] }
const MIGRATE_SCHEMA = { type: 'object', properties: { projects: { type: 'array', items: { type: 'object' } } }, required: ['projects'] }
const VERIFY_SCHEMA = { type: 'object', properties: { projects: { type: 'array' }, discrepancies: { type: 'array' } }, required: ['projects'] }
const ARCHIVE_SCHEMA = { type: 'object', properties: { archived: { type: 'array' }, refused: { type: 'array' } }, required: ['archived'] }
const REPORT_SCHEMA = { type: 'object', properties: { rename: { type: 'object' }, projects: { type: 'array' }, discrepancies: { type: 'array' }, followUps: { type: 'array' } }, required: ['projects'] }

phase('Census')
const census = await agent(CENSUS, { label: 'tc2-census', phase: 'Census', schema: CENSUS_SCHEMA, model: 'sonnet' })
const projects = (census && census.projects) || []
log(`census: ${projects.length} projects`)

phase('Rename')
const rename = await agent(RENAME, { label: 'tc2-rename', phase: 'Rename', schema: RENAME_SCHEMA, model: 'sonnet' })

phase('Migrate')
const migrateResults = await parallel(projects.filter(p => p.targetProject !== 'KEEP').map((p, i) => () =>
  agent(MIGRATE.replace('{BATCH}', JSON.stringify([p])), { label: `tc2-migrate-${i + 1}`, phase: 'Migrate', schema: MIGRATE_SCHEMA, model: 'sonnet' }),
))
log(`migrate: ${migrateResults.filter(Boolean).length} lanes`)

phase('Verify')
const verify = await agent(VERIFY, { label: 'tc2-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'sonnet' })

phase('Archive')
const archive = await agent(ARCHIVE, { label: 'tc2-archive', phase: 'Archive', schema: ARCHIVE_SCHEMA, model: 'sonnet' })

phase('Report')
const report = await agent(REPORT, { label: 'tc2-report', phase: 'Report', schema: REPORT_SCHEMA, model: 'sonnet' })

return { census, rename, migrates: migrateResults.filter(Boolean), verify, archive, report }
