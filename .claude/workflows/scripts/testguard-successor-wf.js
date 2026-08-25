export const meta = {
  name: 'testguard-successor',
  description: 'Single sanctioned successor attempt (bounded-review policy) after PR #599 terminated at its two-cycle cap: new PR with the test-guard package home + MEMBER CONFORMANCE — apps/test-guard/hasna.contract.json + declared cli bin (or the eligible waiver for mcp/serve/sdk surfaces a bash guard cannot serve, per the suite exception mechanism). Its own review cycles (max 2); merge; complete 48d4725e + 940070c4',
  phases: [
    { title: 'Build', detail: 'new PR from main: package home + member conformance (manifest + bin/waiver) + changeset' },
    { title: 'Verify', detail: 'standard-adherence suite green at head + frozen install + CI test-suites green' },
    { title: 'Review', detail: 'Fable adversarial review (successor lineage, max 2 cycles)' },
    { title: 'Ship', detail: 'merge GO, complete rows 48d4725e + 940070c4 by evidence' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '48d4725e'
const SUCC = '940070c4-4fdf-4796-8a70-6f63d135f714'

const CONST = `
You are a lane of the testguard-successor workflow (2026-08-19) — the SINGLE sanctioned successor attempt after PR hasna/apps#599 (test-guard package home, task ${ROW}) terminated at its two-cycle cap (bounded-review policy). The terminated PR carried: apps/test-guard (@hasna/test-guard 0.0.1, byte-faithful ports of the SC-00062 bun-test concurrency guard: sentinel.sh/bun-wrapper.sh/battery.sh, sha256-verified), its smoke wiring (13 PASS/0 FAIL), the bun.lock member entries (merged state at 71b959eb), and the changeset. The THIRD NO_GO blocker was MEMBER CONFORMANCE: the standard-adherence suite rejects the new member — 'members without hasna.contract.json and without a recorded exception: test-guard' (tooling/ci/tests/standard/contracts.test.ts:121) and 'test-guard: missing cli bin' (tooling/ci/tests/standard/surfaces.test.ts:59, four-surface standard: cli/mcp/serve bins + ./sdk export). Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/testguard-s-<n> from origin/main. PR-first; never push to main. Commits end with 'Agent: testguard-s-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check ${ROW}/${SUCC} comments + open PRs for an existing conformance attempt; if one exists, verify and record — do not duplicate.
- THIS IS A NEW CANDIDATE (successor): a fresh branch + fresh PR from current main. Reuse the terminated PR's verified content (the ports, smoke, lockfile entries, changeset — they all passed review); do NOT re-litigate or re-review the ported scripts. The NEW content is the member conformance only.
- CONFORMANCE (the actual work): (1) apps/test-guard/hasna.contract.json per the suite's schema — or record the exception exactly as tooling/ci/tests/standard/contracts.test.ts:121 expects (an explicit exception entry, never a silent gap); (2) the cli bin per the four-surface standard — sentinel.sh (or a wrapper) declared as the package's bin, and for the mcp/serve/sdk surfaces a bash guard cannot serve, use the eligible waiver the suite provides (read tooling/ci/tests/standard/surfaces.test.ts for the exact waiver mechanism); (3) re-run 'bun run check' at the new head — the standard-adherence suite must pass with test-guard no longer in the unrecorded lists (record the literal).
- Verify: standard-adherence suite green (the exact two tests that failed on #599), 'bun install --frozen-lockfile' rc=0, smoke 13 PASS/0 FAIL, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on ${ROW} and ${SUCC}, posts to #board. English. Lineage 'conversations agents register' named testguard-s-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const BUILD = CONST + `
ROLE: build lane. Per the CONST: from current origin/main, recreate the package home content (ports, smoke, lockfile member entries, changeset — verified content from the terminated PR) + the member conformance (hasna.contract.json or exception, cli bin or waiver per the suite mechanism). Run the standard-adherence suite (the two tests) green, frozen install rc=0, smoke green, secrets scan, commit ('Agent: testguard-s-<your-role>'), push, open the PR referencing ${ROW} + ${SUCC}.
Return (JSON): { prNumber: number, diffSummary: string, standardAdherenceGreen: bool, frozenInstallOk: bool, smokeOk: bool, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks <PR>', re-run failed jobs (gh run rerun), poll bounded (max 20 min), require 'test-suites (versioning + standard-adherence)' GREEN at the new head (record the per-check table). The 'build + test (affected)' playwright-chromium apt-mirror stall is environmental (task 552e18cc / row 6fa79ced) — if it is the ONLY failure, re-run once and record as environmental. Re-verify standard-adherence locally + frozen install + smoke at the new head.
Return (JSON): { checks: [{name, status, conclusion}], testSuitesGreen: bool, frozenInstallOk: bool, smokeOk: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) — successor lineage, cycle 1. Review the PR ({PR}): (a) the conformance matches the suite's own mechanisms (contracts exception vs silent gap; surfaces waiver vs missing bin), (b) the two previously-failing standard tests are green at head, (c) test-suites CI green, (d) secrets clean, (e) PR-first, (f) no re-litigation of the verified ported content. Post '[REVIEW] <GO|NO_GO> — testguard-s @ <sha> — lens: successor conformance, reviewer testguard-s-review'. Block ONLY concrete P0/P1 defects; at most two remediation cycles for THIS candidate.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge the PR (base-movement gate first; gh pr merge --squash --body-file ending 'Agent: testguard-s-ship'), record the merged sha, complete ${ROW} + ${SUCC} with the evidence. If NO_GO: comment findings + resume condition, leave both in_progress — if this successor exhausts its own two cycles, the lineage stops as an engineering blocker (record that explicitly).
Return (JSON): { merged: bool, mergedSha: string|null, rowsComplete: [string], residue: [string] }
`

const BUILD_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, diffSummary: { type: 'string' }, standardAdherenceGreen: { type: 'boolean' }, frozenInstallOk: { type: 'boolean' }, smokeOk: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['prNumber', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, testSuitesGreen: { type: 'boolean' }, frozenInstallOk: { type: 'boolean' }, smokeOk: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowsComplete: { type: 'array' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Build')
const build = await agent(BUILD, { label: 'testguard-s-build', phase: 'Build', schema: BUILD_SCHEMA })

phase('Verify')
let verify = null
if (build && build.prNumber) {
  verify = await agent(VERIFY.replace('{PR}', String(build.prNumber)), { label: 'testguard-s-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'build lane did not open a PR', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW.replace('{PR}', String(build.prNumber)), { label: 'testguard-s-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'build/verify did not complete', detail: JSON.stringify({ build, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'testguard-s-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { build, verify, review, ship }
