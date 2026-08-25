export const meta = {
  name: 'fleet-apps-reconcile',
  description: 'Census hasna/apps monorepo vs fleet installs: install missing apps, update all stations to latest hasna npm versions, remove packages no longer in the hasna org',
  phases: [
    { title: 'Census', detail: 'monorepo members + registry latest + station01 installed globals -> install/update/remove matrix' },
    { title: 'Review', detail: 'Fable adversarial review of the plan before any mutation' },
    { title: 'Execute', detail: 'parallel per-station lanes: remove extras, install missing, update stale, record post-state' },
    { title: 'Report', detail: 'aggregate counts and per-station results' },
    { title: 'Harvest', detail: 'independent Opus harvest' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const TASK = 'ba5a334a-166e-40d8-9258-0acf743aae23'
const CHANNEL = 'board'

const CONST = `
You are a lane of the fleet-apps reconciliation workflow (owner-authorized 2026-08-18, task ${TASK}). Mission: (1) census every app in the hasna/apps monorepo (${MONOREPO}); (2) check how many are installed globally and INSTALL the missing ones from hasna npm; (3) find installed packages no longer in the hasna npm org (registry 404 / renamed away) and REMOVE them from station01 and all stations; (4) bring every station's hasna apps UP TO DATE from hasna npm. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. No file mutations in any git repo — this is an OPS workflow (installs/removals on stations), no PRs, no commits.
- No secrets: never print/capture/commit credential values in any encoding; consume ONLY via 'secrets exec <key> --as VAR -- <cmd>'. No internal-infra strings in artifacts.
- Capture path: redirect to files, read both + $?; never pipe large reads. Paste literal output lines when reporting.
- Record as you go: comments on ${TASK}, mementos for non-obvious findings, posts to #${CHANNEL}. English. Register a lineage identity ('conversations agents register') named fleet-apps-<your-role>.
- The 7-day bun quarantine: when 'bun install -g' is blocked by minimum-release-age, add the EXACT package name to that station's ~/.bunfig.toml minimumReleaseAgeExcludes (the sanctioned mechanism — never bypass the quarantine itself, never wildcards).
- SSH to stations per the machines manifest (sshAddress user@host, e.g. hasna@station03); a station that times out or denies auth is recorded '?' with the exact error — never retried more than twice.
- Distinguish measured vs inferred; state what you did not check. Plain register.
`

const CENSUS = CONST + `
ROLE: census (Opus). Build the exact plan. Do:
1. Monorepo members: ls ${MONOREPO}/apps — for every directory with a package.json: name + version (python3 json read). Exclude non-package dirs.
2. Registry latest per member: 'npm view @hasna/<name> version' (bounded per package; record 'unpublished' on 404 — that is expected for not-yet-released members).
3. station01 installed globals: ls ~/.bun/install/global/node_modules/@hasna (and @hasnaxyz, @hasnatools, @hasnafamily, @hasnastudio — the hasna scopes) — list every installed package name + version (read each package.json). Also list STALE SYMLINKS in the global dir (ls -la, entries that are symlinks) with their targets.
4. Classify (this is THE plan):
   - installList: monorepo members NOT installed on station01 (and published on npm).
   - updateList: installed members whose installed version < registry latest (compare versions).
   - removeList: installed hasna-scope packages that are NOT monorepo members AND 'npm view <name> version' returns 404 (no longer in the hasna npm org) — capture the 404 evidence line for each.
   - staleSymlinks: the symlink entries with targets (e.g. @hasna/notes -> iapp-notes) — candidates for removal.
5. Output the three lists with counts + the per-package evidence. Comment the plan on ${TASK}.
Return (JSON): { members: [{name, repoVersion, registryLatest, published: bool}], installList: [string], updateList: [{name, installed, latest}], removeList: [{name, installedVersion, evidence}], staleSymlinks: [{name, target}], counts: {members, installed, missing, stale, extras} }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). You review the PLAN before any mutation. Plan: {PLAN}.
Adversarially validate:
1. removeList: for EVERY entry, independently confirm: (a) not a monorepo member (ls ${MONOREPO}/apps), (b) 'npm view <name> version' 404s, (c) NOT a dependency of any other installed global (read the global node_modules package.json files — grep the deps; if an entry is a dependency of a live install, flag it: removing it breaks the dependent). Flag any entry that fails (a)-(c) as a P1.
2. installList: each entry is a published monorepo member (npm view ok) — a member that never published is NOT installable; flag.
3. updateList: confined to hasna-scope packages; no version that would downgrade.
4. staleSymlinks: targets recorded; removal of the symlink itself is safe (it is a link, not a package) — but flag any symlink whose target is a LIVE package dir.
Post the verdict as a comment on ${TASK} with the first line '[REVIEW] <GO|NO_GO> — fleet-apps plan @ <sha of the plan?> — lens: removal-safety, reviewer fleet-apps-review (1 of 1)'. Block ONLY concrete P0/P1 defects (a wrong removal, a removal that breaks a dependent, an uninstallable install). P2/P3 non-blocking.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}], approvedRemoveList: [string], rejected: [{name, reason}] }
`

const EXECUTE = CONST + `
ROLE: executor (Sonnet). Apply the REVIEWED plan to your station group. Plan: {PLAN} (the reviewer's approvedRemoveList supersedes the raw removeList).
Your stations: {STATIONS} (ssh per the machines manifest).
Per station (bounded ~10 min each; unreachable -> record '?' with the exact error and CONTINUE):
1. Remove: for each entry in approvedRemoveList present on the station: 'bun uninstall -g <name>' (or, if that fails, remove the global node_modules/<name> dir + any bin symlinks in the bun global bin — verify the exact paths first). For each staleSymlink present: rm the symlink (verify it is a symlink first with ls -la). Record what was removed.
2. Install missing: 'bun install -g <pkg>@<version>' for each installList entry (batch several packages per bun command where practical). Quarantine handling per the rules (exact-name excludes in that station's ~/.bunfig.toml).
3. Update stale: 'bun install -g <pkg>@<latest>' for each updateList entry (same quarantine handling).
4. Record the post-state per station: for the affected packages, the installed version (bun pm ls -g or reading the global package.json files — redirect to files, never pipe).
Return (JSON): { stations: [{id, state: pass|failed|unreachable, removed: [string], installed: [string], updated: [{name, version}], postVersions: {name: version}, evidence: string}] }
`

const REPORT = CONST + `
ROLE: report (Sonnet). Aggregate the executor results (below) + the census counts. Produce the owner's three numbers + the per-station table: (1) monorepo apps total, how many were already installed, how many newly installed; (2) how many extras removed, where; (3) how many apps updated to latest per station. List unreachable stations and any failures with evidence. Comment the final state on ${TASK} and post the summary to #${CHANNEL}.
Return (JSON): { totals: {monorepoApps, installedBefore, installedNew, updated, extrasRemoved}, stations: [{id, state, extrasRemoved, installed, updated, failures}], unreachable: [string], evidence: string }
Executors: {EXECUTORS}
`

const HARVEST = CONST + `
ROLE: harvest (Opus, independent). Create your harvest row in the oss-apps project, comment each of the five categories on it the moment it is decided (skills/todos/mementos/knowledge/files — create/update/none + reason; dedupe first; 'none' is complete). Read the record: ${TASK} comments, the plan + review, the report (below), #${CHANNEL}.
Categories:
- SKILLS: repeated procedures worth a skill (fleet-wide hasna-apps install/update/remove recipe — this is now a repeatable ops procedure)?
- TODOS: what surfaced nobody filed (unreachable stations needing a pass, members never published, quarantine excludes still missing on some stations, the stale-symlink class)?
- MEMENTOS: what the next agent would re-learn at full cost?
- KNOWLEDGE: ratifiable doctrine (the fleet app inventory as-built, the extras class, the update procedure)?
- FILES: artefacts for hasna/files rather than scratch (the census matrix, per-station evidence)?
Close the row completed only after all five categories are commented.
Return (JSON): { categories: {skills: {decision, reason, rowId|null}, todos: {...}, mementos: {...}, knowledge: {...}, files: {...}} }
Report: {REPORT}
`

const CENSUS_SCHEMA = {
  type: 'object',
  properties: {
    members: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, repoVersion: { type: 'string' }, registryLatest: { type: ['string', 'null'] }, published: { type: 'boolean' } }, required: ['name'] } },
    installList: { type: 'array', items: { type: 'string' } },
    updateList: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, installed: { type: 'string' }, latest: { type: 'string' } }, required: ['name'] } },
    removeList: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, installedVersion: { type: 'string' }, evidence: { type: 'string' } }, required: ['name'] } },
    staleSymlinks: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, target: { type: 'string' } }, required: ['name'] } },
    counts: { type: 'object' },
  },
  required: ['members', 'installList', 'updateList', 'removeList', 'counts'],
}
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['GO', 'NO_GO'] },
    findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string' }, title: { type: 'string' }, detail: { type: 'string' } }, required: ['severity', 'title', 'detail'] } },
    approvedRemoveList: { type: 'array', items: { type: 'string' } },
    rejected: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, reason: { type: 'string' } } } },
  },
  required: ['verdict', 'findings'],
}
const EXEC_SCHEMA = {
  type: 'object',
  properties: {
    stations: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, state: { type: 'string' }, removed: { type: 'array', items: { type: 'string' } }, installed: { type: 'array', items: { type: 'string' } }, updated: { type: 'array', items: { type: 'object' } }, postVersions: { type: 'object' }, evidence: { type: 'string' } }, required: ['id', 'state'] } },
  },
  required: ['stations'],
}
const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    totals: { type: 'object' },
    stations: { type: 'array', items: { type: 'object' } },
    unreachable: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'string' },
  },
  required: ['totals', 'stations'],
}
const HARVEST_SCHEMA = {
  type: 'object',
  properties: {
    categories: {
      type: 'object',
      properties: {
        skills: { type: 'object', properties: { decision: { type: 'string' }, reason: { type: 'string' }, rowId: { type: ['string', 'null'] } } },
        todos: { type: 'object', properties: { decision: { type: 'string' }, reason: { type: 'string' }, rowId: { type: ['string', 'null'] } } },
        mementos: { type: 'object', properties: { decision: { type: 'string' }, reason: { type: 'string' }, rowId: { type: ['string', 'null'] } } },
        knowledge: { type: 'object', properties: { decision: { type: 'string' }, reason: { type: 'string' }, rowId: { type: ['string', 'null'] } } },
        files: { type: 'object', properties: { decision: { type: 'string' }, reason: { type: 'string' }, rowId: { type: ['string', 'null'] } } },
      },
      required: ['skills', 'todos', 'mementos', 'knowledge', 'files'],
    },
  },
  required: ['categories'],
}

