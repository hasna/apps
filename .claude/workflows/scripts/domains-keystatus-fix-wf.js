export const meta = {
  name: 'domains-keystatus',
  description: 'Fix lane for row 5eb0c0df (apps/domains server suite: 10 keyStatus-class failures at main — verifyApiKey requires a key-status hook from @hasna/contracts auth at src/server/app.ts:85; pre-existing at base, 557 tests 547 pass / 10 fail). Lane: IDEMPOTENCY CHECK FIRST -> reproduce at CURRENT main -> root fix in domains server auth wiring -> suite green -> one Fable review -> base gate + merge -> complete row with evidence.',
  phases: [
    { title: 'Investigate', detail: 'idempotency check; reproduce the 10 keyStatus failures at CURRENT origin/main (literal); read app.ts:85 and the contracts auth key-status surface' },
    { title: 'Fix', detail: 'smallest owned root fix: wire/restore the key-status hook the verifyApiKey path requires; regression; changeset' },
    { title: 'Verify', detail: 'domains suite 557 green (literal counts), member build rc=0, frozen install rc=0, CI per-check at head, diff gate (apps/domains + changeset only), secrets scan clean' },
    { title: 'Review', detail: 'one Fable adversarial reviewer' },
    { title: 'Land', detail: 'base gate + squash merge + complete row 5eb0c0df with evidence' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '5eb0c0df'

const CONST = `
You are the domains-keystatus lane (row ${ROW}; owner-authorized via the task-drain queue). Final text = machine-readable JSON.

Context (filed 2026-08-21 from the domains-ts2367 lane verify, wf_43f8cce7-1a0): apps/domains server suite fails 10 tests at main (557 tests: 547 pass / 10 fail / 1576 expects) — verifyApiKey requires a key-status hook from @hasna/contracts auth at src/server/app.ts:85. Pre-existing at the repro base 64a44efc and identical at ccf0fc06c. Separate defect class from the cloud-http residue (row 4b6d85af, own lane in flight) and from the modes surface (row 0731ef62, completed).

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: confirm row ${ROW} is still pending and unowned (no in_progress fixer row); check for an existing open PR fixing the keyStatus/verifyApiKey class (gh pr list --repo hasna/apps --search 'keyStatus in:title,body' and 'verifyApiKey in:title,body' — open domains PRs (515/468 modes-purge, 759 residue-land closed-unmerged) are OTHER scopes: do not confuse or touch them). Sync the checkout (git -C ${MONOREPO} fetch origin main -q; never discard local work). Reproduce at CURRENT origin/main: run the domains server suite in your worktree after a clean frozen install — literal rc + the 10 failing test names. If the suite already passes at current main, record the evidence and STOP (the lane is complete by recovery). NOTE: main CI may be red at other steps (contracts-pin d175d558, machines-prepare 3b2a7f1e — separate lanes in flight); your reproduction must isolate the domains suite failure.
- ${MONOREPO} is READ/context only. File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/domains-keystatus cut from CURRENT origin/main. NEW BRANCH fix/domains-keystatus. PR-first; never push to main. Commits end with 'Agent: domains-keystatus-<role>' (the ONLY attribution line; never Co-Authored-By). Commit identity MUST be the canonical fleet identity (name 'Andrei Hasna', email andrei@hasna.com).
- FIX AT THE ROOT, NARROWLY: read apps/domains/src/server/app.ts:85 and the @hasna/contracts auth surface to name the exact missing key-status hook; wire it the way the domain's own auth flow expects (match the member's existing usage pattern; if the contracts auth package provides the hook, use it — do not hand-roll a parallel key-status implementation). Add a regression that proves the 10 failures are fixed (the failing tests themselves become the regression once green — confirm they exercise the hook path). Add a .changeset/domains-keystatus.md patch changeset. HARD SCOPE GATE: the PR diff MUST be limited to apps/domains (app.ts + directly-flowing auth files + the regression + the changeset) — any other app file is a self-inflicted NO_GO. If the root cause lives in @hasna/contracts rather than domains, diagnose it, record the exact owning fix needed, and STOP with the finding (do NOT modify apps/contracts in this lane without a named contracts owner).
- VERIFY: the domains server suite passes at the head (literal passed/failed counts, zero keyStatus failures); domains member build rc=0 (literal); 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules, literal); CI per-check table at the head (gh api actions/runs?head_sha=<sha> + per-job conclusions, bounded polling — build+test green for the domains reason; other named lane residuals recorded with the classification); diff gate (apps/domains + changeset only); secrets scan clean (redirect + 'secrets scan input', rc 0 clean).
- REVIEW (one Fable adversarial reviewer): (a) root fix wired at the owning surface (hook from contracts auth, no parallel implementation), (b) domains server suite green at the head — zero keyStatus failures (literal), (c) member build passes, (d) CI at the head green for the domains reason (or the exact named non-this-lane residual), (e) diff gate within scope, (f) mergeability vs CURRENT origin/main (merge-tree clean), (g) secrets clean. Post '[REVIEW] <GO|NO_GO> — domains-keystatus @ <sha> — lens: auth key-status hook repair, reviewer domains-keystatus-review' to #board. Block ONLY concrete P0/P1 defects; two remediation cycles max.
- LAND: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: domains-keystatus-land', record the merged sha, LIVE-VERIFY the domains server suite at the merged main tip (bounded), complete row ${ROW} with the evidence (merged sha, suite result, review verdict). If NO_GO: comment findings + resume condition on the PR and the row, leave open, row stays pending.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on the PR and row ${ROW}, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Reproduce the 10 keyStatus failures at CURRENT origin/main (frozen install in your worktree first, then the domains server suite) — literal rc + the failing test names; read apps/domains/src/server/app.ts:85 and the @hasna/contracts auth surface to name the missing hook and the correct wiring. Return (JSON): { mainTip, reproRc, failingTests: [string], rootCauseSurface, missingHook, filesToChange: [string], notChecked: [string] }
`

const FIX = CONST + `
ROLE: fix lane (Opus). At the head after investigate: wire the key-status hook at the owning surface (contracts auth hook, no parallel implementation), add the regression + changeset; HARD SCOPE GATE (see CONST — if root cause is in apps/contracts, STOP with the finding); canonical commit identity; commit; push; open the PR referencing row ${ROW}. Return (JSON): { newHead, rootCauseFixed, suiteCounts: {passed, failed}, diffStatSummary, prNumber, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head: domains server suite passes (literal counts, zero keyStatus failures); domains member build rc=0 (literal); frozen install rc=0 (literal, bun 1.3.14, zero node_modules); CI per-check table at the head (bounded polling; build+test green for the domains reason; other named lane residuals classified); diff gate (apps/domains + changeset only); secrets scan clean. Return (JSON): { suiteCounts: {passed, failed}, keyStatusFailuresZero: bool, memberBuildRc, frozenInstallRc, ciGreen, checks: [{name, conclusion, classification}], ciResiduals: [string], diffGatePass, secretsClean, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). One review at the new head: (a) root fix wired at the owning surface (contracts auth hook, no parallel implementation), (b) domains server suite green — zero keyStatus failures (literal), (c) member build passes, (d) CI at the head green for the domains reason (or the exact named non-this-lane residual), (e) diff gate within scope, (f) mergeability vs CURRENT origin/main (merge-tree clean), (g) secrets clean. Post '[REVIEW] <GO|NO_GO> — domains-keystatus @ <sha> — lens: auth key-status hook repair, reviewer domains-keystatus-review' to #board. Block ONLY concrete P0/P1 defects. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: domains-keystatus-land', record merged sha, LIVE-VERIFY the domains server suite at the merged main tip (bounded), complete row ${ROW} with the evidence. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, liveSuiteRc, rowState, residue: [] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { mainTip: { type: 'string' }, reproRc: { type: 'number' }, failingTests: { type: 'array' }, rootCauseSurface: { type: 'string' }, missingHook: { type: 'string' }, filesToChange: { type: 'array' }, notChecked: { type: 'array' } }, required: ['mainTip', 'reproRc', 'rootCauseSurface'] }
const FIX_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, rootCauseFixed: { type: 'string' }, suiteCounts: { type: 'object' }, diffStatSummary: { type: 'string' }, prNumber: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'prNumber'] }
const VERIFY_SCHEMA = { type: 'object', properties: { suiteCounts: { type: 'object' }, keyStatusFailuresZero: { type: 'boolean' }, memberBuildRc: { type: 'number' }, frozenInstallRc: { type: 'number' }, ciGreen: { type: 'boolean' }, checks: { type: 'array' }, ciResiduals: { type: 'array' }, diffGatePass: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['keyStatusFailuresZero', 'ciGreen', 'checks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, liveSuiteRc: { type: ['number', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'domains-keystatus-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
const fix = investigate && investigate.reproRc !== 0 ? await agent(FIX, { label: 'domains-keystatus-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' }) : null

phase('Verify')
const verify = fix && fix.pushed ? await agent(VERIFY, { label: 'domains-keystatus-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'domains-keystatus-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'investigate/fix/verify did not complete or the suite already recovered', detail: JSON.stringify({ investigate, fix, verify }) }] }

phase('Land')
const land = review && review.verdict === 'GO'
  ? await agent(LAND, { label: 'domains-keystatus-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, liveSuiteRc: null, rowState: 'pending', residue: ['NO_GO — fix lane must remediate per findings (two-cycle cap)'] }

return { investigate: investigate && { mainTip: investigate.mainTip, reproRc: investigate.reproRc, rootCauseSurface: investigate.rootCauseSurface }, fix: fix && { newHead: fix.newHead, prNumber: fix.prNumber, suiteCounts: fix.suiteCounts, diffStatSummary: fix.diffStatSummary }, verify: verify && { keyStatusFailuresZero: verify.keyStatusFailuresZero, ciGreen: verify.ciGreen, ciResiduals: verify.ciResiduals }, review: review && review.verdict, land }
