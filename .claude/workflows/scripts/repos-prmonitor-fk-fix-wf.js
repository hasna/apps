export const meta = {
  name: 'repos-prmonitor-fk-fix',
  description: 'Fix the second instance of the whole-DB FK-verify brick: the pr-monitor migration in @hasna/repos fails foreign-key verification on drifted registries, bricking every repos CLI verb (bug 4d0d757c)',
  phases: [
    { title: 'Fix', detail: 'scope the pr-monitor migration FK verify to its own table + drifted-registry fixture' },
    { title: 'Review', detail: 'Fable review of the PR' },
    { title: 'Merge', detail: 'merge with base-movement gate' },
    { title: 'Report', detail: 'bug task evidence + release-state note' },
  ],
}

const TASK = '4d0d757c-1b3e-41d9-997c-f2a4a8d78f68'
const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'

const CONST = `
You are a lane of the repos-prmonitor-fk-fix workflow (2026-08-18, bug ${TASK}, HIGH). SECOND INSTANCE of the whole-DB FK-verify brick: bug 01c45b0c (fixed by PR #530, merged 2026-08-18T18:23:29Z — it scoped MIGRATION v15's verify to its own table, changing apps/repos/src/db/database.ts + a fixture + a changeset for 0.1.50, NOT YET PUBLISHED/INSTALLED — installed and published are both still 0.1.49). The PR-MONITOR migration (the one creating pr_monitor_state) has its OWN foreign-key verification that runs the same whole-DB check and bricks EVERY repos CLI verb on this station's drifted registry (1560 pre-existing FK violations): repro 'repos worktree add apps --name <n>' -> UNEXPECTED_ERROR 'pr monitor migration failed foreign-key verification' (rc non-zero). Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). Work in a worktree ~/.hasna/repos/worktrees/apps/repos-prmonitor-fk-<n> from origin/main. NEVER git worktree add to the shared checkout. Never push to main. PR-first; merge ONLY via gh pr merge <n> --squash --body-file <file whose LAST line is 'Agent: repos-fk-fix-<your-role>'>.
- IDEMPOTENCY FIRST: if the bug task is already completed with a verified fix, verify the installed state and SKIP. If an open PR already fixes the pr-monitor migration verify, review THAT PR — never open a second.
- THE FIX (smallest owned, root cause not symptom): read apps/repos/src/db/migrations/ — find the pr-monitor migration's verify block. It repeats the whole-DB foreign_key_check pattern (the same defect v15 had). Scope it to what THAT migration actually created (the pr_monitor_state table and the FKs it defines) — reuse the scoped-verify mechanism PR #530 introduced in database.ts if it is generic, or extend it minimally so both migrations share ONE scoped-verify path (never a second copy of the pattern — Fix Once: one abstraction, both migrations call it). TDD FIRST: (a) drifted-registry fixture — a copy of a registry DB carrying pre-existing FK violations in unrelated tables — the pr-monitor migration must apply and the CLI verbs must work; (b) clean-registry control must also pass; (c) the migration stays idempotent on both. NEVER modify the real ~/.hasna/repos/repos.db (reproduce on a copy or a scratch registry).
- CHANGESET: this is a PATCH release — add a changeset for @hasna/repos 0.1.50 (the existing .changeset/repos-v15-fk-scope.md already targets 0.1.50; if a second changeset is needed use a distinct name for the same 0.1.50 bump — two changesets, one patch release). The release itself is owned by the publish-all cadence — the lane lands the fix PR + changeset only.
- VERDICT DISCIPLINE: merging requires a [REVIEW] GO at the CURRENT head; base-movement gate (merge-tree == head or delta disjoint from the PR's own files); bun.lock overlap -> regenerate with 'bun install --lockfile-only' and re-verify.
- No secrets: never print/capture/commit credential values. Staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings in artifacts. Capture path: redirect to files, never pipe large reads. Paste literal output lines.
- Record as you go: comments on ${TASK}, posts to #board. English. Lineage identity 'conversations agents register' named repos-fk-fix-<your-role>.
- Release-state note: installed and published @hasna/repos are BOTH still 0.1.49 — the 0.1.50 changeset from PR #530 has not shipped (release-train rung aaef650b pending). Record the observed state; do NOT publish yourself.
`

