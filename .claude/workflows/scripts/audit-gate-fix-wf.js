export const meta = {
  name: 'audit-gate-fix',
  description: 'Task-drain dispatch (2026-08-19, row be6817f3): BUG — monorepo release gate: prepublishOnly "bun audit" fails on workspace-lockfile advisories, blocking every @hasna/* publish. Investigate the exact advisory surface, smallest owned fix (scope the audit to the member, --production, or documented allowlist — never weaken the gate silently), TDD where testable, Fable review, PR-first, merge, complete row',
  phases: [
    { title: 'Investigate', detail: 'reproduce the prepublishOnly failure; name the advisory surface (workspace lockfile vs member manifest); decide the smallest fix' },
    { title: 'Fix', detail: 'implement, TDD where testable, suite green, secrets scan, PR' },
    { title: 'Verify', detail: 'CI green at the new head + the failing prepublish path passes' },
    { title: 'Review', detail: 'Fable adversarial review' },
    { title: 'Report', detail: 'merge GO, complete be6817f3' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = 'be6817f3-a28a-4aa6-8f10-a996d8bbb6f5'

const CONST = `
You are a lane of the audit-gate-fix workflow (2026-08-19, task-drain dispatch). Row ${ROW}: BUG: hasna/apps — monorepo release gate: prepublishOnly 'bun audit' fails on workspace-lockfile advisories, blocking every @hasna/* publish. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/auditfix-<n> from origin/main. PR-first; never push to main. Commits end with 'Agent: auditfix-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check row ${ROW} comments + open PRs touching prepublishOnly/audit — if a fix already landed or is being worked, verify and record; do not duplicate.
- THE FIX: reproduce the prepublishOnly failure at head (record the literal — which package, which advisory, what 'bun audit' reports). Name the advisory surface precisely: the workspace-lockfile advisories are in the MONOREPO lockfile, not in what ships in the member tarball — the release gate must audit what the member actually ships (its packed dependency set), not the workspace lockfile. The smallest owned fix keeps the audit gate REAL (a check that can fail) while scoping it to the shipped surface (e.g. audit the packed tarball's dependency closure, --production scope, or an explicit documented allowlist for advisories that do not reach the published artifact). NEVER: blanket-disable the audit, ignore advisories silently, or widen to a pass that cannot fail.
- TDD where testable (a regression proving the audit gate passes on the member's shipped surface while still failing on a genuine introduced advisory — two-sided). Verify: 'bun install --frozen-lockfile' rc=0, the failing prepublish path now passes at head (literal), the audit gate still fails on a genuine advisory fixture (literal), affected suite green (record counts), secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on ${ROW}, posts to #board. English. Lineage 'conversations agents register' named auditfix-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane. Per the CONST: reproduce the prepublishOnly 'bun audit' failure at head (literal), name the exact advisory surface (workspace lockfile entries vs the member's shipped dependency closure), and decide the smallest fix that keeps the gate real. Return the fix plan.
Return (JSON): { plan: {surface, cause, fix, files: [string]}, reproduction: string, evidence: string }
`

const FIX = CONST + `
ROLE: fix lane. Per the CONST + the plan ({PLAN}): implement the smallest owned fix, TDD the two-sided regression (genuine advisory still fails the gate), the failing prepublish path passes at head (literal), affected suite green (record counts), secrets scan, commit ('Agent: auditfix-<your-role>'), push, PR referencing ${ROW}.
Return (JSON): { prNumber: number, diffSummary: string, gateStillFailsOnAdvisory: string, prepublishPasses: string, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI on the PR ({PR}) — 'gh pr checks', re-run failed jobs, poll bounded (max 15 min), all green at the new head (record the per-check table). The known environmental playwright stall, if the ONLY failure, re-run once and record.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PR ({PR}): (a) the audit gate is scoped to the shipped surface and still REAL (two-sided probe recorded), (b) smallest owned change, (c) CI green, (d) secrets clean, PR-first, no scope creep. Post '[REVIEW] <GO|NO_GO> — audit-gate @ <sha> — lens: release audit gate, reviewer auditfix-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const REPORT = CONST + `
ROLE: report. If GO + acceptanceMet: merge the PR (base-movement gate first; gh pr merge --squash --body-file ending 'Agent: auditfix-ship'), record the merged sha, complete ${ROW} with the evidence. If NO_GO: comment findings + resume condition, leave in_progress.
Return (JSON): { merged: bool, mergedSha: string|null, rowState: string, residue: [string] }
`

const INV_SCHEMA = { type: 'object', properties: { plan: { type: 'object' }, reproduction: { type: 'string' }, evidence: { type: 'string' } }, required: ['plan'] }
const FIX_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, diffSummary: { type: 'string' }, gateStillFailsOnAdvisory: { type: 'string' }, prepublishPasses: { type: 'string' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['prNumber', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const REPORT_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'auditfix-investigate', phase: 'Investigate', schema: INV_SCHEMA })

phase('Fix')
let fix = null
if (investigate && investigate.plan) {
  fix = await agent(FIX.replace('{PLAN}', JSON.stringify(investigate.plan)), { label: 'auditfix-fix', phase: 'Fix', schema: FIX_SCHEMA })
} else {
  fix = { prNumber: null }
}

phase('Verify')
let verify = null
if (fix && fix.prNumber) {
  verify = await agent(VERIFY.replace('{PR}', String(fix.prNumber)), { label: 'auditfix-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'fix did not open a PR', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW.replace('{PR}', String(fix.prNumber)), { label: 'auditfix-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'fix/verify did not complete', detail: JSON.stringify({ investigate, fix, verify }) }] }
}

phase('Report')
const report = await agent(REPORT, { label: 'auditfix-report', phase: 'Report', schema: REPORT_SCHEMA })

return { investigate, fix, verify, review, report }
