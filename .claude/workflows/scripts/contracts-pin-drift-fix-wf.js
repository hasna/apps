export const meta = {
  name: 'contracts-pin-drift',
  description: 'Fix lane for row d175d558 (Standard suite: contracts conformance drift at main — 9 members pin unpublished @hasna/contracts 0.13.0 making the validator cannot-run + stale kitVersion mismatch). Lane: IDEMPOTENCY CHECK FIRST -> reproduce the cannot-run at CURRENT main -> smallest owned fix (pins to the published version + kitVersion alignment per member, dedup vs open align PRs) -> standard suite green -> one Fable review -> base gate + merge -> complete row with evidence.',
  phases: [
    { title: 'Investigate', detail: 'idempotency check; reproduce validator cannot-run at CURRENT main; enumerate the 9 members + their pin/kitVersion state; check overlap with open align PRs' },
    { title: 'Fix', detail: 'smallest owned fix: pins -> published @hasna/contracts version, kitVersion alignment per member, dedup vs open PRs' },
    { title: 'Verify', detail: 'standard suite green at head (validator runs), frozen install rc=0, CI green, diff gate (the 9 members + changesets only)' },
    { title: 'Review', detail: 'one Fable adversarial reviewer' },
    { title: 'Land', detail: 'base gate + squash merge + complete row d175d558 with evidence' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = 'd175d558-4fc3-428b-bde5-cc737b08cac1'

const CONST = `
You are the contracts-pin-drift lane (row ${ROW}; owner-authorized via the task-drain queue). Final text = machine-readable JSON.

Context (filed 2026-08-21): at CURRENT main, 9 member apps pin @hasna/contracts to 0.13.0 which is NOT published (registry serves 0.13.1) — the standard-suite conformance validator cannot run for those members. There is also a stale kitVersion mismatch registry. Fix: align the pins to the published version and the kitVersion per member.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: confirm row ${ROW} is still pending and unowned (no in_progress fixer row); check open PRs that may already fix a member's pin/kitVersion — the open contracts-align PRs (465 controls, 553 tables, 567 knowledge, 554 testers, 551 signatures, 556 workforce, 468 domains, and any similar) are OLD kit-0.11 lanes: DO NOT duplicate a member already fixed or being fixed by an open PR; record the dedup decision per member. PR 743 (machines prepare edge) is a DIFFERENT lane — do not confuse or touch it. Sync the checkout (git -C ${MONOREPO} fetch origin main -q; never discard local work). Reproduce at CURRENT origin/main: run the standard-suite conformance check (the validator verb the suite uses — e.g. 'bun run check' or the standard-suite check) — literal rc + the cannot-run output naming the 9 members. If the suite already passes at current main, record the evidence and STOP (the lane is complete by recovery).
- ${MONOREPO} is READ/context only. File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/contracts-pin-drift cut from CURRENT origin/main. NEW BRANCH fix/contracts-pin-drift. PR-first; never push to main. Commits end with 'Agent: contracts-pin-drift-<role>' (the ONLY attribution line; never Co-Authored-By). Commit identity MUST be the canonical fleet identity (name 'Andrei Hasna', email andrei@hasna.com).
- FIX AT THE ROOT, NARROWLY: per member — update the @hasna/contracts pin from the unpublished 0.13.0 to the published version the member actually needs (registry-verified; 0.13.1 published 2026-08-21), and align the manifest kitVersion to the declared contracts kit (read the current contracts kit from apps/contracts package.json, do not guess). Regenerate bun.lock at the resolved head if pins changed. Add one .changeset per touched member (or a single changeset listing them — use the repo's convention). HARD SCOPE GATE: the PR diff MUST be limited to the affected members' package.json/hasna.contract.json files + bun.lock + changesets — any unrelated app file is a self-inflicted NO_GO.
- VERIFY: the standard-suite conformance check runs and passes at the head (literal rc + output — the validator must RUN, not skip); 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules, literal); CI per-check table green at the head sha (gh api actions/runs?head_sha=<sha> + per-job conclusions, bounded polling); diff gate (affected members only); secrets scan clean (redirect + 'secrets scan input', rc 0 clean).
- REVIEW (one Fable adversarial reviewer): (a) the cannot-run is fixed at the root (validator RUNS at the head, measured), (b) every pinned version is registry-verified, (c) kitVersion aligns to the declared kit per member, (d) dedup decision per member recorded (no duplicate of an open PR), (e) CI green at the head, (f) diff gate within scope, (g) mergeability vs CURRENT origin/main (merge-tree clean). Post '[REVIEW] <GO|NO_GO> — contracts-pin-drift @ <sha> — lens: conformance pin repair, reviewer contracts-pin-drift-review' to #board. Block ONLY concrete P0/P1 defects; two remediation cycles max.
- LAND: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: contracts-pin-drift-land', record the merged sha, LIVE-VERIFY the standard suite at the merged main tip (bounded), complete row ${ROW} with the evidence (merged sha, validator rc, suite result, review verdict). If NO_GO: comment findings + resume condition on the PR and the row, leave open, row stays pending.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on the PR and row ${ROW}, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Reproduce the validator cannot-run at CURRENT origin/main — literal rc + the member list; read each affected member's pin + manifest kitVersion; compare against the registry (published @hasna/contracts versions) and the contracts kit in apps/contracts; check open PR overlap per member (dedup decisions). Return (JSON): { mainTip, reproRc, reproOutput, members: [{name, pin, kitVersion, dedupPr}], publishedContracts, declaredKit, notChecked: [string] }
`

const FIX = CONST + `
ROLE: fix lane (Opus). At the head after investigate: apply the smallest owned fix per member (pin -> published version, kitVersion alignment, dedup honored), regen bun.lock, add changesets; HARD SCOPE GATE (see CONST); canonical commit identity; commit; push; open the PR referencing row ${ROW}. Return (JSON): { newHead, membersFixed: [string], dedupedMembers: [string], diffStatSummary, prNumber, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head: standard-suite conformance check RUNS and PASSES (literal rc + output; the validator must run, not skip); frozen install rc=0 (literal, bun 1.3.14, zero node_modules); CI per-check table green at the head (bounded polling); diff gate (affected members + lock + changesets only); secrets scan clean. Return (JSON): { validatorRuns, validatorRc, validatorOutput, frozenInstallRc, ciGreen, checks: [{name, conclusion}], diffGatePass, secretsClean, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). One review at the new head: (a) cannot-run fixed at the root (validator RUNS, measured), (b) every pinned version registry-verified, (c) kitVersion aligned per member, (d) dedup decisions recorded, (e) CI green at the head, (f) diff gate within scope, (g) mergeability vs CURRENT origin/main (merge-tree clean), (h) secrets clean. Post '[REVIEW] <GO|NO_GO> — contracts-pin-drift @ <sha> — lens: conformance pin repair, reviewer contracts-pin-drift-review' to #board. Block ONLY concrete P0/P1 defects. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: contracts-pin-drift-land', record merged sha, LIVE-VERIFY the standard suite at the merged main tip (bounded poll), complete row ${ROW} with the evidence. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, liveSuiteRc, rowState, residue: [] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { mainTip: { type: 'string' }, reproRc: { type: 'number' }, reproOutput: { type: 'string' }, members: { type: 'array' }, publishedContracts: { type: 'string' }, declaredKit: { type: 'string' }, notChecked: { type: 'array' } }, required: ['mainTip', 'reproRc', 'members'] }
const FIX_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, membersFixed: { type: 'array' }, dedupedMembers: { type: 'array' }, diffStatSummary: { type: 'string' }, prNumber: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'prNumber'] }
const VERIFY_SCHEMA = { type: 'object', properties: { validatorRuns: { type: 'boolean' }, validatorRc: { type: 'number' }, validatorOutput: { type: 'string' }, frozenInstallRc: { type: 'number' }, ciGreen: { type: 'boolean' }, checks: { type: 'array' }, diffGatePass: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['validatorRuns', 'validatorRc', 'ciGreen'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, liveSuiteRc: { type: ['number', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'contracts-pin-drift-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
const fix = investigate && investigate.reproRc !== 0 ? await agent(FIX, { label: 'contracts-pin-drift-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' }) : null

phase('Verify')
const verify = fix && fix.pushed ? await agent(VERIFY, { label: 'contracts-pin-drift-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'contracts-pin-drift-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'investigate/fix/verify did not complete or the drift already recovered', detail: JSON.stringify({ investigate, fix, verify }) }] }

phase('Land')
const land = review && review.verdict === 'GO'
  ? await agent(LAND, { label: 'contracts-pin-drift-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, liveSuiteRc: null, rowState: 'pending', residue: ['NO_GO — fix lane must remediate per findings (two-cycle cap)'] }

return { investigate: investigate && { mainTip: investigate.mainTip, reproRc: investigate.reproRc, members: investigate.members }, fix: fix && { newHead: fix.newHead, prNumber: fix.prNumber, membersFixed: fix.membersFixed, dedupedMembers: fix.dedupedMembers }, verify: verify && { validatorRuns: verify.validatorRuns, validatorRc: verify.validatorRc, ciGreen: verify.ciGreen }, review: review && review.verdict, land }
