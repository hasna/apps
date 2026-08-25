export const meta = {
  name: 'loops-bound-claim-fix',
  description: 'Fix lane for BUG row e22f6727: @hasna/loops 0.5.3 — runner bound-scope claim fails opaque; machine-pinned loops unclaimable (task-drain dispatch 2026-08-20). Investigate the claim path (bound-scope runner claim), TDD regression first, smallest owned fix in apps/loops, suite green, changeset, PR, CI, Fable review, merge, complete the row with evidence',
  phases: [
    { title: 'Investigate', detail: 'idempotency check + reproduce the bound-scope claim failure, name root cause' },
    { title: 'Fix', detail: 'failing regression test first, smallest owned fix, suite green, changeset, PR' },
    { title: 'Verify', detail: 'CI 5/5 at the new head' },
    { title: 'Review', detail: 'Fable adversarial review' },
    { title: 'Ship', detail: 'base gate, merge, complete row e22f6727 with evidence' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = 'e22f6727-2e7f-4b19-8797-38ec7abc367c'

const CONST = `
You are a lane of the loops-bound-claim-fix workflow (task-drain dispatch 2026-08-20, BUG row e22f6727 — resolve the id via 'todos show e22f6727 --json' at lane start if the full UUID differs from the 8-char prefix). Bug: @hasna/loops 0.5.3 — the runner's bound-scope claim fails OPAQUELY (no usable error), leaving machine-pinned loops unclaimable. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work; shared checkout dirty from other lanes — fetch refs and work from a worktree if the pull refuses). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/loops-claim-<n> from origin/main. NEW BRANCH fix/loops-bound-claim; PR-first; never push to main. Commits end with 'Agent: loops-claim-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check for an existing open PR fixing the bound-scope claim (gh pr list --repo hasna/apps --search 'loops claim in:title,body' + 'loops bound in:title,body'), and read the BUG row's comments for an existing fixer or duplicate filing. If a live fix exists, verify and record; do NOT duplicate.
- Scope is apps/loops ONLY. The fix is the smallest owned change to the runner claim path (bound-scope claim error transparency + the machine-pin unclaimability), NOT a rewrite.
- TDD: failing regression test first (red), smallest owned fix (green). Do NOT weaken tests.
- Verify: the loops app suite green (record literal counts), 'bun install --frozen-lockfile' rc=0, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push, changeset (patch — bug fix).
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the PR and BUG row, posts to #board. English. Lineage 'conversations agents register' named loops-claim-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per the CONST). Then REPRODUCE: read apps/loops — the runner claim code path (bound-scope claim: search for 'claim' in the runner/lease surfaces, the bound-scope/claim-scope vocabulary, the machine-pin field), and reproduce the opaque failure (run the claim verb against a bound-scope loop in a test harness or read the code path that swallows the error). NAME THE ROOT CAUSE: why the claim fails opaquely and why machine-pinned loops are unclaimable — distinguish cause from symptom. State what you did not check.
Return (JSON): { idempotency: { existingPr: string|null, existingFixer: string|null, decision: string }, rootCause: string, failingPath: string, repro: string, testFiles: [string], evidence: string }
`

const FIX = CONST + `
ROLE: fix lane. Per the CONST + the root cause ({ROOTCAUSE}): (1) write the failing regression test first (the bound-scope claim must fail with a USABLE error, and the machine-pinned claim path must either claim successfully or fail with the exact reason — red); (2) implement the smallest owned fix in apps/loops; (3) full loops suite green (literal counts), frozen install rc=0, secrets scan, changeset (patch), commit ('Agent: loops-claim-<your-role>'), push, open the PR referencing BUG e22f6727.
Return (JSON): { prNumber: number, diffSummary: string, redBefore: {failed, named}, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks' on the PR ({PR}), re-run failed jobs, poll bounded (max 20 min), all five checks green at the new head (record the per-check table). The known environmental playwright stall, if the ONLY failure, re-run once and record.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PR ({PR}): (a) the regression test reproduces the opaque bound-scope claim failure and the machine-pin unclaimability (red-before/green-after measured), (b) the fix is the smallest owned change, (c) no test weakening, (d) scope is apps/loops only, (e) 5/5 CI green, (f) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — loops-bound-claim-fix @ <sha> — lens: runner claim path, reviewer loops-claim-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge the PR (base-movement gate first — merge-tree against origin/main; gh pr merge --squash --body-file ending 'Agent: loops-claim-ship'), record the merged sha, complete BUG e22f6727 with the evidence (merged sha, suite counts, review verdict). If NO_GO: comment findings + resume condition, leave open.
Return (JSON): { merged: bool, mergedSha: string|null, rowState: string, residue: [string] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { idempotency: { type: 'object' }, rootCause: { type: 'string' }, failingPath: { type: 'string' }, repro: { type: 'string' }, testFiles: { type: 'array' }, evidence: { type: 'string' } }, required: ['idempotency', 'rootCause'] }
const FIX_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, diffSummary: { type: 'string' }, redBefore: { type: 'object' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['prNumber', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'loops-claim-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
let fix = null
if (investigate && investigate.idempotency && investigate.idempotency.decision !== 'already-done') {
  fix = await agent(FIX.replace('{ROOTCAUSE}', investigate.rootCause), { label: 'loops-claim-fix', phase: 'Fix', schema: FIX_SCHEMA })
} else {
  fix = { prNumber: 0, diffSummary: 'skipped', evidence: 'idempotency: already-done' }
}

phase('Verify')
let verify = null
if (fix && fix.prNumber) {
  verify = await agent(VERIFY.replace('{PR}', String(fix.prNumber)), { label: 'loops-claim-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'fix did not open a PR', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW.replace('{PR}', String(fix.prNumber)), { label: 'loops-claim-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'fix/verify did not complete', detail: JSON.stringify({ fix, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'loops-claim-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { investigate, fix, verify, review, ship }
