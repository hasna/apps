export const meta = {
  name: 'testguard-cycle2',
  description: 'Remediation cycle 1 for hasna/apps#630 (test-guard successor, rows 48d4725e + 940070c4): ONE deterministic CI root cause — the smoke (wired as test + prepack) fails on hosts without the fleet install layout (REAL=/home/hasna/.bun/bin/bun-real absent on the GitHub runner), collapsing s16 probe_state and failing 8 of 13 battery assertions; both red gates (build+test, publish guard) are the same smoke. Fix: detect the absent fleet layout and skip the s16 classification assertions with a documented skip (or parameterize REAL), keeping the full 13-check battery on guard-installed hosts. Then 5/5 green, Fable re-review (cycle 1 of 630, scoped), merge, complete both rows',
  phases: [
    { title: 'Remediate', detail: 'smoke.sh fleet-layout skip (s16 documented skip or REAL parameterization); battery 13/0 on this host AND pass-or-skip on a layout-absent host' },
    { title: 'Verify', detail: 'all five CI checks green at the new head' },
    { title: 'Review', detail: 'Fable re-review (cycle 1 of #630, scoped)' },
    { title: 'Ship', detail: 'merge GO, complete 48d4725e + 940070c4' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PR = 630

const CONST = `
You are a lane of the testguard-cycle2 workflow (2026-08-19). PR hasna/apps#${PR} (test-guard successor, branch testguard-s-1-conformance, head 8e5b008c7) got testguard-successor-review NO_GO at 8e5b008c7 — remediation cycle 1 of this candidate. Final text = machine-readable JSON.

The ONE deterministic root cause (verify lane, measured from job logs + source, reproduced at two heads): 'apps/test-guard/test/smoke.sh' fails on the GitHub runner — sentinel.sh:63 checks REAL=/home/hasna/.bun/bin/bun-real (the fleet install layout, sentinel.sh:25), which does NOT exist on the runner, so the sentinel's functional probe never runs, probe_state stays '', and battery section 16's alert-classification assertions fail (8 of 13; '=== battery: 5 PASS, 8 FAIL', exit 8). The smoke is wired as 'test' AND inside prepack, so this ONE change turns BOTH red gates green (build + test 'Test (affected)' and publish guard 'npm pack prepack'). Locally on guard-installed hosts the battery is 13 PASS/0 FAIL. The member conformance content (hasna.contract.json + cli bin + census exceptions) is verified green and needs NO change. NOT the playwright stall class.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/testguard-c2-<n>; work on the PR's OWN branch (testguard-s-1-conformance — gh pr view ${PR} --json headRefName, never guess). PR-first; never push to main. Commits end with 'Agent: testguard-c2-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check PR #${PR} comments — if the smoke remediation already landed (head moved past 8e5b008c7), verify and record; do not duplicate.
- REMEDIATE ONLY THE NAMED DEFECT: smoke.sh must pass-or-skip on hosts without the fleet install layout. The skip is DOCUMENTED (a named skip path with the reason in output), keeps the FULL 13-check battery on guard-installed hosts, and must not weaken the alert-classification assertions where the layout IS present (positive control: run the battery on this guard-installed host — 13 PASS/0 FAIL — AND simulate the absent layout, e.g. REAL=/nonexistent, and record the documented skip, both literal). TDD where testable; the regression is the runner failure mode (absent-REAL host passes-or-skips, rc=0).
- Verify: 'bun install --frozen-lockfile' rc=0, smoke 13/0 on this host, smoke rc=0 under simulated absent layout, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on PR #${PR} and rows 48d4725e + 940070c4, posts to #board. English. Lineage 'conversations agents register' named testguard-c2-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const REMEDIATE = CONST + `
ROLE: remediate lane. Per the CONST: the smoke.sh fleet-layout skip (smallest owned change; documented skip; parameterization acceptable), both probes (guard-installed host 13/0 AND simulated absent layout rc=0 with the documented skip line, literals pasted), suites green, secrets scan, commit ('Agent: testguard-c2-<your-role>'), push --force-with-lease.
Return (JSON): { newHead: string, diffSummary: string, batteryOnHost: string, absentLayoutSkip: string, frozenInstallOk: bool, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks ${PR}', re-run failed jobs (gh run rerun), poll bounded (max 20 min), require ALL FIVE checks GREEN at the new head (record the per-check table; build+test and publish guard are the two under test — both must pass now that the smoke passes on the runner). The known environmental playwright stall, if the ONLY failure, re-run once and record.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) — cycle 1 of #${PR}, scoped to the named defect. Review: (a) the smoke fix is the smallest owned change (documented skip, no weakened assertions where the layout is present), (b) both probes recorded (13/0 on host + documented skip under absent layout), (c) all five CI checks green at the new head (or ONLY the documented environmental stall), (d) conformance content untouched, (e) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — testguard-c2 @ <sha> — lens: smoke fleet-layout skip, reviewer testguard-c2-review'. Block ONLY concrete P0/P1 defects; this is cycle 1 of the successor candidate — a second NO_GO stops the candidate.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge PR #${PR} (base-movement gate first — merge-tree against origin/main; gh pr merge --squash --body-file ending 'Agent: testguard-c2-ship'), record the merged sha, complete rows 48d4725e + 940070c4 with the evidence. If NO_GO: comment findings + resume condition, leave both in_progress — the successor candidate stops.
Return (JSON): { merged: bool, mergedSha: string|null, rows: [{rowId, state}], residue: [string] }
`

const REM_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, diffSummary: { type: 'string' }, batteryOnHost: { type: 'string' }, absentLayoutSkip: { type: 'string' }, frozenInstallOk: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rows: { type: 'array' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Remediate')
const remediate = await agent(REMEDIATE, { label: 'testguard-c2-fix', phase: 'Remediate', schema: REM_SCHEMA })

phase('Verify')
let verify = null
if (remediate && remediate.newHead) {
  verify = await agent(VERIFY, { label: 'testguard-c2-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'remediation did not complete', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW, { label: 'testguard-c2-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'remediate/verify did not complete', detail: JSON.stringify({ remediate, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'testguard-c2-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { remediate, verify, review, ship }
