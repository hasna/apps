export const meta = {
  name: 'repos-fk-fix',
  description: 'Fix lane for BUG row ec0689a1 (task-drain dispatch 2026-08-20): @hasna/repos — worktree add / repo lookup fail with "pr monitor migration failed foreign-key verification". TDD regression first, smallest owned fix in apps/repos, suite green, changeset, PR, CI, Fable review, merge, complete the row with evidence',
  phases: [
    { title: 'Investigate', detail: 'idempotency check + reproduce the FK verification failure, name the code path' },
    { title: 'Fix', detail: 'failing regression test first, smallest owned fix, suite green, changeset, PR' },
    { title: 'Verify', detail: 'CI 5/5 at the new head' },
    { title: 'Review', detail: 'Fable adversarial review' },
    { title: 'Ship', detail: 'base gate, merge, complete row ec0689a1 with evidence' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = 'ec0689a1-f824-4652-9428-80075ff6139b'

const CONST = `
You are a lane of the repos-fk-fix workflow (task-drain dispatch 2026-08-20, BUG row ${ROW}). Bug: @hasna/repos — 'repos worktree add' / repo lookup fail with "pr monitor migration failed foreign-key verification". This blocks the harness-critical worktree path (the global worktree law depends on 'repos worktree add'). Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work; shared checkout dirty from other lanes — fetch refs and work from a worktree if the pull refuses). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/repos-fk-<n> from origin/main. NEW BRANCH fix/repos-fk; PR-first; never push to main. Commits end with 'Agent: repos-fk-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check for an existing open PR fixing the FK verification (gh pr list --repo hasna/apps --search 'repos fk in:title,body' + 'pr monitor in:title,body' + 'foreign-key in:title,body'), and read the BUG row's comments for an existing fixer or duplicate filing. NOTE: changeset repos-v15-fk-scope is pending on main — read what it changed before assuming this bug is the same defect; if the v15 FK scope work already landed the fix, verify and record; do NOT duplicate.
- Scope is apps/repos ONLY. The fix is the smallest owned change to the pr-monitor migration's foreign-key verification (the verification logic, the migration it verifies, or the interplay) so worktree add / repo lookup succeed with a correct FK schema. Do NOT weaken the verification — the FK check exists to protect the schema; the defect is likely the verification rejecting a VALID schema (or a migration ordering issue), not the schema being wrong.
- TDD: failing regression test first (red: the worktree-add / repo lookup path fails with 'pr monitor migration failed foreign-key verification'), smallest owned fix (green). Do NOT weaken tests.
- Verify: the repos app suite green (record literal counts), 'bun install --frozen-lockfile' rc=0, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push, changeset (patch — bug fix), and a LIVE repro of the original failing verb (repos worktree add against a temp/scratch target or the exact failing lookup) succeeding after the fix.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the PR and BUG row ${ROW}, posts to #board. English. Lineage 'conversations agents register' named repos-fk-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per the CONST). Then REPRODUCE: run the failing verb (repos worktree add or the repo lookup that fails — reproduce in a scratch environment, never against the shared checkout), read apps/repos — the pr-monitor migration (search 'foreign-key verification' / 'fk' / the migration runner), and the schema it verifies. NAME THE ROOT CAUSE: why the verification fails (rejecting a valid schema? ordering? a drift between the migration and the verify code?), distinguishing cause from symptom. State what you did not check.
Return (JSON): { idempotency: { existingPr: string|null, existingFixer: string|null, v15ScopeLanded: bool, decision: string }, rootCause: string, failingPath: string, repro: string, testFiles: [string], evidence: string }
`

const FIX = CONST + `
ROLE: fix lane. Per the CONST + the root cause ({ROOTCAUSE}): (1) write the failing regression test first (the failing verb succeeds against a valid schema — red); (2) implement the smallest owned fix in apps/repos; (3) full repos suite green (literal counts), frozen install rc=0, secrets scan, changeset (patch), commit ('Agent: repos-fk-<your-role>'), push, open the PR referencing BUG ${ROW}; (4) LIVE repro: the originally failing verb succeeds after the fix (scratch target, never the shared checkout).
Return (JSON): { prNumber: number, diffSummary: string, redBefore: {failed, named}, suiteCounts: {passed, failed}, secretsClean: bool, liveRepro: string, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks' on the PR ({PR}), re-run failed jobs, poll bounded (max 20 min), all five checks green at the new head (record the per-check table). The known environmental playwright stall, if the ONLY failure, re-run once and record.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PR ({PR}): (a) the regression test reproduces the FK verification failure and the fix makes the verb succeed with the schema still verified (red-before/green-after measured), (b) the fix is the smallest owned change and does NOT weaken the FK verification, (c) the live repro of the originally failing verb is recorded, (d) no test weakening, (e) scope is apps/repos only, (f) 5/5 CI green, (g) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — repos-fk-fix @ <sha> — lens: pr-monitor FK verification, reviewer repos-fk-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge the PR (base-movement gate first — merge-tree against origin/main; gh pr merge --squash --body-file ending 'Agent: repos-fk-ship'), record the merged sha, complete BUG ${ROW} with the evidence (merged sha, suite counts, review verdict, live repro). If NO_GO: comment findings + resume condition, leave open.
Return (JSON): { merged: bool, mergedSha: string|null, rowState: string, residue: [string] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { idempotency: { type: 'object' }, rootCause: { type: 'string' }, failingPath: { type: 'string' }, repro: { type: 'string' }, testFiles: { type: 'array' }, evidence: { type: 'string' } }, required: ['idempotency', 'rootCause'] }
const FIX_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, diffSummary: { type: 'string' }, redBefore: { type: 'object' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, liveRepro: { type: 'string' }, evidence: { type: 'string' } }, required: ['prNumber', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'repos-fk-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
let fix = null
if (investigate && investigate.idempotency && investigate.idempotency.decision !== 'already-done') {
  fix = await agent(FIX.replace('{ROOTCAUSE}', investigate.rootCause), { label: 'repos-fk-fix', phase: 'Fix', schema: FIX_SCHEMA })
} else {
  fix = { prNumber: 0, diffSummary: 'skipped', evidence: 'idempotency: already-done' }
}

phase('Verify')
let verify = null
if (fix && fix.prNumber) {
  verify = await agent(VERIFY.replace('{PR}', String(fix.prNumber)), { label: 'repos-fk-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'fix did not open a PR', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW.replace('{PR}', String(fix.prNumber)), { label: 'repos-fk-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'fix/verify did not complete', detail: JSON.stringify({ fix, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'repos-fk-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { investigate, fix, verify, review, ship }
