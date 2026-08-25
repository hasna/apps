export const meta = {
  name: 'wave602-cycle2',
  description: 'Remediation cycle 2 (FINAL) for hasna/apps#602 (ship-latest wave): cycle 1 fixed the lockfile; NEW wave-caused P1 — apps/contracts (auth/, client/, client/storage) and apps/machines (consumer/) do not emit the declaration files their exports maps declare, so the workspace-linked @hasna/loops prepare fails (TS7016/TS2307, frozen install rc=2, all five CI checks red at Install). Fix the declaration emission; re-verify; Fable re-review (cycle 2 FINAL); merge; [SHIP-READY]; close #595',
  phases: [
    { title: 'Remediate', detail: 'contracts + machines build configs emit declared subpath .d.ts; frozen install rc=0' },
    { title: 'Verify', detail: 'all five CI checks green at the new head + loops prepare passes' },
    { title: 'Review', detail: 'Fable re-review (cycle 2, FINAL)' },
    { title: 'Ship', detail: 'merge GO, [SHIP-READY] on git-publishing, close superseded #595' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PR = 602

const CONST = `
You are a lane of the wave602-cycle2 workflow (2026-08-19). PR hasna/apps#${PR} (the 36-app version wave, branch release/version-wave, head 82ac188d) — cycle 1 resolved the frozen-lockfile P1 (bun.lock regenerated). The REMAINING wave-caused P1 (wave602-r1-verify, run 32273070541, reproduced locally byte-identical): 'error: prepare script from "@hasna/loops" exited with 2' at install — loops prepare tsc --emitDeclarationOnly fails with TS7016 @hasna/contracts/auth, @hasna/contracts/client, @hasna/contracts/client/storage; TS2307 @hasna/machines/consumer; TS18046 x5 in src/lib/store/index.ts. Root cause (measured): the wave aligned loops' deps to workspace-member versions (contracts 0.11.1->0.11.2, machines 0.2.27->0.2.28), switching resolution from registry tarballs to workspace links whose dist LACKS the declaration files their exports maps declare (contracts exports './auth' -> types ./dist/auth/index.d.ts etc.). Remediation cycle 2 (FINAL): apps/contracts and apps/machines builds must emit the declaration files their exports maps declare (smallest owned change to their build/tsconfig — declaration emission for the declared subpaths), so 'bun install --frozen-lockfile' returns rc=0 at the wave head and all five CI checks pass. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/wave602-c2-<n>; work on the PR's OWN branch (release/version-wave — never guess). PR-first; never push to main. Commits end with 'Agent: wave602-c2-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check PR #${PR} comments — if the declaration remediation already landed (head moved past 82ac188d), verify and record; do not duplicate.
- REMEDIATE ONLY THE NAMED DEFECT: declaration emission in apps/contracts and apps/machines for the declared export-map subpaths. The regression IS the failing install gate: 'bun install --frozen-lockfile' rc=2 at head (record the literal), rc=0 after the fix (record the literal). No version bumps, no behavior changes, no unrelated edits.
- Verify: 'bun install --frozen-lockfile' rc=0 at the new head, 'bun test' the affected packages' suites green (record counts), the packages' own builds emit the declared subpath files (list them), secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on PR #${PR}, posts to #board, task cf390843. English. Lineage 'conversations agents register' named wave602-c2-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const REMEDIATE = CONST + `
ROLE: remediate lane. Per the CONST: apply the declaration-emission fix on the wave branch (in apps/contracts and/or apps/machines build configs), verify 'bun install --frozen-lockfile' rc=0 locally (literal), the declared subpath .d.ts files exist after the packages' builds, affected suites green, secrets scan, commit ('Agent: wave602-c2-<your-role>'), push --force-with-lease.
Return (JSON): { newHead: string, diffSummary: string, frozenInstallOk: bool, declaredFiles: [string], suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks ${PR}', re-run the failed jobs (gh run rerun), poll bounded (max 20 min), require ALL FIVE checks GREEN at the new head (record the per-check table). The known environmental 'Install playwright chromium' stall (apt azure.archive.ubuntu.com unreachable, task 552e18cc) is repo-wide and unrelated — if it is the ONLY failing step, re-run once and record it as environmental. Re-verify 'bun install --frozen-lockfile' rc=0 at the new head and that loops prepare passes.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, frozenInstallOk: bool, loopsPrepareOk: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) — cycle 2 (FINAL) on the SAME PR, scoped to the declaration defect and its direct regressions. Review: (a) the remediation is the declaration emission ONLY (no version/behavior changes), (b) 'bun install --frozen-lockfile' rc=0 at the new head with loops prepare passing, (c) all five CI checks green (or the ONLY failure is the documented environmental playwright stall), (d) declared subpath files exist, (e) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — wave602-c2 @ <sha> — lens: cycle-2 declaration remediation, reviewer wave602-c2-review'. Block ONLY concrete P0/P1 defects. This is the final cycle — a third NO_GO terminates the candidate per the bounded-review policy.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge PR #${PR} (base-movement gate first; gh pr merge --squash --body-file ending 'Agent: wave602-c2-ship'), record the merged sha, post '[SHIP-READY] hasna/apps#${PR} @ <merged sha> — 36 bumps, publish-all next pass ships' on git-publishing, comment task cf390843, and close the superseded wave PR #595 with a pointer comment to #${PR}. If NO_GO: comment findings + resume condition, leave open (candidate terminates at a third NO_GO).
Return (JSON): { merged: bool, mergedSha: string|null, shipReadyPosted: bool, pr595Closed: bool, taskState: string, residue: [string] }
`

const REM_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, diffSummary: { type: 'string' }, frozenInstallOk: { type: 'boolean' }, declaredFiles: { type: 'array' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, frozenInstallOk: { type: 'boolean' }, loopsPrepareOk: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, shipReadyPosted: { type: 'boolean' }, pr595Closed: { type: 'boolean' }, taskState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Remediate')
const remediate = await agent(REMEDIATE, { label: 'wave602-c2-fix', phase: 'Remediate', schema: REM_SCHEMA })

phase('Verify')
let verify = null
if (remediate && remediate.newHead) {
  verify = await agent(VERIFY, { label: 'wave602-c2-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'remediation did not complete', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW, { label: 'wave602-c2-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'remediate/verify did not complete', detail: JSON.stringify({ remediate, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'wave602-c2-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { remediate, verify, review, ship }
