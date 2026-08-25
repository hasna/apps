export const meta = {
  name: 'contracts-split',
  description: 'Contracts-split release lane (the machines-split precedent, wf_51fae249-bc2): wave PR #670 (Version Packages, 40 bumps) bumps @hasna/contracts 0.11.1->0.11.2 but 0.11.2 is UNPUBLISHED — the wave\'s gates cannot-run until it exists on npm (same circularity machines 0.2.28 had, resolved by #600+#646 split). This lane: release(contracts) PR consuming the contracts changesets from the pool, review, merge, publish-all publishes 0.11.2, the wave drops its contracts entry per coordination and its gates resolve',
  phases: [
    { title: 'Release', detail: 'release(contracts) PR: 0.11.1->0.11.2 consuming pool changesets' },
    { title: 'Verify', detail: '5/5 CI green at the new head' },
    { title: 'Review', detail: 'Fable release review (exact candidate)' },
    { title: 'Ship', detail: 'merge GO + coordination note; publish-all ships 0.11.2' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'

const CONST = `
You are a lane of the contracts-split workflow (2026-08-20). Wave PR hasna/apps#670 'Version Packages' @ 6f97ef5e7 (40 package bumps) includes @hasna/contracts 0.11.1->0.11.2, but 0.11.2 is UNPUBLISHED (npm view @hasna/contracts version = 0.11.1). The wave's CI cannot run its gates until contracts 0.11.2 exists on the registry — the SAME circularity @hasna/machines 0.2.28 had, resolved by the machines-split (PR #600 version bump merged, PR #646 release-machines remediation, publish-all published 0.2.28, the wave dropped its machines entry per coordination). THIS LANE IS THE CONTRACTS-SPLIT: a release(contracts) PR applying the contracts changesets from the .changeset pool (0.11.1->0.11.2), merged, then publish-all publishes 0.11.2; the wave then drops its contracts entry per version-coordination and its cannot-run gates resolve. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work; shared checkout dirty from other lanes — fetch refs and work from a worktree if the pull refuses). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/contracts-split-<n> from origin/main. NEW BRANCH release-contracts; PR-first; never push to main. Commits end with 'Agent: csplit-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check for an open/merged release-contracts PR or a contracts release already on the registry (npm view @hasna/contracts version + gh pr list --search 'release(contracts) OR contracts 0.11.2'); if already done, verify and record; do not duplicate.
- THE RELEASE: consume the contracts changesets from the pool (measure which .changeset/*.md reference @hasna/contracts; the pool drives one patch/minor bump to 0.11.2 — the wave's #670 contracts entry must then DROP per the coordination note recorded on both PRs), bump apps/contracts package.json + CHANGELOG to 0.11.2. SMALLEST owned release change — no kitVersion manifest edits (those stay in the wave), no unrelated content.
- Verify: contracts suite green (record counts), 'bun install --frozen-lockfile' rc=0, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the PR and wave PR #670 (the coordination note), posts to #board. English. Lineage 'conversations agents register' named csplit-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const RELEASE = CONST + `
ROLE: release lane. Per the CONST: measure the pool's contracts changesets, apply them (0.11.1->0.11.2, CHANGELOG + package.json), contracts suite green (record counts), frozen install rc=0, secrets scan, commit ('Agent: csplit-<your-role>'), push, open the release(contracts) PR with the version-coordination note for wave #670.
Return (JSON): { prNumber: number, diffSummary: string, poolChangesets: [string], newVersion: string, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks' on the PR ({PR}), re-run failed jobs, poll bounded (max 20 min), all five checks green at the new head (record the per-check table). The known environmental playwright stall, if the ONLY failure, re-run once and record.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) — the release candidate. Review the PR ({PR}): (a) the bump is exactly 0.11.1->0.11.2 from the pool's contracts changesets (no other version changes), (b) no kitVersion/manifest edits (wave's scope), (c) coordination note for wave #670 recorded (its contracts entry drops), (d) 5/5 CI green, (e) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — contracts-split @ <sha> — lens: release candidate, reviewer csplit-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge the PR (base-movement gate first — merge-tree against origin/main; gh pr merge --squash --body-file ending 'Agent: csplit-ship'), record the merged sha, post '[PUBLISH INTENT] @hasna/contracts@0.11.2 — contracts-split (wave #670 precondition)' on git-publishing BEFORE any publish (publish-all is the ONLY publisher — this lane does NOT publish). If NO_GO: comment findings + resume condition, leave open.
Return (JSON): { merged: bool, mergedSha: string|null, intentPosted: bool, residue: [string] }
`

const REL_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, diffSummary: { type: 'string' }, poolChangesets: { type: 'array' }, newVersion: { type: 'string' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['prNumber', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, intentPosted: { type: 'boolean' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Release')
const release = await agent(RELEASE, { label: 'csplit-release', phase: 'Release', schema: REL_SCHEMA })

phase('Verify')
let verify = null
if (release && release.prNumber) {
  verify = await agent(VERIFY.replace('{PR}', String(release.prNumber)), { label: 'csplit-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'release did not open a PR', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW.replace('{PR}', String(release.prNumber)), { label: 'csplit-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'release/verify did not complete', detail: JSON.stringify({ release, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'csplit-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { release, verify, review, ship }
