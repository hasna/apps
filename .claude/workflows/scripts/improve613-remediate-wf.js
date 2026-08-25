export const meta = {
  name: 'improve613-remediate',
  description: 'Remediation cycle 1 for hasna/apps#613 (member bootstrap scaffold, improve-monorepo NO_GO): P1 — the template Dockerfile build fails because tsc is absent from the template devDependencies. Add tsc to the template, verify the scaffold builds, Fable re-review, merge, complete row 98cbde34',
  phases: [
    { title: 'Remediate', detail: 'template devDependencies + tsc, scaffold build verified' },
    { title: 'Verify', detail: 'CI green at the new head (playwright stall environmental)' },
    { title: 'Review', detail: 'Fable re-review (cycle 1, scoped)' },
    { title: 'Ship', detail: 'merge GO, complete row' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PR = 613
const ROW = '98cbde34-4d15-4e42-833b-31814d109289'

const CONST = `
You are a lane of the improve613-remediate workflow (2026-08-19). PR hasna/apps#${PR} (member bootstrap scaffold, row ${ROW}) got improve-review NO_GO @ d5fbba99 with ONE P1: the template Dockerfile build fails — tsc is absent from the template's devDependencies. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/imp613-<n>; work on the PR's OWN branch (gh pr view ${PR} --json headRefName — never guess). PR-first; never push to main. Commits end with 'Agent: imp613-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check PR #${PR} comments — if the remediation already landed (head moved past d5fbba99), verify and record; do not duplicate.
- REMEDIATE ONLY THE NAMED DEFECT: add typescript (tsc) to the template's devDependencies (the scaffold's generated member must build out of the box, incl. its Dockerfile build). Verify: generate a member from the scaffold in a scratch dir and run its build (tsc present, build rc=0 — record the literal), secrets scan (redirect + 'secrets scan input', rc 0 clean), commit ('Agent: imp613-<your-role>'), push --force-with-lease.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on PR #${PR} and row ${ROW}, posts to #board. English. Lineage 'conversations agents register' named imp613-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const REMEDIATE = CONST + `
ROLE: remediate lane. Per the CONST: apply the one-defect fix, scaffold-build verified (literal output), secrets scan, commit ('Agent: imp613-<your-role>'), push --force-with-lease.
Return (JSON): { newHead: string, diffSummary: string, scaffoldBuildOk: bool, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks ${PR}', re-run failed jobs (gh run rerun), poll bounded (max 15 min), require the previously-failing check GREEN at the new head (record the per-check table). The playwright-chromium apt-mirror stall is environmental (task 552e18cc) — if the ONLY failure, re-run once and record.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) — cycle 1, scoped to the named defect. Review: (a) the remediation is the template devDependencies ONLY, (b) scaffold build green at the new head, (c) CI green (or the ONLY failure is the documented environmental stall), (d) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — improve613-r1 @ <sha> — lens: cycle-1 scaffold build, reviewer imp613-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge PR #${PR} (base-movement gate first; gh pr merge --squash --body-file ending 'Agent: imp613-ship'), record the merged sha, complete row ${ROW} with evidence. If NO_GO: comment findings + resume condition, leave in_progress.
Return (JSON): { merged: bool, mergedSha: string|null, rowState: string, residue: [string] }
`

const REM_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, diffSummary: { type: 'string' }, scaffoldBuildOk: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Remediate')
const remediate = await agent(REMEDIATE, { label: 'imp613-fix', phase: 'Remediate', schema: REM_SCHEMA })

phase('Verify')
let verify = null
if (remediate && remediate.newHead) {
  verify = await agent(VERIFY, { label: 'imp613-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'remediation did not complete', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW, { label: 'imp613-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'remediate/verify did not complete', detail: JSON.stringify({ remediate, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'imp613-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { remediate, verify, review, ship }
