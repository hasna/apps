export const meta = {
  name: 'testguard-remediate',
  description: 'Remediation cycle 1 for hasna/apps#599 (test-guard package home, task 48d4725e, drain2-review NO_GO): add the missing bun.lock entry for the new apps/test-guard workspace member so bun install --frozen-lockfile passes on all five CI jobs; re-verify CI; Fable re-review (cycle 1); merge; complete 48d4725e',
  phases: [
    { title: 'Remediate', detail: 'regenerate bun.lock with the new member, push to the PR branch' },
    { title: 'Verify', detail: 'frozen-lockfile install green at the new head + battery/smoke still green' },
    { title: 'Review', detail: 'Fable re-review (cycle 1, same reviewer standard)' },
    { title: 'Ship', detail: 'merge GO + complete row 48d4725e by evidence' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PR = 599
const ROW = '48d4725e'

const CONST = `
You are a lane of the testguard-remediate workflow (2026-08-19). PR hasna/apps#${PR} (test-guard package home, task ${ROW}, branch drain2-testguard) got drain2-review NO_GO at c5705337c3fa with ONE P1: 'Missing bun.lock entry for the new workspace member breaks frozen install on all five CI jobs' — 'bun install --frozen-lockfile' fails rc=1 ('lockfile had changes, but lockfile is frozen') on every CI job at the Install step. Everything else in the PR was GO (byte-faithful port sha256-verified, smoke 13P/0F, battery 53P/0F station env, secrets clean, publish-guard packs clean). Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/testguard-r1-<n>; work on the PR's OWN branch (find it via gh pr view ${PR} --json headRefName — never guess). PR-first; never push to main. Commits end with 'Agent: testguard-r1-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check PR #${PR} comments — if the lockfile remediation already landed (head moved past c5705337c3fa), verify and record; do not duplicate.
- REMEDIATE ONLY THE NAMED DEFECT: the bun.lock entry. Do not touch the ported scripts, package.json contents, or any behavior. Regenerate bun.lock with the workspace member registered ('bun install' in the repo root with the member present, then diff the lockfile for the apps/test-guard entry ONLY — if bun also rewrites unrelated entries, restore them and keep only the additive member entries; never hand-edit lockfile hashes).
- Verify: 'bun install --frozen-lockfile' rc=0 at the new head (record the literal output), 'bash test/smoke.sh' in apps/test-guard still 13 PASS/0 FAIL, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on PR #${PR} and row ${ROW}, posts to #board. English. Lineage 'conversations agents register' named testguard-r1-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const REMEDIATE = CONST + `
ROLE: remediate lane. Per the CONST: apply the one-defect lockfile fix on the PR branch, verify 'bun install --frozen-lockfile' rc=0 locally (record literal), smoke still green, secrets scan, commit ('Agent: testguard-r1-<your-role>'), push --force-with-lease.
Return (JSON): { newHead: string, diffSummary: string, frozenInstallOk: bool, smokeOk: bool, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks ${PR}', re-run the failed build+test job (gh run rerun), poll bounded (max 15 min), require 'build + test (affected)' GREEN at the new head (record the per-check table). Re-verify 'bun install --frozen-lockfile' at the new head rc=0.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, frozenInstallOk: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) — cycle 1 on the SAME PR. Review: (a) the remediation is the named lockfile defect ONLY (no behavior changes to the ported scripts), (b) frozen install is green at the new head, (c) CI build+test green, (d) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — testguard-r1 @ <sha> — lens: cycle-1 lockfile remediation, reviewer testguard-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge PR #${PR} (base-movement gate first; gh pr merge --squash --body-file ending 'Agent: testguard-r1-ship'), record the merged sha, complete row ${ROW} with the fix + merged sha. If NO_GO: comment findings + resume condition, leave open.
Return (JSON): { merged: bool, mergedSha: string|null, rowState: string, residue: [string] }
`

const REM_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, diffSummary: { type: 'string' }, frozenInstallOk: { type: 'boolean' }, smokeOk: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, frozenInstallOk: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Remediate')
const remediate = await agent(REMEDIATE, { label: 'testguard-r1-fix', phase: 'Remediate', schema: REM_SCHEMA })

phase('Verify')
let verify = null
if (remediate && remediate.newHead) {
  verify = await agent(VERIFY, { label: 'testguard-r1-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'remediation did not complete', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW, { label: 'testguard-r1-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'remediate/verify did not complete', detail: JSON.stringify({ remediate, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'testguard-r1-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { remediate, verify, review, ship }
