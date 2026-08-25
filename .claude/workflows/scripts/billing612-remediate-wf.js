export const meta = {
  name: 'billing612-remediate',
  description: 'Remediation cycle 1 for hasna/apps#612 (billing Sol-guided coverage, tests-coverage-sol NO_GO): the new test/cli.test.ts asserts the openapi-check stale-document path by mutating process.exitCode = 1 and restoring it in afterEach — bun test still exits 1 (measured: 8 pass / 0 fail, rc=1, reproduced with a 2-test minimal case), breaking both CI gates (build+test + publish guard via prepack). Fix the exitCode pattern (assert the stale-document path without mutating the runner exit code), 5/5 CI, Fable re-review (cycle 1), merge',
  phases: [
    { title: 'Remediate', detail: 'exitCode pattern fix in apps/billing/test/cli.test.ts; suite rc=0' },
    { title: 'Verify', detail: '5/5 CI green at the new head' },
    { title: 'Review', detail: 'Fable re-review (cycle 1, scoped)' },
    { title: 'Ship', detail: 'merge GO' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PR = 612

const CONST = `
You are a lane of the billing612-remediate workflow (2026-08-19). PR hasna/apps#${PR} (billing Sol-guided coverage suite) got coverage-review NO_GO at head 1c61c64d with ONE P1: the new apps/billing/test/cli.test.ts asserts the openapi-check stale-document path by mutating process.exitCode = 1 and restoring it in afterEach; bun test's runner STILL exits 1 — measured locally (full billing suite '164 pass / 1 skip / 0 fail' then 'error: script test exited with code 1'), bisected to test/cli.test.ts alone (8 pass / 0 fail, rc=1), reproduced with a 2-test minimal case (set exitCode=1 + afterEach restore still yields rc=1). In CI both gates fail: 'build + test (affected)' (@hasna/billing#test exited 1) and publish guard (prepack runs the same test). Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/billing612-<n>; work on the PR's OWN branch (gh pr view ${PR} --json headRefName — never guess; the lane worktree coverage-billing may still exist — do not reuse it if it is locked). PR-first; never push to main. Commits end with 'Agent: billing612-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check PR #${PR} comments — if the exitCode remediation already landed (head moved past 1c61c64d), verify and record; do not duplicate.
- THE FIX: the stale-document assertion must survive WITHOUT mutating the runner's exit code. Smallest owned change: e.g., assert via the CLI binary in a spawned child (bun run bin) whose exit code is the assertion subject, or restructure to avoid process.exitCode (a documented, measured choice — reproduce the rc=1 BEFORE and rc=0 AFTER, literals). The stale-document behavior itself must remain asserted.
- Verify: billing suite rc=0 at the new head ('bun test' full run — literal), 'bun run prepack' exit 0, 'bun install --frozen-lockfile' rc=0, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on PR #${PR}, posts to #board. English. Lineage 'conversations agents register' named billing612-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const REMEDIATE = CONST + `
ROLE: remediate lane. Per the CONST: reproduce the rc=1 (literal), apply the smallest owned fix, prove suite rc=0 + prepack exit 0 at the new head (literals), secrets scan, commit ('Agent: billing612-<your-role>'), push --force-with-lease.
Return (JSON): { newHead: string, diffSummary: string, beforeRc: string, afterRc: string, prepackOk: bool, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks ${PR}', re-run failed jobs (gh run rerun), poll bounded (max 20 min), require ALL FIVE checks GREEN at the new head (record the per-check table; build+test and publish guard are the two under test). The known environmental playwright stall, if the ONLY failure, re-run once and record.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) — cycle 1, scoped. Review: (a) the exitCode pattern is gone (the stale-document path still asserted — measured), (b) suite rc=0 + prepack exit 0 at the new head, (c) 5/5 CI green (or ONLY the documented environmental stall), (d) secrets clean, PR-first, no scope creep. Post '[REVIEW] <GO|NO_GO> — billing612 @ <sha> — lens: exitCode pattern, reviewer billing612-review'. Block ONLY concrete P0/P1 defects; two cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge PR #${PR} (base-movement gate first — merge-tree against origin/main; gh pr merge --squash --body-file ending 'Agent: billing612-ship'), record the merged sha. If NO_GO: comment findings + resume condition, leave open.
Return (JSON): { merged: bool, mergedSha: string|null, residue: [string] }
`

const REM_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, diffSummary: { type: 'string' }, beforeRc: { type: 'string' }, afterRc: { type: 'string' }, prepackOk: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, residue: { type: 'array' } }, required: ['merged'] }

phase('Remediate')
const remediate = await agent(REMEDIATE, { label: 'billing612-fix', phase: 'Remediate', schema: REM_SCHEMA })

phase('Verify')
let verify = null
if (remediate && remediate.newHead) {
  verify = await agent(VERIFY, { label: 'billing612-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'remediation did not complete', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW, { label: 'billing612-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'remediate/verify did not complete', detail: JSON.stringify({ remediate, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'billing612-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { remediate, verify, review, ship }
