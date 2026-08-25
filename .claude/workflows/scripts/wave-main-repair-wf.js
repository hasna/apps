export const meta = {
  name: 'wave-main-repair',
  description: 'Main-content repair for the wave-caused CI gate classes (from the wave602 successor final-cycle NO_GO resume conditions, #602 stopped 2026-08-20): fix on MAIN via ordinary PRs (NOT a version wave — no version bumps) so the next legitimate wave from the changeset pool can pass CI. Named classes: (1) kit-bin ENOENT — events/consolidations/notes artifact-scan and events src/contract.test.ts fail on workspace-linked contracts kit bin (no .bin shim for linked members; fix per contracts/machines precedent d1936c56d3 — bunx fallback or committed declarations); (2) contracts smoke-todos-pack required-files list vs types/ layout; (3) apps/access openapi.json drift (3 OpenAPI snapshot tests) — regenerate. TDD, Fable review, merge',
  phases: [
    { title: 'Fix', detail: 'kit-bin ENOENT class + contracts smoke-todos-pack + access openapi regen (ordinary PRs, no version bumps)' },
    { title: 'Verify', detail: '5/5 CI green at the new head' },
    { title: 'Review', detail: 'Fable adversarial review' },
    { title: 'Ship', detail: 'merge GO' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'

const CONST = `
You are a lane of the wave-main-repair workflow (2026-08-20). The version-wave lineage (PR #602) was STOPPED at its final remediation cycle (bounded-review policy); its recorded resume conditions name wave-caused gate classes that must be repaired ON MAIN via ordinary PRs so the next legitimate wave from the changeset pool can pass CI. The named classes (from the NO_GO record on #602):
(1) KIT-BIN ENOENT: apps/events src/contract.test.ts (7 tests) fails 'ENOENT .../apps/events/node_modules/.bin/contracts' and the publish-guard artifact-scan fails the same class for events/consolidations/notes — workspace-linked contracts kit bin absent (bun creates no .bin shim for linked members). Fix per the contracts/machines precedent d1936c56d3 (bunx fallback or committed declarations) — the smallest owned change that makes the workspace-linked path resolve.
(2) CONTRACTS SMOKE: 'smoke-todos-pack required-files stale vs types/ layout' — the smoke-todos-pack check's required-files list no longer matches the packed layout; reconcile the list to the actual types/ layout.
(3) ACCESS OPENAPI: 3 OpenAPI snapshot tests drift — regenerate apps/access openapi.json from source (verify:generated contract).
These are ordinary content PRs — NO version bumps, NO changesets, NO wave content. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work; shared checkout dirty from other lanes — fetch refs and work from a worktree if the pull refuses). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/wave-mr-<n> from origin/main. NEW BRANCH wave-main-repair; PR-first; never push to main. Commits end with 'Agent: wave-mr-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check for an open PR touching these classes (gh pr list --search 'kit-bin OR smoke-todos-pack OR openapi in:title,body'); if a repair already landed, verify and record; do not duplicate.
- TDD: write the failing regression first (the events contract.test.ts ENOENT, the smoke-todos-pack required-files assertion, the access openapi snapshot) — red, then the smallest owned fix, green.
- Verify: events suite green (record counts), 'bun run check:supply-chain:audit'-class probes pass, 'bun install --frozen-lockfile' rc=0, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the PR(s), posts to #board. English. Lineage 'conversations agents register' named wave-mr-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const FIX = CONST + `
ROLE: fix lane. Per the CONST: the three named classes, TDD red-first, smallest owned changes, affected suites green (record counts), frozen install rc=0, secrets scan, commit ('Agent: wave-mr-<your-role>'), push, open the PR(s) referencing the #602 stopped-lineage record.
Return (JSON): { prNumber: number, diffSummary: string, classesFixed: [{class, fix}], suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks' on the PR ({PR}), re-run failed jobs, poll bounded (max 20 min), all five checks green at the new head (record the per-check table; build+test and publish guard are the two that carried the classes). The known environmental playwright stall, if the ONLY failure, re-run once and record.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PR ({PR}): (a) each class fixed at root (kit-bin resolution per the precedent — measured; smoke-todos-pack reconciled to the real layout; access openapi regenerated byte-reproducibly), (b) regression tests red-before/green-after, (c) NO version bumps / NO changesets (content-only), (d) 5/5 CI green, (e) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — wave-main-repair @ <sha> — lens: wave-caused gate classes on main, reviewer wave-mr-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge the PR (base-movement gate first — merge-tree against origin/main; gh pr merge --squash --body-file ending 'Agent: wave-mr-ship'), record the merged sha. If NO_GO: comment findings + resume condition, leave open.
Return (JSON): { merged: bool, mergedSha: string|null, residue: [string] }
`

const FIX_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, diffSummary: { type: 'string' }, classesFixed: { type: 'array' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['prNumber', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, residue: { type: 'array' } }, required: ['merged'] }

phase('Fix')
const fix = await agent(FIX, { label: 'wave-mr-fix', phase: 'Fix', schema: FIX_SCHEMA })

phase('Verify')
let verify = null
if (fix && fix.prNumber) {
  verify = await agent(VERIFY.replace('{PR}', String(fix.prNumber)), { label: 'wave-mr-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'fix did not open a PR', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW.replace('{PR}', String(fix.prNumber)), { label: 'wave-mr-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'fix/verify did not complete', detail: JSON.stringify({ fix, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'wave-mr-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { fix, verify, review, ship }
