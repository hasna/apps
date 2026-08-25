export const meta = {
  name: 'audit642-r1',
  description: 'Remediation cycle 1 for hasna/apps#642 (packed-surface audit gate, row be6817f3): ONE deterministic CI failure — apps/computers/tests/release-contract.test.ts:39 pins the old verify:release string ("... && bun audit && bun pm untrusted") while package.json:84 now runs the packed-surface audit. Update the expected string (keep the postgres-once + PostgreSQL-16.13 assertions), 5/5 CI, Fable re-review (cycle 1, scoped), merge, complete be6817f3 — the loops publish hold (714000) lifts when this lands',
  phases: [
    { title: 'Remediate', detail: 'release-contract.test.ts:39 expected string update' },
    { title: 'Verify', detail: '5/5 CI green at the new head' },
    { title: 'Review', detail: 'Fable re-review (cycle 1, scoped)' },
    { title: 'Ship', detail: 'merge GO, complete row; loops publish unblocks' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PR = 642
const ROW = 'be6817f3-a28a-4aa6-8f10-a996d8bbb6f5'

const CONST = `
You are a lane of the audit642-r1 workflow (2026-08-19). PR hasna/apps#${PR} (packed-surface audit gate, row ${ROW}) got auditfix-review NO_GO at head 2b7c81567 with ONE deterministic P1: CI build+test(affected) fails on both attempts (run 32290024550) — apps/computers/tests/release-contract.test.ts:39 pins the OLD verify:release string '... && bun audit && bun pm untrusted' while apps/computers/package.json:84 now runs '... && bun run ../../tooling/ci/check-audit-packed.mjs && bun pm untrusted'. Log literal: 'Expected: ... bun audit && bun pm untrusted / Received: ... bun run ../../tooling/ci/check-audit-packed.mjs && bun pm untrusted', 1 tests failed, at release-contract.test.ts:39:21. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/audit642-<n>; work on the PR's OWN branch (auditfix/be6817f3-packed-surface-audit — gh pr view ${PR} --json headRefName, never guess). PR-first; never push to main. Commits end with 'Agent: audit642-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check PR #${PR} comments — if the remediation already landed (head moved past 2b7c81567), verify and record; do not duplicate.
- THE FIX: update the expected string at release-contract.test.ts:39 to the new verify:release ('bun run check && bun run test:postgres-migrations && bun run verify:pack && bun run ../../tooling/ci/check-audit-packed.mjs && bun pm untrusted') — KEEP the postgres-once and PostgreSQL-16.13 assertions intact. REMEDIATE ONLY THIS NAMED DEFECT; the packed-surface audit content itself is reviewed-green and needs no change.
- Verify: the computers suite green (record counts), 'bun run check:supply-chain:audit' from apps/loops passes (literal — the two-sided probe from the original fix), frozen install rc=0, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on PR #${PR} and row ${ROW}, posts to #board. English. Lineage 'conversations agents register' named audit642-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const REMEDIATE = CONST + `
ROLE: remediate lane. Per the CONST: the release-contract.test.ts:39 expected string update, computers suite green (record counts), loops audit gate passes (literal), secrets scan, commit ('Agent: audit642-<your-role>'), push --force-with-lease.
Return (JSON): { newHead: string, diffSummary: string, suiteCounts: {passed, failed}, auditGateOk: string, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks ${PR}', re-run failed jobs (gh run rerun), poll bounded (max 20 min), require ALL FIVE checks GREEN at the new head (record the per-check table; build+test is the one under test). The known environmental playwright stall, if the ONLY failure, re-run once and record.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) — cycle 1, scoped to the named defect. Review: (a) the expected string matches the new verify:release (the postgres assertions intact), (b) suite green at the new head, (c) 5/5 CI green (or ONLY the documented environmental stall), (d) the packed-surface audit content unchanged, (e) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — audit642 @ <sha> — lens: release-contract expectation, reviewer audit642-review'. Block ONLY concrete P0/P1 defects; two cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge PR #${PR} (base-movement gate first — merge-tree against origin/main; gh pr merge --squash --body-file ending 'Agent: audit642-ship'), record the merged sha, complete row ${ROW} with the evidence and the unblock note (the loops 0.5.2 publish hold 714000 lifts — the deploy lane can re-run its release review + publish). If NO_GO: comment findings + resume condition, leave in_progress.
Return (JSON): { merged: bool, mergedSha: string|null, rowState: string, residue: [string] }
`

const REM_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, diffSummary: { type: 'string' }, suiteCounts: { type: 'object' }, auditGateOk: { type: 'string' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Remediate')
const remediate = await agent(REMEDIATE, { label: 'audit642-fix', phase: 'Remediate', schema: REM_SCHEMA })

phase('Verify')
let verify = null
if (remediate && remediate.newHead) {
  verify = await agent(VERIFY, { label: 'audit642-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'remediation did not complete', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW, { label: 'audit642-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'remediate/verify did not complete', detail: JSON.stringify({ remediate, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'audit642-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { remediate, verify, review, ship }
