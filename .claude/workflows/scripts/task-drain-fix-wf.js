export const meta = {
  name: 'task-drain-fix',
  description: 'Task-drain fix lanes (owner-authorized 2026-08-19): two unowned @hasna bugs — repos worktree add --base passes full ref (a7eeab0a) and test-guard sentinel canary conflates wrapper-missing (ac4558ab, 3 recurrence instances); per-bug TDD fix lanes, Fable review, PR-first',
  phases: [
    { title: 'Fix', detail: 'per-bug lanes: regression test first, smallest owned repair, PR-first' },
    { title: 'Review', detail: 'Fable adversarial review per PR' },
    { title: 'Report', detail: 'tasks a7eeab0a/ac4558ab + #board' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'

const CONST = `
You are a lane of the task-drain-fix workflow (2026-08-19, owner-authorized task drain). Two unowned @hasna package bugs are fixed here, one lane per bug, PR-first in the hasna/apps monorepo (${MONOREPO}). Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/task-drain-<n> from origin/main. PR-first; never push to main. Commits end with 'Agent: task-drain-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: before mutating, check the task comments + open PRs touching the package for an existing fixer; if a fix already landed or is being worked, verify and record — do not duplicate.
- TDD FIRST: write the failing regression test that captures the bug, watch it fail, then implement the smallest owned repair (Fix Once — root cause, never a band-aid; no '|| true', no masking).
- No secrets: never print/capture/commit credential values; staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings in artifacts. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the bug task, posts to #board, mementos for non-obvious findings. English. Lineage 'conversations agents register' named task-drain-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const FIX_REPOS = CONST + `
ROLE: fix lane for task a7eeab0a (BUG: @hasna/repos — worktree add --base origin/main passes the full ref through). Read the task for the repro. The defect class: 'repos worktree add --base origin/main' should resolve to the branch/ref name it means; passing the full ref through corrupts the worktree naming or targeting. Write the failing regression first, then the smallest owned fix in apps/repos. Run the touched suite (bounded 8 min, record counts), secrets scan, commit ('Agent: task-drain-<your-role>'), push, open the PR referencing a7eeab0a.
Return (JSON): { prNumber: number, regressionTest: string, diffSummary: string, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const FIX_GUARD = CONST + `
ROLE: fix lane for task ac4558ab (BUG: @hasna/test-guard — sentinel canary conflates wrapper-missing with canary-not-engaged; 3 recurrence instances, latest #incidents 711587 'NOT ENGAGED' on rc=124). Read the task for the full evidence trail. The defect class: the sentinel reports 'NOT ENGAGED' when the wrapper itself is missing/never ran — one signal, two causes, no discrimination. Write the failing regression first (the fixture that distinguishes wrapper-missing from canary-not-engaged), then the smallest owned fix in the test-guard package (or apps/test-guard if it lives in the monorepo — locate it with 'repos repo' semantics). Run the touched suite, secrets scan, commit ('Agent: task-drain-<your-role>'), push, open the PR referencing ac4558ab.
Return (JSON): { prNumber: number, regressionTest: string, diffSummary: string, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the two PRs ({PRS}): (a) each regression test FAILED before the fix (TDD proven), (b) the fix is the smallest owned repair of the root cause (repos: ref-name resolution; test-guard: wrapper-missing vs not-engaged discrimination), (c) suites green (or failures recorded with owners), (d) secrets clean, (e) PR-first, no direct pushes. Post '[REVIEW] <GO|NO_GO> — task-drain-fix <repo> @ <sha> — lens: drain fix, reviewer task-drain-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { prs: [{number, verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}]}] }
`

const REPORT = CONST + `
ROLE: report. For each PR with GO: merge it (base-movement gate first, then gh pr merge --squash --body-file ending 'Agent: task-drain-ship'), complete the bug task with the fix + merged sha. NO_GO: comment findings + resume condition, leave in_progress. Post one line to #board per outcome.
Return (JSON): { prs: [{number, verdict, merged: bool, mergedSha: string|null, taskState: string}], residue: [string] }
`

const FIX_SCHEMA = { type: 'object', properties: { prNumber: { type: ['number', 'null'] }, regressionTest: { type: 'string' }, diffSummary: { type: 'string' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['diffSummary'] }
const REVIEW_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REPORT_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } }, residue: { type: 'array' } }, required: ['prs'] }

phase('Fix')
const [fixRepos, fixGuard] = await parallel([
  () => agent(FIX_REPOS, { label: 'task-drain-repos', phase: 'Fix', schema: FIX_SCHEMA }),
  () => agent(FIX_GUARD, { label: 'task-drain-guard', phase: 'Fix', schema: FIX_SCHEMA }),
])
const prs = [fixRepos, fixGuard].filter(Boolean).map(f => ({ number: f.prNumber, diff: f.diffSummary })).filter(p => p.number)
log(`fix lanes: ${prs.map(p => '#' + p.number).join(', ') || 'none opened'}`)

phase('Review')
let review = null
if (prs.length) {
  review = await agent(REVIEW.replace('{PRS}', JSON.stringify(prs)), { label: 'task-drain-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { prs: [] }
}

phase('Report')
const report = await agent(REPORT, { label: 'task-drain-report', phase: 'Report', schema: REPORT_SCHEMA })

return { fixRepos, fixGuard, review, report }
