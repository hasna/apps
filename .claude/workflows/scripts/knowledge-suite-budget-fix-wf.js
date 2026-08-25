export const meta = {
  name: 'knowledge-suite-budget-fix',
  description: 'Wave #670 successor attempt (single, per the bounded-review adjudication): main-side fix for the @hasna/knowledge suite runner exit-99 class — CI build+test FAILs with 0 failing assertions (470 pass/2 skip, exit 99 = suite-level budget on the 4-core runner). Fix the owning layer: raise the suite budget or split the suite so serial execution completes. PR-first on hasna/apps main; then the wave rebases to the new main. IDEMPOTENCY CHECK FIRST: if an open PR already fixes this, verify and stop.',
  phases: [
    { title: 'Fix', detail: 'repro -> smallest owned fix -> PR + CI green' },
    { title: 'Review', detail: 'Fable adversarial review' },
    { title: 'Ship', detail: 'base gate + merge + resume line' },
  ],
}

const CONST = `
You are the knowledge-suite-budget-fix lane (owner-authorized wave #670 successor attempt). Final text = machine-readable JSON.

Non-negotiable rules:
- /home/hasna/workspace/repos/hasna/apps is READ/context only. Sync first (git -C <checkout> fetch origin && git -C <checkout> pull --ff-only; never discard local work). File mutation happens in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/knowledge-suite-budget-fix cut from origin/main. NEW BRANCH fix/knowledge-suite-budget; PR-first; never push to main. Commits end with 'Agent: knowledge-suite-budget-fix-<role>' (the ONLY attribution line; never Co-Authored-By).
- IDEMPOTENCY CHECK FIRST: before any fix, search for an existing open PR fixing this (gh pr list --repo hasna/apps --search 'knowledge suite budget' + 'exit 99' + 'guarded-writer'), and read wave PR hasna/apps#670 comments for a live fixer marker. If a live fix exists, verify and record it; do NOT duplicate.
- The defect class (measured by wave670r-fix cycle 6): CI build+test FAIL on @hasna/knowledge 'guarded-writer' test with exit code 99 — 0 failing assertions, 470 pass/2 skip; the suite runs serially on a 4-core runner and exceeds the suite-level budget. Reproduce: bun test in apps/knowledge with the CI budget setting; measure the actual runtime; the fix is the smallest owned change (raise the suite budget to a measured safe margin, or split the suite so serial execution fits the budget) in apps/knowledge — never weaken the test, never skip it, never disable the guard.
- TDD where applicable; the suite itself is the regression. Verify: package suite green (literal counts, exit 0 measured unpiped), 'bun install --frozen-lockfile' rc=0 in the worktree, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push, changeset (patch) via .changeset/knowledge-suite-budget.md.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on PR and on wave PR #670. English. Distinguish measured vs inferred.
`

const FIX = CONST + `
ROLE: fix lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Reproduce the knowledge suite exit-99 under the CI budget (measure actual runtime), name the owning config, apply the smallest owned fix in apps/knowledge (budget raise with measured margin, or suite split), suite green with literal counts and exit 0, frozen install rc=0, secrets scan clean, changeset patch, commit ('Agent: knowledge-suite-budget-fix-fix'), push, open the PR referencing the class and wave PR #670's resume condition.
Return (JSON): { prNumber, diffSummary, redBefore: {failed, named}, suiteCounts: {passed, failed}, actualRuntimeMs, secretsClean, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PR (number in the fix result): (a) the fix is the smallest owned change in apps/knowledge, (b) no test weakening (no skip, no disabled guard, no budget raised beyond a measured margin), (c) the exit-99 repro is real and fixed (red-before/green-after measured), (d) scope is apps/knowledge only, (e) CI green at the head sha, (f) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — knowledge-suite-budget @ <sha> — lens: wave #670 resume-condition fix, reviewer knowledge-suite-budget-fix-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship lane. If GO: base-movement gate first (git merge-tree against CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree} must hold after any rebase — a GO at a prior head does not cover a rebased head), then gh pr merge --squash --body-file ending 'Agent: knowledge-suite-budget-fix-ship', record the merged sha, comment wave PR #670 with the resume line: 'main-side knowledge suite budget fix merged (<sha>) — rebase release/version-wave onto origin/main and re-verify 5/5 CI'. If NO_GO: comment findings + resume condition, leave open.
Return (JSON): { merged, mergedSha, waveResumePosted, residue: [] }
`

const FIX_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, diffSummary: { type: 'string' }, redBefore: { type: 'object' }, suiteCounts: { type: 'object' }, actualRuntimeMs: { type: 'number' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['prNumber', 'diffSummary'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, waveResumePosted: { type: 'boolean' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Fix')
const fix = await agent(FIX, { label: 'knowledge-suite-budget-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' })

phase('Review')
const review = fix && fix.prNumber
  ? await agent(REVIEW, { label: 'knowledge-suite-budget-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'fix did not open a PR', detail: JSON.stringify(fix) }] }

phase('Ship')
const ship = review && review.verdict === 'GO'
  ? await agent(SHIP, { label: 'knowledge-suite-budget-ship', phase: 'Ship', schema: SHIP_SCHEMA })
  : { merged: false, mergedSha: null, waveResumePosted: false, residue: ['NO_GO — fix lane must remediate per findings'] }

return { prNumber: fix && fix.prNumber, diffSummary: fix && fix.diffSummary, review: review && review.verdict, ship }
