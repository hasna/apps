export const meta = {
  name: 'csplit-r1',
  description: 'Remediation cycle 1 for the contracts-split PR hasna/apps#672 (release(contracts) 0.11.2, wave #670 precondition): ONE deterministic CI failure — apps/economy pins @hasna/contracts ^0.11.1 so it resolves the workspace kit 0.11.2, and contract-manifest.test.ts:77 kitVersion-tracking fails (Expected 0.11.2, Received 0.11.1). This lane: bump apps/economy/hasna.contract.json kitVersion 0.11.1->0.11.2 in the release PR, CI 5/5, Fable re-review, merge, [PUBLISH INTENT] — publish-all ships contracts 0.11.2 and the wave #670 contracts class clears',
  phases: [
    { title: 'Remediate', detail: 'economy kitVersion 0.11.1->0.11.2 in PR #672' },
    { title: 'Verify', detail: 'CI 5/5 at the new head' },
    { title: 'Review', detail: 'Fable re-review (cycle 1, scoped)' },
    { title: 'Ship', detail: 'base gate, merge, [PUBLISH INTENT]; publish-all ships 0.11.2' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PR = 672

const CONST = `
You are a lane of the csplit-r1 workflow (2026-08-20) — remediation cycle 1 of the contracts-split release PR hasna/apps#${PR} (release(contracts): 0.11.2, wave #670 precondition). Cycle-0 verify NO_GO'd on ONE deterministic failure: apps/economy pins '@hasna/contracts': '^0.11.1' so it resolves the workspace kit 0.11.2, and src/contract-manifest.test.ts:77 (manifest.kitVersion tracks the installed @hasna/contracts version) fails — Expected 0.11.2, Received 0.11.1. apps/servers passes because it pins the exact 0.11.1. Final text = machine-readable JSON.

The named remediation (from csplit-verify's resume condition): bump apps/economy/hasna.contract.json kitVersion 0.11.1 -> 0.11.2 in the release PR (one line), re-push, re-run CI, re-verify all five checks green at the new head. This was NOT the environmental playwright stall — a re-run of the failed job alone cannot clear it.

Coordination: when this merges and publish-all ships @hasna/contracts@0.11.2, wave #670 drops its contracts entry per the coordination note (comment 5349906621) and its contracts workspace-member prepare class (attachments/loops TS7016/TS2307) clears.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work; shared checkout dirty from other lanes — fetch refs and work from a worktree if the pull refuses). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/csplit-r1-<n>; work on the PR's OWN branch (release-contracts — gh pr view ${PR} --json headRefName, never guess). PR-first; never push to main. Commits end with 'Agent: csplit-r1-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check PR #${PR} comments — if the economy kitVersion remediation already landed (head moved past a8f6c772), verify and record; do not duplicate.
- REMEDIATE ONLY THE NAMED DEFECT: the economy kitVersion line. No other version changes, no scope creep.
- Verify: contracts + economy suites green (record counts), 'bun install --frozen-lockfile' rc=0, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on PR #${PR} and wave #670 (coordination), posts to #board. English. Lineage 'conversations agents register' named csplit-r1-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const REMEDIATE = CONST + `
ROLE: remediate lane. Per the CONST: apply the economy kitVersion bump, contracts + economy suites green (record counts), frozen install rc=0, secrets scan, commit ('Agent: csplit-r1-<your-role>'), push --force-with-lease.
Return (JSON): { newHead: string, diffSummary: string, economyAligned: bool, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks ${PR}', re-run failed jobs (gh run rerun), poll bounded (max 20 min), require ALL FIVE checks GREEN at the new head (record the per-check table; build+test is the check under test). The known environmental playwright stall, if the ONLY failure, re-run once and record.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) — cycle 1, scoped. Review: (a) the economy kitVersion 0.11.2 aligns with its workspace-resolved contracts, (b) contracts + economy suites green at the new head, (c) 5/5 CI green, (d) no scope creep (release-only content), (e) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — csplit-r1 @ <sha> — lens: economy kitVersion, reviewer csplit-r1-review'. Block ONLY concrete P0/P1 defects; two cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge PR #${PR} (base-movement gate first — merge-tree against origin/main; gh pr merge --squash --body-file ending 'Agent: csplit-r1-ship'), record the merged sha, post '[PUBLISH INTENT] @hasna/contracts@0.11.2 — contracts-split (wave #670 precondition)' on git-publishing BEFORE any publish (publish-all is the ONLY publisher — this lane does NOT publish). If NO_GO: comment findings + resume condition, leave open.
Return (JSON): { merged: bool, mergedSha: string|null, intentPosted: bool, residue: [string] }
`

const REM_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, diffSummary: { type: 'string' }, economyAligned: { type: 'boolean' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, intentPosted: { type: 'boolean' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Remediate')
const remediate = await agent(REMEDIATE, { label: 'csplit-r1-fix', phase: 'Remediate', schema: REM_SCHEMA })

phase('Verify')
let verify = null
if (remediate && remediate.newHead) {
  verify = await agent(VERIFY, { label: 'csplit-r1-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'remediation did not complete', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW, { label: 'csplit-r1-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'remediate/verify did not complete', detail: JSON.stringify({ remediate, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'csplit-r1-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { remediate, verify, review, ship }
