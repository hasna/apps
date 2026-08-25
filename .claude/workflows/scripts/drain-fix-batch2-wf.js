export const meta = {
  name: 'drain-fix-batch2',
  description: 'Task-drain batch 2 (2026-08-19): (a) fix mementos stats expired_count — analytics.ts counts active rows with an expiry timestamp as expired (53a9f126, root-caused, unfixed); (b) give the test-guard sentinel a package home in hasna/apps (48d4725e, abstractions rule); per-lane TDD, Fable review, PR-first',
  phases: [
    { title: 'Fix', detail: 'two lanes: mementos expired_count regression+fix; test-guard package home scaffold + move' },
    { title: 'Review', detail: 'Fable adversarial review per PR' },
    { title: 'Report', detail: 'tasks 53a9f126/48d4725e + #board' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'

const CONST = `
You are a lane of the drain-fix-batch2 workflow (2026-08-19, owner-authorized task drain). Two unowned @hasna items are done here, one lane each, PR-first in ${MONOREPO}. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/drain2-<n> from origin/main. PR-first; never push to main. Commits end with 'Agent: drain2-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check task comments + open PRs touching the package; if a fix already landed or is being worked, verify and record — do not duplicate.
- TDD FIRST: the failing regression before the fix (red proven), then the smallest owned repair. No band-aids.
- No secrets: never print/capture/commit credential values; staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the bug task, posts to #board, mementos for non-obvious findings. English. Lineage 'conversations agents register' named drain2-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const FIX_MEMENTOS = CONST + `
ROLE: fix lane for task 53a9f126 (BUG: mementos stats expired_count). ROOT CAUSE (fleet comment 2026-08-17): apps/mementos/src/db/analytics.ts getMemoryStats computes expired_count with 'status = 'expired' OR (expires_at IS NOT NULL AND expires_at < datetime('now'))' — counting still-active rows that merely carry an expiry timestamp (measured: expired_count 874 vs by_status.expired 0). Write the failing regression first (an active row with an expires_at must NOT count in expired_count; only status='expired' rows do), then the smallest owned fix in analytics.ts. Run the mementos suite (bounded 8 min, record counts), secrets scan, commit ('Agent: drain2-<your-role>'), push, PR referencing 53a9f126.
Return (JSON): { prNumber: number, regressionTest: string, diffSummary: string, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const FIX_TESTGUARD = CONST + `
ROLE: fix lane for task 48d4725e (ABSTRACTIONS: give the test-guard sentinel a package home). The bun-test concurrency cap sentinel lives only at ~/.hasna/test-guard (machine-local, not a git repo; npm @hasna/test-guard 404; not in the monorepo) — its ac4558ab fix could not ship as a PR. Per the package-level abstractions rule, create the smallest package home in ${MONOREPO}: apps/test-guard with package.json (@hasna/test-guard, version 0.0.1), the sentinel script + battery as tracked files (port the CURRENT fixed versions from ~/.hasna/test-guard), README, and a smoke test wiring (the battery's section 16 as the repo's test). Do NOT change the sentinel logic — port it byte-faithful and prove the battery runs (51P/2F with the 2 pre-existing env-dependent FAILs recorded, or better if env allows). Monorepo gates: 'bun run check' passes or failures recorded. Commit ('Agent: drain2-<your-role>'), push, PR referencing 48d4725e. If a name conflict or gate blocks the app, record the exact gate and return prNumber null with the reason.
Return (JSON): { prNumber: number|null, diffSummary: string, batteryRun: string, checkPassed: bool, gateBlock: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PRs ({PRS}): (a) each regression FAILED before the fix (red proven), (b) smallest owned repair, (c) suites green or failures recorded with owners, (d) secrets clean, (e) PR-first. Post '[REVIEW] <GO|NO_GO> — drain2 <item> @ <sha> — lens: drain batch 2, reviewer drain2-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { prs: [{number, verdict, findings: [{severity, title, detail}]}] }
`

const REPORT = CONST + `
ROLE: report. For each GO PR: merge (base-movement gate first; gh pr merge --squash --body-file ending 'Agent: drain2-ship'), complete the task with the fix + merged sha. NO_GO: comment findings + resume condition, leave in_progress. Post one #board line per outcome.
Return (JSON): { prs: [{number, verdict, merged, mergedSha, taskState}], residue: [string] }
`

const FIX_SCHEMA = { type: 'object', properties: { prNumber: { type: ['number', 'null'] }, regressionTest: { type: 'string' }, diffSummary: { type: 'string' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, batteryRun: { type: 'string' }, checkPassed: { type: 'boolean' }, gateBlock: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['diffSummary'] }
const REVIEW_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REPORT_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } }, residue: { type: 'array' } }, required: ['prs'] }

phase('Fix')
const [fixMem, fixTg] = await parallel([
  () => agent(FIX_MEMENTOS, { label: 'drain2-mementos', phase: 'Fix', schema: FIX_SCHEMA }),
  () => agent(FIX_TESTGUARD, { label: 'drain2-testguard', phase: 'Fix', schema: FIX_SCHEMA }),
])
const prs = [fixMem, fixTg].filter(Boolean).map(f => ({ number: f.prNumber, diff: f.diffSummary })).filter(p => p.number)
log(`fix lanes: ${prs.map(p => '#' + p.number).join(', ') || 'none opened'}`)

phase('Review')
let review = null
if (prs.length) {
  review = await agent(REVIEW.replace('{PRS}', JSON.stringify(prs)), { label: 'drain2-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { prs: [] }
}

phase('Report')
const report = await agent(REPORT, { label: 'drain2-report', phase: 'Report', schema: REPORT_SCHEMA })

return { fixMementos: fixMem, fixTestguard: fixTg, review, report }
