export const meta = {
  name: 'tasks-consolidation-r3',
  description: 'Wave 3 of the tasks consolidation: residual drain of the 10 plan-guard-blocked sources (plans --link-project where the plan exists), resolve the duplicate apps project c96b48e4, rebind ~149 null-list tasks, verify sources at 0 on two instruments',
  phases: [
    { title: 'Drain', detail: 'residual sources: link plans, move blocked tasks, verify 0 (iapp-news missing-plan case investigated precisely)' },
    { title: 'Resolve', detail: 'duplicate apps project + null-list rebind + apps-general list' },
    { title: 'Report', detail: 'per-source state + residue' },
  ],
}

const APPS = '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'
const INTERNAL = '737d6687-1a36-4e19-a8f6-6a2f9b2e1344'
const TASK = 'dc7c1f58-2f4a-4b6a-9b2a-6c1f8e3d5a7b'
const DUP_APPS = 'c96b48e4'

const CONST = `
You are a lane of the tasks-consolidation-r3 workflow (owner-authorized 2026-08-18, task ${TASK}). Wave 2 (wf_45631d8c-4fb) renamed oss-apps to apps and drained ~40 sources; this wave clears the residue: the 10 plan-guard-blocked sources, the duplicate 'apps' project (${DUP_APPS}), and the ~149 null-list tasks. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- Todos CLI is the ONLY mutation surface — no direct DB writes. Moves keep task id + history ('todos move <id> --project <t> --list <l>'). Plans link via 'plans --link-project' (receipts pplr_* pattern from wave 2). Never delete tasks or plans; never create duplicates.
- VERIFY ON TWO INSTRUMENTS: a source is drained only when BOTH 'todos list --project <source> --json' (redirect, full page) AND the archive/deregister read show zero in-scope tasks. Same-id verification: moved count in target == source count before move (list the ids).
- IDEMPOTENCY FIRST: if a source is already at 0 (two instruments), record and skip — do not re-move. If a target list already holds the same ids, record.
- 409 plan-guard: when 'todos move' refuses with 'Task project conflicts with linked plan', use 'plans --link-project' to move the plan to the target project first (wave-2 receipts pattern), then re-move. Where the plan is MISSING (iapp-news ba8a158d): investigate the plan row (todos plans list / show); recreate it in the target project ONLY if it is provably orphaned (no live linkage elsewhere) and record the receipt; if the investigation is inconclusive, leave the tasks in place and record the exact blocker — do NOT force.
- Capture path: redirect to files, never pipe large reads. Paste literal output lines. Record as you go: comments on ${TASK}, posts to #board. English. Lineage identity 'conversations agents register' named consolidate-r3-<your-role>.
- Distinguish measured vs inferred; state what you did not check.
`

const DRAIN = CONST + `
ROLE: residual drain lane. Sources: {SOURCES} (each: app name + project id + blocked count + target list). For EACH source:
1. Two-instrument read of the source (todos list --project <id> --json, redirect; plus the projects registry read). If 0: record drained, skip.
2. For each blocked task (409 plan-guard): resolve its linked plan (todos show <id> --json carries plan linkage); 'plans --link-project <plan> --project <target>' (receipt pattern), then 'todos move <id> --project <target> --list <target-list>'. Verify each moved id in the target (same-id).
3. iapp-news (project missing plan ba8a158d, 20 tasks): investigate the plan row first (plans list --json, plan show ba8a158d if resolvable). If provably orphaned, recreate the plan in the target project with a receipt and move; if inconclusive or the plan resolves elsewhere, leave the 20 tasks in place and record the exact blocker.
4. Final: source at 0 on TWO instruments, else record the exact remaining ids and why.
Return (JSON): { sources: [{app, moved: number, remaining: [{id, reason}], receipts: [string], drained: bool}] }
`

