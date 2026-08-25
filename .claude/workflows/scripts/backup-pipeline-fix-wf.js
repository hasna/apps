export const meta = {
  name: 'backup-pipeline-fix',
  description: 'Fix the station01 offsite backup pipeline: weekly big tier missed 08-16, hourly critical archives truncated since ~18:20Z (sessions.db staging class) — restore shipping, verify real archive size/age, confirm the freshness monitor reports FRESH on both tiers (task 9d5935aa, CRITICAL)',
  phases: [
    { title: 'Investigate', detail: 'read the loop spec + staging script; why weekly missed, why hourly truncated' },
    { title: 'Fix', detail: 'smallest owned repair to the staging script / loop config' },
    { title: 'Verify', detail: 'real run: archive >= floor size with sessions.db, monitor FRESH both tiers' },
    { title: 'Review', detail: 'Fable review' },
    { title: 'Report', detail: 'task 9d5935aa + #board' },
  ],
}

const TASK = '9d5935aa'

const CONST = `
You are a lane of the backup-pipeline-fix workflow (2026-08-19, task ${TASK}, CRITICAL — backups project 682150ad). The station01 OFF-SITE BACKUP PIPELINE is producing stale/truncated archives, unblinded by the backup-freshness monitor fix (bug 52f7dee4, wf_e61def5b-144). Measured 2026-08-18T20:37-20:59Z: (1) WEEKLY BIG TIER STALE — newest charter-big-dbs archive bkp_20260809042446_xkenc1-charter-big-dbs.tgz @ 2026-08-09T04:33:35Z (3,123,822,678 B), age 9d16h > 9d threshold; the 08-16 Sunday weekly run was MISSED; sessions/economy big-tier DBs have no current offsite copy. Watch loop: machine-charter-backup-offsite. (2) HOURLY CRITICAL TIER UNDERSIZED — newest charter-critical-dbs archive bkp_20260818202017_7mzg5b-charter-critical-dbs.tgz @ 2026-08-18T20:20Z, 1,688,868 B vs 314,572,800 B floor — TRUNCATED since ~18:20Z; sessions.db very likely skipped at staging (the 2026-07-26 'stage:sessions file too large' class, which alerted only #hq and was invisible). Monitor evidence: /home/hasna/.local/state/backup-s3-freshness/check.log. Final text = machine-readable JSON.

THE WORK (smallest owned, real acceptance):
1. INVESTIGATE (read-only first): find and read the loop spec (machine-charter-backup-offsite via the loops CLI) and the staging/shipping script it invokes (backup_hourly_offsite.sh or the spec's command — locate the script path from the spec; record the owning surface: loops spec vs script file vs package). Establish WHY the 08-16 weekly run missed (loop schedule/run record — a missed fire, a failed run, a skipped slot) and WHY the hourly archives are truncated since ~18:20Z (staging log lines, the sessions.db 'file too large' class, any size cap). Record the exact evidence lines.
2. FIX (smallest owned repair in the owning surface): if the staging script has a size cap or failure path that silently drops sessions.db (the 'stage:sessions file too large' class), fix the cap/failure to fail loudly or handle the file (per the archive floor: the ~360MB normal size means sessions.db is normally included). If the weekly miss is a schedule defect, repair the schedule. Do NOT rearchitect the pipeline; do NOT touch S3 objects; do NOT delete anything. The script may be a loop spec body or a local script — edit the owning surface (loops spec via the loops CLI if it is a spec; the script file if it is a file). If the owning surface is a git repo, PR-first; if it is local config, record the before/after diff.
3. VERIFY (the real acceptance path): run the actual pipeline script (bounded) or the next natural hourly fire — the newest charter-critical-dbs archive must be >= the ~314,572,800 B floor AND contain sessions.db (tar -tzf check); the weekly tier either catches up via its next scheduled fire or via one manual bounded run of the big-tier script, and the newest charter-big-dbs archive must be < 9d old at completion. Then confirm the freshness monitor reports FRESH on both tiers (check.log after the run, or 'backup-freshness' monitor state). Paste literal output lines.
4. FAIL CLOSED on uncertainty: if a run cannot be produced in this lane (e.g. the hourly is far off and manual runs are unsafe), record the exact resume condition instead of claiming success.

NO SECRETS: never print/capture credential values; S3 operations use the machine's own configured profile, never echoed keys; capture path: redirect to files. Paste literal output lines. Record as you go: comments on ${TASK}, posts to #board. English. Lineage 'conversations agents register' named backup-fix-<your-role>.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane. Per the CONST: read the loop spec + script, establish the two causes (weekly miss, hourly truncation) with exact evidence lines, record the owning surface. DO NOT MUTATE in this lane.
Return (JSON): { loopSpecPath: string, scriptPath: string, owningSurface: string, weeklyCause: string, hourlyCause: string, evidence: string }
`

