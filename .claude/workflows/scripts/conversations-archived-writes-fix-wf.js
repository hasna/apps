export const meta = {
  name: 'conversations-archived-writes-fix',
  description: 'Fix lane for BUG row 9b502ed8 (task-drain dispatch 2026-08-20): @hasna/conversations — an archived channel (#strategy) still accepts new posts; the archive guard is missing on the send path. TDD regression first, smallest owned fix in apps/conversations (archived channels must reject new posts with a usable error), suite green, changeset, PR, CI, Fable review, merge, complete the row with evidence',
  phases: [
    { title: 'Investigate', detail: 'idempotency check + reproduce the archived-channel write, name the code path' },
    { title: 'Fix', detail: 'failing regression test first, smallest owned fix, suite green, changeset, PR' },
    { title: 'Verify', detail: 'CI 5/5 at the new head' },
    { title: 'Review', detail: 'Fable adversarial review' },
    { title: 'Ship', detail: 'base gate, merge, complete row 9b502ed8 with evidence' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '9b502ed8-9a56-4248-973b-ba489eae0eea'

const CONST = `
You are a lane of the conversations-archived-writes-fix workflow (task-drain dispatch 2026-08-20, BUG row ${ROW}). Bug: @hasna/conversations — an ARCHIVED channel (#strategy) still accepts new posts; the archive guard is missing or bypassed on the send path. An archived channel must reject new posts with a usable error naming the archived state. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work; shared checkout dirty from other lanes — fetch refs and work from a worktree if the pull refuses). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/archived-writes-<n> from origin/main. NEW BRANCH fix/conversations-archived-writes; PR-first; never push to main. Commits end with 'Agent: archived-writes-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check for an existing open PR fixing the archived-write path (gh pr list --repo hasna/apps --search 'archived in:title,body' + 'conversations in:title,body'), and read the BUG row's comments for an existing fixer or duplicate filing. If a live fix exists, verify and record; do NOT duplicate.
- Scope is apps/conversations ONLY. The fix is the smallest owned change: the send/post path must reject writes to archived channels with a usable error (naming the archived state), in both the local store and the hosted server path (mirror the archive guard already used by other verbs if one exists — check the send verbs' guards first). Do NOT touch the archive/merge machinery from the channel-merge feature.
- TDD: failing regression test first (red: posting to an archived channel succeeds), smallest owned fix (green). Do NOT weaken tests.
- Verify: the conversations app suite green (record literal counts), 'bun install --frozen-lockfile' rc=0, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push, changeset (patch — bug fix).
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the PR and BUG row ${ROW}, posts to #board. English. Lineage 'conversations agents register' named archived-writes-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per the CONST). Then REPRODUCE: read apps/conversations — the send/post code path (CLI send verb, the store send method, the hosted server send handler), and the archive state (archived_at field / archived flag) — and reproduce the bug (posting to an archived channel succeeds). NAME THE CODE PATH where the guard is missing and the exact guard shape used by other verbs (e.g. archive/unarchive verbs, rename) to mirror. State what you did not check.
Return (JSON): { idempotency: { existingPr: string|null, existingFixer: string|null, decision: string }, codePath: string, repro: string, guardPattern: string, testFiles: [string], evidence: string }
`

const FIX = CONST + `
ROLE: fix lane. Per the CONST + the code path ({CODEPATH}): (1) write the failing regression test first (posting to an archived channel must be rejected with a usable error naming the archived state — red; both local store and hosted path); (2) implement the smallest owned fix in apps/conversations (mirror the guard pattern {GUARDPATTERN}); (3) full conversations suite green (literal counts), frozen install rc=0, secrets scan, changeset (patch), commit ('Agent: archived-writes-<your-role>'), push, open the PR referencing BUG ${ROW}.
Return (JSON): { prNumber: number, diffSummary: string, redBefore: {failed, named}, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks' on the PR ({PR}), re-run failed jobs, poll bounded (max 20 min), all five checks green at the new head (record the per-check table). The known environmental playwright stall, if the ONLY failure, re-run once and record.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PR ({PR}): (a) the regression test reproduces the archived-write acceptance and the fix rejects with a usable error (red-before/green-after measured), (b) the fix is the smallest owned change mirroring the existing guard pattern, (c) the archive/merge machinery is untouched, (d) no test weakening, (e) scope is apps/conversations only, (f) 5/5 CI green, (g) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — conversations-archived-writes-fix @ <sha> — lens: archived-channel write guard, reviewer archived-writes-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge the PR (base-movement gate first — merge-tree against origin/main; gh pr merge --squash --body-file ending 'Agent: archived-writes-ship'), record the merged sha, complete BUG ${ROW} with the evidence (merged sha, suite counts, review verdict). If NO_GO: comment findings + resume condition, leave open.
Return (JSON): { merged: bool, mergedSha: string|null, rowState: string, residue: [string] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { idempotency: { type: 'object' }, codePath: { type: 'string' }, repro: { type: 'string' }, guardPattern: { type: 'string' }, testFiles: { type: 'array' }, evidence: { type: 'string' } }, required: ['idempotency', 'codePath'] }
const FIX_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, diffSummary: { type: 'string' }, redBefore: { type: 'object' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['prNumber', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'archived-writes-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
let fix = null
if (investigate && investigate.idempotency && investigate.idempotency.decision !== 'already-done') {
  fix = await agent(FIX.replace('{CODEPATH}', investigate.codePath).replace('{GUARDPATTERN}', investigate.guardPattern), { label: 'archived-writes-fix', phase: 'Fix', schema: FIX_SCHEMA })
} else {
  fix = { prNumber: 0, diffSummary: 'skipped', evidence: 'idempotency: already-done' }
}

phase('Verify')
let verify = null
if (fix && fix.prNumber) {
  verify = await agent(VERIFY.replace('{PR}', String(fix.prNumber)), { label: 'archived-writes-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'fix did not open a PR', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW.replace('{PR}', String(fix.prNumber)), { label: 'archived-writes-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'fix/verify did not complete', detail: JSON.stringify({ fix, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'archived-writes-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { investigate, fix, verify, review, ship }