const RESOLVE = CONST + `
ROLE: resolve lane. Two jobs:
1. DUPLICATE 'apps' PROJECT (${DUP_APPS}, 76 tasks, path /home/hasna/workspace/hasna/apps — the pre-monorepo path; canonical is ${APPS}): read its full task list (redirect, paged) and its lists. Classify: are these tasks live work (pending/in_progress) or history? Fold into the canonical apps project: move each task with same-id verification into apps-<name> lists (match by task title/app prefix where unambiguous) or an apps-general list (create it if missing), then archive ${DUP_APPS} with a receipt so the name 'apps' resolves uniquely. If any task cannot be moved (409 plan-guard, name ambiguity), leave it and record the exact reason. NEVER merge two tasks into one; never drop history.
2. NULL-LIST REBIND: in the canonical apps project (${APPS}), enumerate tasks with task_list_id null (~149, wave-2 census) — paged, redirected. Rebind each to its apps-<name> list: the app name is the monorepo dir prefix in the task title/description ONLY where unambiguous (e.g. 'apps/emails/...' or '[emails]'); everything else goes to apps-general (create the list if missing) — 'todos update <id> --list <list-id>' or the move verb. Record counts per list. Never guess an app from a fuzzy match; ambiguous -> apps-general.
Return (JSON): { dupApps: {moved: number, archived: bool, remaining: [{id, reason}], receipts: [string]}, rebind: {perList: {list: number}, unbound: [{id, reason}]} }
`

const REPORT = CONST + `
ROLE: report. Aggregate: per-source drain state, the duplicate-apps resolution, the rebind counts, residue (any source not at 0 with exact reasons, any unmovable task). Comment ${TASK}, post to #board.
Return (JSON): { sources: [{app, drained, remaining}], dupApps: {state}, rebind: {perList}, residue: [string] }
`

const SRC_SCHEMA = { type: 'object', properties: { sources: { type: 'array', items: { type: 'object' } } }, required: ['sources'] }
const RES_SCHEMA = { type: 'object', properties: { dupApps: { type: 'object' }, rebind: { type: 'object' } }, required: ['dupApps', 'rebind'] }
const REPORT_SCHEMA = { type: 'object', properties: { sources: { type: 'array' }, dupApps: { type: 'object' }, rebind: { type: 'object' }, residue: { type: 'array' } }, required: ['sources'] }

phase('Drain')
const SOURCES = [
  { app: 'iapp-comments', projectId: '1ae7160b-dddc-4256-8c0c-c2fb5ea91a00', blocked: 13, target: INTERNAL, list: 'iapp-comments' },
  { app: 'iapp-digital', projectId: 'd5cfd9d2-f927-4652-a29f-a97f98f52dbf', blocked: 5, target: INTERNAL, list: 'iapp-digital' },
  { app: 'iapp-leads', projectId: '1896789c-74a0-4d67-a828-52c3724c01e0', blocked: 19, target: INTERNAL, list: 'iapp-leads' },
  { app: 'iapp-news', projectId: 'dd9d0299-75a8-4e45-9aa0-481e05b93f3b', blocked: 20, target: INTERNAL, list: 'iapp-news' },
  { app: 'iapp-social', projectId: '7fc62aeb-1da9-4336-99c2-924d527b9193', blocked: 12, target: INTERNAL, list: 'iapp-social' },
  { app: 'iapp-takumi', projectId: '3a3358b2-de61-49cd-b6f7-9a8bb1398da8', blocked: 1, target: INTERNAL, list: 'iapp-takumi' },
  { app: 'open-testers', projectId: '6ec37fde-85a8-4009-a557-1cafa8a8a7e7', blocked: 7, target: APPS, list: 'apps-testers' },
  { app: 'open-identities', projectId: '8dc21efa-03d9-4d21-8f5c-6af0e29268cf', blocked: 17, target: APPS, list: 'apps-identities' },
  { app: 'open-loops', projectId: '7868cd2e-5a43-47dd-bed7-5e519af58cc6', blocked: 36, target: APPS, list: 'apps-loops' },
  { app: 'open-deployment-compact-cli', projectId: 'd1239efe-734f-4af0-a476-f804bdf33354', blocked: 5, target: APPS, list: 'apps-deployment-compact-cli' },
]
const drain = await agent(DRAIN.replace('{SOURCES}', JSON.stringify(SOURCES)), { label: 'consolidate-r3-drain', phase: 'Drain', schema: SRC_SCHEMA })
log(`drain: ${drain && drain.sources ? drain.sources.filter(s => s.drained).length : 0}/${SOURCES.length} sources drained`)

phase('Resolve')
const resolve = await agent(RESOLVE, { label: 'consolidate-r3-resolve', phase: 'Resolve', schema: RES_SCHEMA })

phase('Report')
const report = await agent(REPORT, { label: 'consolidate-r3-report', phase: 'Report', schema: REPORT_SCHEMA })

return { drain, resolve, report }