const FIX = CONST + `
ROLE: fix lane. Per the CONST: apply the smallest owned repair to the owning surface (loop spec / script / package). Record before/after diff of every changed line. If the surface is a git repo, worktree + PR (Agent trailer LAST); if local config, edit in place with backup.
Return (JSON): { surfaceChanged: string, diffSummary: string, prNumber: number|null, backupPath: string|null, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Run the real acceptance path per the CONST: newest charter-critical-dbs archive >= 314,572,800 B floor AND contains sessions.db (tar -tzf); newest charter-big-dbs archive < 9d old; monitor reports FRESH on both tiers (check.log). Paste literal output lines. If no run can be produced, return the exact resume condition instead.
Return (JSON): { criticalArchive: {name, size, sizeOk: bool, hasSessionsDb: bool}, bigArchive: {name, ageDays, ageOk: bool}, monitorFresh: {critical: bool, big: bool}, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review: (a) root cause established with evidence, not assumed (the 'file too large' class must be confirmed in the logs, not inherited); (b) the repair is the smallest owned change; (c) the verify ran the REAL pipeline (archive size + tar contents + monitor state), not a mock; (d) no destructive operations, no S3 mutation, no secrets; (e) fail-closed honesty if no run was produced. Post '[REVIEW] <GO|NO_GO> — backup-pipeline-fix @ <evidence> — lens: backup pipeline restore, reviewer backup-fix-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const REPORT = CONST + `
ROLE: report. If GO + acceptanceMet: comment ${TASK} completed with the causes, the repair, and the verified archive/monitor evidence; complete the task; post to #board. If NO_GO or acceptance not met: comment findings + resume condition, leave in_progress.
Return (JSON): { taskState: string, residue: [string] }
`

const INV_SCHEMA = { type: 'object', properties: { loopSpecPath: { type: 'string' }, scriptPath: { type: 'string' }, owningSurface: { type: 'string' }, weeklyCause: { type: 'string' }, hourlyCause: { type: 'string' }, evidence: { type: 'string' } }, required: ['owningSurface', 'weeklyCause', 'hourlyCause'] }
const FIX_SCHEMA = { type: 'object', properties: { surfaceChanged: { type: 'string' }, diffSummary: { type: 'string' }, prNumber: { type: ['number', 'null'] }, backupPath: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['surfaceChanged'] }
const VERIFY_SCHEMA = { type: 'object', properties: { criticalArchive: { type: 'object' }, bigArchive: { type: 'object' }, monitorFresh: { type: 'object' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const REPORT_SCHEMA = { type: 'object', properties: { taskState: { type: 'string' }, residue: { type: 'array' } }, required: ['taskState'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'backup-fix-investigate', phase: 'Investigate', schema: INV_SCHEMA })
log(`investigate: surface=${investigate && investigate.owningSurface} weekly=${investigate && investigate.weeklyCause ? investigate.weeklyCause.slice(0, 80) : '?'}`)

phase('Fix')
let fix = null
if (investigate && investigate.owningSurface) {
  fix = await agent(FIX, { label: 'backup-fix-fix', phase: 'Fix', schema: FIX_SCHEMA })
} else {
  fix = { surfaceChanged: 'none — investigation failed' }
}

phase('Verify')
let verify = null
if (fix && fix.surfaceChanged !== 'none — investigation failed') {
  verify = await agent(VERIFY, { label: 'backup-fix-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'investigation or fix did not complete', evidence: 'skipped' }
}

phase('Review')
let review = null
if (fix && fix.surfaceChanged !== 'none — investigation failed') {
  review = await agent(REVIEW, { label: 'backup-fix-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P0', title: 'investigation/fix did not complete', detail: JSON.stringify({ investigate, fix }) }] }
}

phase('Report')
const report = await agent(REPORT, { label: 'backup-fix-report', phase: 'Report', schema: REPORT_SCHEMA })

return { investigate, fix, verify, review, report }
