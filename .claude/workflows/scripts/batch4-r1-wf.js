export const meta = {
  name: 'batch4-r1',
  description: 'Batch-4 cycle-1 follow-ups: (A) PR #619 merge-gate hold — rebase onto moved main 54e76e46, CI green, merge, complete 6fa79ced; (B) PR #615 NO_GO — CI secrets gate fires on added synthetic fixtures, convert to non-matching sentinels (or exact-hunk documentation per the rule), CI gates green, re-review, merge, complete 529e2ee5',
  phases: [
    { title: 'Remediate', detail: 'two lanes: 619 rebase; 615 synthetic-fixture fix' },
    { title: 'Verify', detail: 'CI green at new heads' },
    { title: 'Review', detail: 'Fable re-review (cycle 1)' },
    { title: 'Ship', detail: 'merge GO PRs, complete rows' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'

const CONST = `
You are a lane of the batch4-r1 workflow (2026-08-19, task-drain batch-4 cycle 1). Two follow-ups from drain4's ship lane. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/drain4r1-<n>; work on the PR's OWN branch (gh pr view <n> --json headRefName — never guess). PR-first; never push to main. Commits end with 'Agent: drain4r1-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check each PR's comments — if the remediation already landed, verify and record; do not duplicate.
- No secrets: never print/capture/commit credential values; staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the PRs + rows, posts to #board. English. Lineage 'conversations agents register' named drain4r1-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const LANE_619 = CONST + `
ROLE: lane for PR #619 (row 6fa79ced, CI playwright mirror fallback). Drain4 ship held it at the merge gate: refs/pull/619/merge^1 = d2921e78 != origin/main 54e76e46 (main moved 7 commits; #611 edited the same ci.yml). Content GO at head 95643d28, CI 5/5 green there. OWED: rebase the single commit onto origin/main 54e76e46 (or newer), resolve any ci.yml conflict with #611's changes (both changes kept), re-run CI at the new head (the mirror-fallback step must pass — record the step duration), re-verify the gate (merge-tree == head), secrets scan, commit ('Agent: drain4r1-<your-role>'), push --force-with-lease.
Return (JSON): { newHead: string, diffSummary: string, ciStepOk: bool, gateOk: bool, secretsClean: bool, evidence: string }
`

const LANE_615 = CONST + `
ROLE: lane for PR #615 (row 529e2ee5, hygiene tests-only PR). Drain4 review NO_GO: CI gates (secrets, names, manifests) FAIL — check-secrets.ts fires on the ADDED synthetic fixtures (apps/evals/src/core/redaction.test.ts anthropic-key sentinels and the catalog scanner fixtures) because the hook-sanctioned hasna:allow-secret-file exemption is local-only; CI's scanner does not honor it. Per the fix-on-sight rule: synthetic tokens are changed to NON-MATCHING sentinels (or the false positive is documented with evidence at the exact hunk — the fixture's purpose is testing the redactor, so non-matching sentinels must not break the test's intent: pick sentinel shapes the redactor still exercises but no scanner pattern matches). OWED: fix the fixtures at the exact hunks, re-run CI gates (secrets/names/manifests) green at the new head, the tests still pass (the fixtures still exercise the redactor), secrets scan, commit ('Agent: drain4r1-<your-role>'), push --force-with-lease.
Return (JSON): { newHead: string, diffSummary: string, gatesGreen: bool, testsStillPass: bool, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks' on both PRs ({PRS}), re-run failed jobs, poll bounded (max 20 min each), require the previously-failing checks GREEN at the new heads (record the per-check tables). The playwright mirror step on #619 is the thing under test — its success is the acceptance.
Return (JSON): { prs: [{number, checks: [{name, status, conclusion}], green: bool, acceptanceMet: bool, resumeCondition: string|null}] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) — cycle 1, scoped to the named defects. Review: (a) #619: rebase kept both ci.yml changes, mirror step green, gate verified; (b) #615: fixtures converted to non-matching sentinels that still exercise the redactor, tests pass, gates green; (c) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — drain4r1 <PR> @ <sha> — lens: cycle-1, reviewer drain4r1-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { prs: [{number, verdict, findings: [{severity, title, detail}]}] }
`

const SHIP = CONST + `
ROLE: ship. For each GO PR: merge (base-movement gate first; gh pr merge --squash --body-file ending 'Agent: drain4r1-ship'), complete the row with the evidence. NO_GO: comment + resume condition, leave in_progress.
Return (JSON): { rows: [{rowId, prNumber, verdict, merged, mergedSha, rowState}], residue: [string] }
`

const LANE_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, diffSummary: { type: 'string' }, ciStepOk: { type: 'boolean' }, gateOk: { type: 'boolean' }, gatesGreen: { type: 'boolean' }, testsStillPass: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REVIEW_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const SHIP_SCHEMA = { type: 'object', properties: { rows: { type: 'array', items: { type: 'object' } }, residue: { type: 'array' } }, required: ['rows'] }

phase('Remediate')
const [l619, l615] = await parallel([
  () => agent(LANE_619, { label: 'drain4r1-619', phase: 'Remediate', schema: LANE_SCHEMA }),
  () => agent(LANE_615, { label: 'drain4r1-615', phase: 'Remediate', schema: LANE_SCHEMA }),
])

phase('Verify')
const prs = [l619, l615].filter(Boolean).map(l => ({ number: l.newHead ? (l.diffSummary ? 619 : 615) : 0 })).filter(p => p.number)
let verify = null
if (prs.length) {
  verify = await agent(VERIFY.replace('{PRS}', JSON.stringify(prs.map(p => p.number))), { label: 'drain4r1-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { prs: [] }
}

phase('Review')
let review = null
if (verify && verify.prs && verify.prs.length) {
  review = await agent(REVIEW.replace('{PRS}', JSON.stringify(verify.prs)), { label: 'drain4r1-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { prs: [] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'drain4r1-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { l619, l615, verify, review, ship }