const FIX = CONST + `
ROLE: fix lane. Execute the fix per the CONST: read the pr-monitor migration, scope its FK verify to its own table via the shared mechanism from PR #530 (or extend #530's helper minimally so both migrations use ONE path), write the drifted-registry + clean-control fixtures first (fail-before/pass-after), run the repos suite (bounded 12 min, record counts), shellcheck/typecheck, secrets scan, commit ('Agent: repos-fk-fix' trailer LAST), push, open the PR naming bug ${TASK} and referencing PR #530's mechanism.
Return (JSON): { fixed: bool, prNumber: number|null, migration: string, scopedTo: string, fixtures: {driftedPassed: bool, cleanPassed: bool, failBefore: string}, tests: {passed, failed}, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PR: (a) the pr-monitor migration's verify is scoped to its own table — ZERO whole-DB foreign_key_check anywhere in the migrations; (b) the shared mechanism is used (one abstraction, not a second copy); (c) fixtures discriminate (drifted registry migrates clean; clean control passes; fail-before shown); (d) tests pass, secrets clean. Post '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: FK-verify scoping r2, reviewer repos-fk-fix-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const MERGE = CONST + `
ROLE: merge lane. The PR (number {PR}): head == reviewed sha; base-movement gate at CURRENT origin/main; gh pr merge <n> --squash --body-file <file ending 'Agent: repos-fk-fix-ship'>; record merged sha.
Return (JSON): { merged: bool, mergedSha: string|null, reason: string|null }
`

const REPORT = CONST + `
ROLE: report. If GO + merged: comment ${TASK} completed with the PR, merged sha, fixture evidence and the release-state note (0.1.49 still installed/published; 0.1.50 ships via publish-all), complete the task. If NO_GO: comment the findings, leave in_progress. Post one line to #board.
Return (JSON): { taskState: string, prNumber: number|null, residue: [string] }
`

const FIX_SCHEMA = { type: 'object', properties: { fixed: { type: 'boolean' }, prNumber: { type: ['number', 'null'] }, migration: { type: 'string' }, scopedTo: { type: 'string' }, fixtures: { type: 'object' }, tests: { type: 'object' }, evidence: { type: 'string' } }, required: ['fixed'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const MERGE_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, reason: { type: ['string', 'null'] } }, required: ['merged'] }
const REPORT_SCHEMA = { type: 'object', properties: { taskState: { type: 'string' }, prNumber: { type: ['number', 'null'] }, residue: { type: 'array' } }, required: ['taskState'] }

phase('Fix')
const fix = await agent(FIX, { label: 'repos-fk-fix-lane', phase: 'Fix', schema: FIX_SCHEMA })
log(`fix: fixed=${fix && fix.fixed} pr=${fix && fix.prNumber}`)

phase('Review')
let review = null
if (fix && fix.fixed && fix.prNumber) {
  review = await agent(REVIEW, { label: 'repos-fk-fix-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P0', title: 'fix lane did not produce a PR', detail: JSON.stringify(fix) }] }
}

phase('Merge')
let merge = null
if (review && review.verdict === 'GO' && fix && fix.prNumber) {
  merge = await agent(MERGE.replace('{PR}', String(fix.prNumber)), { label: 'repos-fk-fix-merge', phase: 'Merge', schema: MERGE_SCHEMA })
}

phase('Report')
const report = await agent(REPORT, { label: 'repos-fk-fix-report', phase: 'Report', schema: REPORT_SCHEMA })

return { fix, review, merge, report }
