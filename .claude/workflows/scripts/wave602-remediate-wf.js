export const meta = {
  name: 'wave602-remediate',
  description: 'Remediation cycle 1 for hasna/apps#602 (ship-latest wave, Fable NO_GO): bunx changeset version rewrote dependency ranges without regenerating bun.lock -> all five CI jobs fail at Install. Fix: run bun install in the wave worktree, commit bun.lock, push; CI green; Fable re-review (cycle 1); merge; [SHIP-READY]; close superseded #595',
  phases: [
    { title: 'Remediate', detail: 'regenerate bun.lock on the wave branch, push' },
    { title: 'Verify', detail: 'all five CI checks green at the new head + frozen install rc=0' },
    { title: 'Review', detail: 'Fable re-review (cycle 1, scoped to the lockfile defect)' },
    { title: 'Ship', detail: 'merge GO, [SHIP-READY] on git-publishing, close #595' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PR = 602

const CONST = `
You are a lane of the wave602-remediate workflow (2026-08-19). PR hasna/apps#${PR} (the 36-app version wave, branch release/version-wave, head 2e379b07) got ship-latest-review NO_GO with ONE P1: 'Wave-caused CI install gate failure: bun.lock not regenerated' — all five CI checks fail at the Install step with the literal 'error: lockfile had changes, but lockfile is frozen'; at merge-base 13087f2787 frozen install rc=0, at head rc=1, and after an unfrozen 'bun install' the lockfile changes 102 insertions/184 deletions (dependency-range rewrites only) and frozen install passes. Root cause: 'bunx changeset version' rewrites package.json ranges but never touches bun.lock. Remediation is mechanical, no code change. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/wave602-r1-<n>; work on the PR's OWN branch (find it via gh pr view ${PR} --json headRefName — never guess). PR-first; never push to main. Commits end with 'Agent: wave602-r1-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check PR #${PR} comments — if the lockfile remediation already landed (head moved past 2e379b07), verify and record; do not duplicate.
- REMEDIATE ONLY THE NAMED DEFECT: regenerate bun.lock at the wave head ('bun install' in the worktree with the shared checkout's node_modules symlinked if needed — the wave lane's own method), commit ONLY the bun.lock change ('Agent: wave602-r1-<your-role>'), push --force-with-lease. Do NOT touch package.json files, changesets, or any other content. Verify 'bun install --frozen-lockfile' rc=0 at the new head (record the literal output) and that the lockfile diff is dependency-range rewrites only.
- No secrets: never print/capture/commit credential values; staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on PR #${PR}, posts to #board, task cf390843. English. Lineage 'conversations agents register' named wave602-r1-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const REMEDIATE = CONST + `
ROLE: remediate lane. Per the CONST: regenerate bun.lock at the wave head, commit ONLY bun.lock, verify frozen install rc=0 locally (literal output), secrets scan, push --force-with-lease. Record the lockfile diff summary (insertions/deletions, range-rewrites only).
Return (JSON): { newHead: string, diffSummary: string, frozenInstallOk: bool, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks ${PR}', re-run the failed build+test job (gh run rerun), poll bounded (max 15 min), require ALL FIVE checks (build+test, gates, publish guard, test-suites, verify-generated-artifacts) GREEN at the new head (record the per-check table). Re-verify 'bun install --frozen-lockfile' rc=0 at the new head.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, frozenInstallOk: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) — cycle 1 on the SAME PR, scoped to the named defect and its direct regressions. Review: (a) the remediation is the lockfile regeneration ONLY (no content changes), (b) frozen install green at the new head, (c) all five CI checks green, (d) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — wave602-r1 @ <sha> — lens: cycle-1 lockfile remediation, reviewer wave602-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge PR #${PR} (base-movement gate first; gh pr merge --squash --body-file ending 'Agent: wave602-r1-ship'), record the merged sha, post '[SHIP-READY] hasna/apps#${PR} @ <merged sha> — 36 bumps, publish-all next pass ships' on git-publishing, comment task cf390843, and close the superseded wave PR #595 with a pointer comment to #${PR} (P2 from the cycle-0 review). If NO_GO: comment findings + resume condition, leave open.
Return (JSON): { merged: bool, mergedSha: string|null, shipReadyPosted: bool, pr595Closed: bool, taskState: string, residue: [string] }
`

const REM_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, diffSummary: { type: 'string' }, frozenInstallOk: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, frozenInstallOk: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, shipReadyPosted: { type: 'boolean' }, pr595Closed: { type: 'boolean' }, taskState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Remediate')
const remediate = await agent(REMEDIATE, { label: 'wave602-r1-fix', phase: 'Remediate', schema: REM_SCHEMA })

phase('Verify')
let verify = null
if (remediate && remediate.newHead) {
  verify = await agent(VERIFY, { label: 'wave602-r1-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'remediation did not complete', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW, { label: 'wave602-r1-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'remediate/verify did not complete', detail: JSON.stringify({ remediate, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'wave602-r1-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { remediate, verify, review, ship }
