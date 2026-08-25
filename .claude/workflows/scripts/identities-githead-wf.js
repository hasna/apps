export const meta = {
  name: 'identities-githead-fix',
  description: 'Task-drain row 949b6ed5 (BUG: identities — post-publish gitHead rejects real publishing commit): post-publish verification compares npm gitHead to an ancestor candidate and cannot satisfy the mandatory post-publish gate after a successful publish. TDD both directions, Fable review, PR-first',
  phases: [
    { title: 'Fix', detail: 'regression-first fix of the gitHead verification in apps/identities' },
    { title: 'Review', detail: 'Fable adversarial review' },
    { title: 'Report', detail: 'merge GO, complete row 949b6ed5 by evidence, #board' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '949b6ed5-3190-409f-af68-f6851095310c'

const CONST = `
You are a lane of the identities-githead-fix workflow (2026-08-19, owner-authorized task drain). Row ${ROW}: BUG: identities — post-publish gitHead rejects real publishing commit. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/githead-<n> from origin/main. PR-first; never push to main. Commits end with 'Agent: githead-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check the row's comments + open PRs touching apps/identities; if a fix already landed or is being worked, verify and record — do not duplicate.
- TDD FIRST: the failing regression before the fix (red proven), then the smallest owned repair. No band-aids.
- No secrets: never print/capture/commit credential values; staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the row + PR, posts to #board, mementos. English. Lineage 'conversations agents register' named githead-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const FIX = CONST + `
ROLE: fix lane. Row metadata (authoritative): expected — 'Post-publish verification accepts the actual publishing commit and still rejects wrong gitHead or non-decision tree drift, including after squash merge.' observed — 'Merged main compares npm gitHead to an ancestor candidate and cannot satisfy the mandatory post-publish gate after a successful publish.' acceptance — 'Regression tests pass in both directions, final typecheck and declared test gate are green, npm-publish pre...' (read the full row for the rest). Steps: locate the post-publish verification in apps/identities (the gitHead comparison), write the failing regression FIRST (a real publish after squash merge must pass; a wrong gitHead or drift must still fail), then the smallest owned fix (resolve the actual publishing commit rather than an ancestor candidate). Run the identities suite (bounded 8 min, record counts), secrets scan, commit ('Agent: githead-<your-role>'), push, PR referencing ${ROW}.
Return (JSON): { prNumber: number|null, regressionTest: string, diffSummary: string, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PR ({PR}): (a) the regression FAILED before the fix (red proven) and covers BOTH directions (real publish passes, wrong gitHead/drift fails), (b) smallest owned repair, (c) suite green at head, (d) secrets clean, (e) PR-first. Post '[REVIEW] <GO|NO_GO> — identities gitHead @ <sha> — lens: post-publish gate, reviewer githead-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: report. If GO: merge the PR (base-movement gate first; gh pr merge --squash --body-file ending 'Agent: githead-ship'), complete row ${ROW} with the fix + merged sha. NO_GO: comment findings + resume condition, leave the row in_progress. Post one #board line.
Return (JSON): { prNumber: number, verdict: string, merged: bool, mergedSha: string|null, rowState: string, residue: [string] }
`

const FIX_SCHEMA = { type: 'object', properties: { prNumber: { type: ['number', 'null'] }, regressionTest: { type: 'string' }, diffSummary: { type: 'string' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['diffSummary'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, verdict: { type: 'string' }, merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['rowState'] }

phase('Fix')
const fix = await agent(FIX, { label: 'githead-fix', phase: 'Fix', schema: FIX_SCHEMA })

phase('Review')
let review = null
if (fix && fix.prNumber) {
  review = await agent(REVIEW.replace('{PR}', String(fix.prNumber)), { label: 'githead-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'fix lane did not open a PR', detail: 'record the exact gate' }] }
}

phase('Report')
const ship = await agent(SHIP, { label: 'githead-ship', phase: 'Report', schema: SHIP_SCHEMA })

return { fix, review, ship }