phase('Census')
const plan = await agent(CENSUS, { label: 'census', phase: 'Census', schema: CENSUS_SCHEMA, model: 'opus' })
log(`census: ${plan ? plan.counts : 'FAILED'} — install ${plan ? plan.installList.length : '?'}, update ${plan ? plan.updateList.length : '?'}, remove ${plan ? plan.removeList.length : '?'}`)

phase('Review')
let review = null
if (plan) {
  review = await agent(REVIEW.replace('{PLAN}', JSON.stringify(plan)), { label: 'review-plan', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
}
log(`plan review: ${review ? review.verdict : 'NO-VERDICT'}`)

phase('Execute')
const GROUPS = [
  ['station01', 'station02'],
  ['station03', 'station04'],
  ['station05', 'station06', 'station07'],
  ['station08', 'station09', 'station10', 'station11'],
  ['station12', 'station13', 'station14', 'station15', 'station16'],
]
let executors = []
if (plan && review && review.verdict === 'GO') {
  const planForExec = { ...plan, removeList: review.approvedRemoveList }
  executors = await parallel(GROUPS.map((st, i) => () =>
    agent(EXECUTE.replace('{PLAN}', JSON.stringify(planForExec)).replace('{STATIONS}', JSON.stringify(st)), {
      label: `execute-group-${i + 1}`, phase: 'Execute', schema: EXEC_SCHEMA, model: 'sonnet',
    }),
  ))
  log(`execution done: ${executors.filter(Boolean).length} groups`)
} else {
  log('EXECUTION SKIPPED — plan not GO')
}

phase('Report')
const report = await agent(
  REPORT.replace('{EXECUTORS}', JSON.stringify(executors.filter(Boolean))),
  { label: 'report', phase: 'Report', schema: REPORT_SCHEMA, model: 'sonnet' },
)

phase('Harvest')
const harvest = await agent(HARVEST.replace('{REPORT}', JSON.stringify(report || { report: null })), {
  label: 'harvest', phase: 'Harvest', schema: HARVEST_SCHEMA, model: 'opus',
})

return { plan, review, executors: executors.filter(Boolean), report, harvest }
