export const meta = {
  name: 'test-guard-sentinel-version',
  description: 'Fix lane for row 1804474f (test-guard sentinel.sh VERSION hardcodes 0.0.2 — wave-caused pack failure blocked wave PR 791, publish-guard NO_GO per git-publishing 721276). Fix: sentinel.sh VERSION derives from package.json (script-relative, POSIX tools only — the sentinel guards bun and must not depend on bun/node at VERSION read time). Regression red-before/green-after; publish-guard + versioning test-suites green; one Fable review; base gate + merge; complete row. The NEXT ship-latest wave proceeds after this lands (this lane never opens or touches the terminated wave PR 791).',
  phases: [
    { title: 'Investigate', detail: 'idempotency check; verify the drift at CURRENT origin/main (sentinel.sh:34 static VERSION vs package.json); confirm the wave-caused pack failure shape on PR 791 CI' },
    { title: 'Fix', detail: 'root fix: derive VERSION from package.json script-relative, POSIX-only; regression red-before/green-after; changeset; NEW PR' },
    { title: 'Verify', detail: 'regression passes (literal); test-guard suite green; frozen install; pack + publish-guard clean; CI per-check at head; diff gate (apps/test-guard + changeset only); secrets clean' },
    { title: 'Review', detail: 'one Fable adversarial reviewer' },
    { title: 'Land', detail: 'base gate + squash merge + complete row 1804474f with evidence' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '1804474f'
const CLASS_ROW = 'b335a922'
const TERMINATED_WAVE_PR = '791'

const CONST = `
You are the test-guard-sentinel-version fix lane (row ${ROW}; owner-authorized via the signal-to-task queue; the versioning runtime-export drift class row is ${CLASS_ROW}). Final text = machine-readable JSON.

Context (filed 2026-08-21 13:56-14:00Z): the ship-latest merge lane terminated wave PR ${TERMINATED_WAVE_PR} (Version Packages: attachments 1.1.7, test-guard 0.0.3) as NO_GO — publish-guard failed on a wave-caused test-guard pack failure; CI at the 791 head: build+test fail, gates fail, publish guard fail, test-suites fail, verify-artifacts pass. The merge lane's diagnosis (git-publishing 721276): apps/test-guard/sentinel.sh:34 hardcodes VERSION="0.0.2" while the wave bumps package.json to 0.0.3, so the packed artifact carries a stale static version. VERIFIED at source on origin/main: sentinel.sh:34 is a static literal. This lane fixes that surface so the NEXT wave can proceed. It does NOT touch PR ${TERMINATED_WAVE_PR} (wave-terminated; leave it open, do not reopen, do not push to its branch).

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: (a) row ${ROW} is pending and unowned (no in_progress fixer row); (b) PR ${TERMINATED_WAVE_PR} is OPEN and wave-terminated — do NOT modify it, and confirm no OTHER open PR fixes the sentinel VERSION drift (gh pr list --repo hasna/apps --search 'sentinel in:title,body' — only the terminated wave may appear); (c) reproduce at CURRENT origin/main FIRST: read apps/test-guard/sentinel.sh:34 and confirm VERSION is still a static literal mismatching package.json; if main already derives VERSION, record the evidence and STOP (complete by recovery).
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} fetch origin main -q; never discard local work). Resolve CURRENT origin/main from FETCH_HEAD and verify FETCH_HEAD == gh api repos/hasna/apps/commits/heads/main --jq .sha. File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/test-guard-sentinel-version cut from CURRENT origin/main. NEW BRANCH fix/test-guard-sentinel-version. PR-first; never push to main. Commits end with 'Agent: test-guard-sentinel-version-<role>' (the ONLY attribution line; never Co-Authored-By). Commit identity MUST be the canonical fleet identity (Andrei Hasna <andrei@hasna.com>).
- FIX AT THE ROOT, NARROWLY: in apps/test-guard/sentinel.sh, derive VERSION from the package.json sitting beside the script (script-relative dirname \$0), using POSIX tools only — the sentinel is the component that GUARDS bun, so VERSION must be readable with no bun/node/jq dependency at read time (pure sed/grep/cut head -1 is the established shape). Keep a documented fallback for a standalone copy without package.json (the fallback MUST be visibly version-stale-proof: prefer failing the probe over silently reporting a wrong version — the sentinel already fails closed on other invariants). Do not change PINNED_BUN_VERSION or any other behavior. Add a regression that proves: with package.json version = X, the sentinel's VERSION line reads X with no manual edit (red-before: the static literal fails this; green-after: the derive passes). Add a .changeset/test-guard-sentinel-version.md patch changeset. HARD SCOPE GATE: the PR diff MUST be limited to apps/test-guard (sentinel.sh + the regression + the changeset) — any other app file is a self-inflicted NO_GO.
- VERIFY at the head (bounded): the regression passes (red-before/green-after measured, literal); test-guard suite green (literal counts); 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules, literal); pack test-guard and confirm the packed sentinel.sh carries the package.json version (literal) — this is the wave-failure shape the fix must close; CI per-check table at the head (bounded polling — classify every failure against CURRENT origin/main state: main's own run must fail identically for a main-state residual (contracts 0.13.3 resolution class, versioning-integrity); test-guard-caused failures MUST be green); diff gate (apps/test-guard + changeset only); secrets scan clean.
- REVIEW (one Fable adversarial reviewer): (a) red-before/green-after measured, (b) root fix at the owning surface (derive from package.json, POSIX-only, no behavior change to PINNED_BUN_VERSION or the fail-closed invariants), (c) packed sentinel carries the package version (literal), (d) test-guard suite green, (e) CI at the head green for the test-guard reason (or the exact named non-this-lane residual), (f) diff gate within scope, (g) mergeability vs CURRENT origin/main (merge-tree clean), (h) secrets clean. Post '[REVIEW] <GO|NO_GO> — test-guard-sentinel-version @ <sha> — lens: static-version drift root fix, reviewer test-guard-sentinel-version-review' to #board. Block ONLY concrete P0/P1 defects; two remediation cycles max.
- LAND: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: test-guard-sentinel-version-land', record the merged sha, LIVE-VERIFY the sentinel VERSION derivation at the merged main tip (bounded), complete row ${ROW} with evidence referencing ${CLASS_ROW} as the class row. If NO_GO: comment findings + resume condition, leave open, row stays pending. The next ship-latest wave proceeds on its own cadence after this lands — this lane does NOT launch it. The package publishes via publish-all's next census (the ONLY publisher) — this lane never calls npm publish.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on the PR and row ${ROW}, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Reproduce at CURRENT origin/main: read apps/test-guard/sentinel.sh VERSION surface (literal line) and compare with package.json version (literal); confirm the wave-caused pack failure shape from PR ${TERMINATED_WAVE_PR} CI (per-check table, literal). Return (JSON): { mainTip, sentinelVersionLine, packageVersion, driftConfirmed, ciAt791: [{name, conclusion}], filesToChange: [string], notChecked: [string] }
`

const FIX = CONST + `
ROLE: fix lane (Opus). At the head after investigate: apply the smallest owned root fix in apps/test-guard (sentinel.sh VERSION derives from package.json, script-relative, POSIX-only, fail-closed fallback); regression red-before/green-after; changeset; HARD SCOPE GATE (apps/test-guard + changeset only); NEW BRANCH fix/test-guard-sentinel-version; canonical commit identity; commit; push; open the PR referencing rows ${ROW}/${CLASS_ROW}. Return (JSON): { newHead, rootCauseFixed, redBefore, greenAfter, diffStatSummary, prNumber, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head: regression passes (literal, red-before/green-after measured); test-guard suite green (literal counts); 'bun install --frozen-lockfile' rc=0 (literal, bun 1.3.14, zero node_modules); pack test-guard and confirm the PACKED sentinel.sh carries the package.json version (literal); CI per-check table at the head (bounded polling; every failure classified vs CURRENT origin/main — main-state residuals named, test-guard-caused MUST be green); diff gate (apps/test-guard + changeset only); secrets scan clean. Return (JSON): { regression: {redBefore, greenAfter}, suiteCounts: {passed, failed}, frozenInstallRc, packedVersionMatch, ciGreen, checks: [{name, conclusion, classification}], ciResiduals: [string], diffGatePass, secretsClean, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). One review at the new head: (a) red-before/green-after measured, (b) root fix at the owning surface (derive from package.json, POSIX-only, fail-closed fallback, PINNED_BUN_VERSION and fail-closed invariants unchanged), (c) packed sentinel carries the package version (literal), (d) test-guard suite green, (e) CI at the head green for the test-guard reason (or the exact named non-this-lane residual), (f) diff gate within scope, (g) mergeability vs CURRENT origin/main (merge-tree clean), (h) secrets clean. Post '[REVIEW] <GO|NO_GO> — test-guard-sentinel-version @ <sha> — lens: static-version drift root fix, reviewer test-guard-sentinel-version-review' to #board. Block ONLY concrete P0/P1 defects. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: test-guard-sentinel-version-land', record merged sha, LIVE-VERIFY the sentinel VERSION derivation at the merged main tip (bounded), complete row ${ROW} with evidence. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, liveVerifyRc, rowState, residue: [] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { mainTip: { type: 'string' }, sentinelVersionLine: { type: 'string' }, packageVersion: { type: 'string' }, driftConfirmed: { type: 'boolean' }, ciAt791: { type: 'array' }, filesToChange: { type: 'array' }, notChecked: { type: 'array' } }, required: ['mainTip', 'driftConfirmed'] }
const FIX_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, rootCauseFixed: { type: 'string' }, redBefore: { type: 'string' }, greenAfter: { type: 'string' }, diffStatSummary: { type: 'string' }, prNumber: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'prNumber'] }
const VERIFY_SCHEMA = { type: 'object', properties: { regression: { type: 'object' }, suiteCounts: { type: 'object' }, frozenInstallRc: { type: 'number' }, packedVersionMatch: { type: 'boolean' }, ciGreen: { type: 'boolean' }, checks: { type: 'array' }, ciResiduals: { type: 'array' }, diffGatePass: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['regression', 'ciGreen', 'checks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, liveVerifyRc: { type: ['number', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'tg-sentinel-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
const fix = investigate && investigate.driftConfirmed ? await agent(FIX, { label: 'tg-sentinel-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' }) : null

phase('Verify')
const verify = fix && fix.pushed ? await agent(VERIFY, { label: 'tg-sentinel-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'tg-sentinel-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'investigate/fix/verify did not complete or main already derives VERSION', detail: JSON.stringify({ investigate, fix, verify }) }] }

phase('Land')
const land = review && review.verdict === 'GO'
  ? await agent(LAND, { label: 'tg-sentinel-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, liveVerifyRc: null, rowState: 'pending', residue: ['NO_GO — fix lane must remediate per findings (two-cycle cap)'] }

return { investigate: investigate && { driftConfirmed: investigate.driftConfirmed, sentinelVersionLine: investigate.sentinelVersionLine, packageVersion: investigate.packageVersion }, fix: fix && { newHead: fix.newHead, prNumber: fix.prNumber }, verify: verify && { packedVersionMatch: verify.packedVersionMatch, ciGreen: verify.ciGreen, ciResiduals: verify.ciResiduals }, review: review && review.verdict, land }
