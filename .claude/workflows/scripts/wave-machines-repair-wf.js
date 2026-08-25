export const meta = {
  name: 'wave-machines-repair',
  description: 'Machines workspace-member repair (wave #670 gate class with NO owner, from wave670-remediate verify): the wave rewrote loops optionalDependencies @hasna/machines 0.0.49->0.2.30 and dispatch ^0.0.24->^0.2.30 onto the workspace machines 0.2.30 member — no prepare script, gitignored dist, so dist/consumer.js never exists in a fresh checkout (deterministic TS2307 in gates + test-suites). Fix ON MAIN per the contracts/machines precedent d1936c56d3 (committed declarations / install-time dist story) so workspace-linked consumers resolve; ordinary PR, TDD, Fable review, merge',
  phases: [
    { title: 'Fix', detail: 'machines workspace-member dist story (committed declarations per precedent d1936c56d3)' },
    { title: 'Verify', detail: '5/5 CI green at the new head' },
    { title: 'Review', detail: 'Fable adversarial review' },
    { title: 'Ship', detail: 'merge GO' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'

const CONST = `
You are a lane of the wave-machines-repair workflow (2026-08-20). Wave PR hasna/apps#670 (Version Packages) rewrote loops optionalDependencies @hasna/machines 0.0.49->0.2.30 and dispatch ^0.0.24->^0.2.30 onto the WORKSPACE machines 0.2.30 member, which has NO prepare script and a gitignored dist/ — so dist/consumer.js (and siblings) never exist in a fresh checkout, and the wave's gates + test-suites jobs die at install prepare with deterministic TS2307 'Cannot find module '@hasna/machines/consumer'' (also TS7016 for @hasna/contracts/* — that class is held on the contracts-split lane, NOT this one). The machines class has NO owner; the wave670-verify resume condition names it. THE FIX ON MAIN (per the contracts/machines precedent d1936c56d3 — committed declarations): give apps/machines an install-time dist story so workspace-linked consumers resolve in a fresh checkout — e.g. committed .d.ts declarations for the exported subpaths (consumer, etc.) or a prepare script that builds dist deterministically — the smallest owned change that makes the workspace-linked path resolve. Ordinary content PR on main; NO version bumps. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work; shared checkout dirty from other lanes — fetch refs and work from a worktree if the pull refuses). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/wave-mr2-<n> from origin/main. NEW BRANCH wave-machines-repair; PR-first; never push to main. Commits end with 'Agent: wave-mr2-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check for an open PR touching the machines dist/declarations class (gh pr list --search 'machines in:title,body'); if a repair already landed, verify and record; do not duplicate.
- TDD: write the failing regression first (the workspace-linked TS2307 — e.g. a fresh-checkout import test of apps/machines/consumer or the loops optionalDeps resolution), red, then the smallest owned fix, green.
- Verify: machines + loops + dispatch suites green (record counts), 'bun install --frozen-lockfile' rc=0, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the PR, posts to #board. English. Lineage 'conversations agents register' named wave-mr2-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const FIX = CONST + `
ROLE: fix lane. Per the CONST: reproduce the fresh-checkout TS2307 (red), apply the smallest owned fix (committed declarations or deterministic prepare), prove machines/loops/dispatch suites green at the new head (record counts), frozen install rc=0, secrets scan, commit ('Agent: wave-mr2-<your-role>'), push, open the PR referencing wave #670's resume condition.
Return (JSON): { prNumber: number, diffSummary: string, fix: string, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks' on the PR ({PR}), re-run failed jobs, poll bounded (max 20 min), all five checks green at the new head (record the per-check table). The known environmental playwright stall, if the ONLY failure, re-run once and record.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PR ({PR}): (a) the fix is the smallest owned change (committed declarations or deterministic prepare — measured, not guessed), (b) the regression is red-before/green-after, (c) NO version bumps, (d) 5/5 CI green, (e) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — wave-machines-repair @ <sha> — lens: machines workspace-member dist story, reviewer wave-mr2-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge the PR (base-movement gate first — merge-tree against origin/main; gh pr merge --squash --body-file ending 'Agent: wave-mr2-ship'), record the merged sha, comment on wave #670 that the machines class cleared. If NO_GO: comment findings + resume condition, leave open.
Return (JSON): { merged: bool, mergedSha: string|null, residue: [string] }
`

const FIX_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, diffSummary: { type: 'string' }, fix: { type: 'string' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['prNumber', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, residue: { type: 'array' } }, required: ['merged'] }

phase('Fix')
const fix = await agent(FIX, { label: 'wave-mr2-fix', phase: 'Fix', schema: FIX_SCHEMA })

phase('Verify')
let verify = null
if (fix && fix.prNumber) {
  verify = await agent(VERIFY.replace('{PR}', String(fix.prNumber)), { label: 'wave-mr2-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'fix did not open a PR', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW.replace('{PR}', String(fix.prNumber)), { label: 'wave-mr2-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'fix/verify did not complete', detail: JSON.stringify({ fix, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'wave-mr2-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { fix, verify, review, ship }
