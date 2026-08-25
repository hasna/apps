export const meta = {
  name: 'hygiene-s2',
  description: 'Remediation cycle 2 (FINAL) of the hygiene-successor candidate (PR hasna/apps#644, row 529e2ee5): cycle-1 acceptanceMet=false on ONE check — CI build+test(affected) fails (browser ref-cache-l2.test.ts real-SDK L2 round-trip env divergence: 3 assertions fail in CI, pass 4/4 locally at the same head; plus apps/computer suite 2 fails + 2 errors on rerun; the other 4 checks PASS incl. publish guard). This cycle lands the named resume conditions: hermeticize/align ref-cache-l2 to the CI environment and fix the computer suite failures, tests-only, CI 5/5, Fable re-review (cycle 2 FINAL of the successor), merge, complete 529e2ee5. A NO_GO here stops the lineage',
  phases: [
    { title: 'Remediate', detail: 'ref-cache-l2 env alignment + computer suite fix (tests-only)' },
    { title: 'Verify', detail: 'CI 5/5 at the new head' },
    { title: 'Review', detail: 'Fable re-review (cycle 2 FINAL)' },
    { title: 'Ship', detail: 'merge GO, complete 529e2ee5; NO_GO stops the lineage' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PR = 644
const ROW = '529e2ee5-5d14-47e8-a994-14702fedb528'

const CONST = `
You are a lane of the hygiene-s2 workflow (2026-08-20) — remediation cycle 2 (FINAL) of the hygiene-successor candidate (PR hasna/apps#${PR}, branch hygiene-successor, row ${ROW}). Cycle 1 (hygiene-successor): build landed the tests-only corpus (183 test files + browser scripts/test.sh, d0359b4e6; 727 pass / 0 fail local, billing prepack rc=0, publish guard PASSES — the terminated candidate's two failing checks reduced to one) but verify returned acceptanceMet=false: CI build+test(affected) FAILS at head d0359b4e6 — (a) apps/browser/src/lib/ref-cache-l2.test.ts: 3 assertions fail in CI (L2 @hasna/mementos 0.14.37 real-SDK round-trip returns null/undefined) while passing 4/4 locally at the identical head (environmental divergence); (b) apps/computer suite 2 fails + 2 errors on the rerun attempt (exact test names not in the served log — fetch the job log tail or rerun to identify). The other four checks (gates, test-suites, publish guard, verify-generated) PASS. THIS IS THE SUCCESSOR CANDIDATE'S FINAL REMEDIATION CYCLE — a NO_GO here stops the lineage as an engineering blocker. Final text = machine-readable JSON.

The named resume conditions (from hygiene-successor-verify, on the PR):
(1) ref-cache-l2: hermeticize or align the test to the CI environment (the source ref-cache.ts L2 behavior exists on origin/main; the divergence is environmental — measure what differs: real mementos SDK availability/version, network, service reachability) — the test must pass identically in CI and locally.
(2) apps/computer suite: identify the 2 fails + 2 errors from the job log tail or a rerun, fix the tests (tests-only), same standard.
(3) Re-run CI and require ALL FIVE checks green at the new head (the failure set varied per attempt — verify the full five-check table, not a single suite).

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work; shared checkout dirty from other lanes — fetch refs and work from a worktree if the pull refuses). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/hygiene-s2-<n>; work on the PR's OWN branch (hygiene-successor — gh pr view ${PR} --json headRefName, never guess). PR-first; never push to main. Commits end with 'Agent: hygiene-s2-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check PR #${PR} comments — if a remediation already landed (head moved past d0359b4e6), verify and record; do not duplicate.
- TESTS-ONLY: the candidate stays tests-only (all changes *.test.ts or test scripts) — no app source modification. REMEDIATE ONLY THE NAMED CONDITIONS; the crawl fixes and retained cycle-2 fixes stay intact.
- Verify: affected suites green (record counts: browser ref-cache-l2, computer, evals redaction, access secret-boundary, crawl webhooks+crawler), billing prepack exit 0, 'bun install --frozen-lockfile' rc=0, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on PR #${PR} and row ${ROW}, posts to #board. English. Lineage 'conversations agents register' named hygiene-s2-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const REMEDIATE = CONST + `
ROLE: remediate lane. Per the CONST: reproduce the CI failures (job log tail or local probes at the PR head), apply the two named fixes (ref-cache-l2 env alignment; computer suite), prove both suites green locally at the new head (record counts), billing prepack exit 0, frozen install rc=0, secrets scan, commit ('Agent: hygiene-s2-<your-role>'), push --force-with-lease.
Return (JSON): { newHead: string, diffSummary: string, refCacheFix: string, computerFix: string, suiteCounts: {passed, failed}, prepackOk: bool, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks ${PR}', re-run failed jobs (gh run rerun), poll bounded (max 25 min), require ALL FIVE checks GREEN at the new head (record the per-check table; build+test is the check under test — verify the full table, the failure set varied per attempt). The known environmental playwright stall, if the ONLY failure, re-run once and record.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) — cycle 2 (FINAL) of the successor candidate, scoped to the named resume conditions. Review: (a) the candidate is still tests-only, (b) ref-cache-l2 passes in CI and locally (measured; the divergence named and closed), (c) computer suite green, (d) the crawl fixes + retained cycle-2 fixes intact, (e) 5/5 CI green at the new head, (f) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — hygiene-s2 @ <sha> — lens: successor cycle 2 FINAL, reviewer hygiene-s2-review'. Block ONLY concrete P0/P1 defects. A NO_GO stops the lineage.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge PR #${PR} (base-movement gate first — merge-tree against origin/main; gh pr merge --squash --body-file ending 'Agent: hygiene-s2-ship'), record the merged sha, complete row ${ROW} with the evidence. If NO_GO: comment findings + resume condition, leave in_progress — the lineage stops as an engineering blocker; record that.
Return (JSON): { merged: bool, mergedSha: string|null, rowState: string, residue: [string] }
`

const REM_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, diffSummary: { type: 'string' }, refCacheFix: { type: 'string' }, computerFix: { type: 'string' }, suiteCounts: { type: 'object' }, prepackOk: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Remediate')
const remediate = await agent(REMEDIATE, { label: 'hygiene-s2-fix', phase: 'Remediate', schema: REM_SCHEMA })

phase('Verify')
let verify = null
if (remediate && remediate.newHead) {
  verify = await agent(VERIFY, { label: 'hygiene-s2-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'remediation did not complete', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW, { label: 'hygiene-s2-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'remediate/verify did not complete', detail: JSON.stringify({ remediate, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'hygiene-s2-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { remediate, verify, review, ship }
