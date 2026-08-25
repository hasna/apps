export const meta = {
  name: 'loops-runner-episodes-r1',
  description: 'Successor fix lane for row b3d57dd3 (critical): close the 5 review findings that TERMINATED PR #778 (feat(loops): runner failure episodes — persisted state, structured events, outbox hook; feature row 75810ba9 in_progress). The successor re-opens the same authorized feature as a NEW candidate: read the 5 findings from PR 778 review comments, fix each at the owning surface in apps/loops with a regression per finding, suite, one Fable review, base gate + merge, complete b3d57dd3 + 75810ba9. Publish rides publish-all (the ONLY publisher) — this lane never calls npm publish.',
  phases: [
    { title: 'Investigate', detail: 'idempotency check; read the 5 review findings that terminated PR 778 (PR comments); map each to its owning surface in apps/loops' },
    { title: 'Fix', detail: 'smallest owned root fix per finding in apps/loops (new branch, NEW PR — 778 is terminated); regression per finding; changeset' },
    { title: 'Verify', detail: 'loops suite green (literal counts); regression per finding passes; frozen install; CI per-check at head; diff gate (apps/loops + changeset only); secrets clean' },
    { title: 'Review', detail: 'one Fable adversarial reviewer (fresh review of the new candidate)' },
    { title: 'Land', detail: 'base gate + squash merge + complete rows b3d57dd3 and 75810ba9 with evidence' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = 'b3d57dd3'
const FEATURE_ROW = '75810ba9'
const TERMINATED_PR = '778'

const CONST = `
You are the loops-runner-episodes-r1 successor lane (row ${ROW}; owner-authorized via the task-drain queue; feature row ${FEATURE_ROW} in_progress). Final text = machine-readable JSON.

Context: PR ${TERMINATED_PR} (feat(loops): runner failure episodes — persisted state, structured events, outbox hook; filed from row ${FEATURE_ROW}) was TERMINATED by a review with 5 findings (the bounded-review lineage cap). This lane is the lineage's ONE successor: it delivers the SAME authorized feature as a NEW candidate. The 5 findings are the acceptance list — read them from the PR ${TERMINATED_PR} review comments ([REVIEW] verdict + findings on the PR) and close EACH ONE with a root fix + regression.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: (a) row ${ROW} is pending and unowned (no in_progress fixer row); (b) PR ${TERMINATED_PR} is OPEN but TERMINATED (do NOT reopen it, do NOT push to its branch — a new PR is the successor shape); (c) no OTHER open PR fixes the runner-failure-episodes class (gh pr list --repo hasna/apps --search 'runner episodes in:title,body' — a new PR in this class would be a duplicate); (d) read the 5 findings from PR ${TERMINATED_PR} comments and record them in your output.
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} fetch origin main -q; never discard local work). Resolve CURRENT origin/main from FETCH_HEAD and verify FETCH_HEAD == gh api repos/hasna/apps/commits/heads/main --jq .sha. File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/loops-runner-episodes cut from CURRENT origin/main. NEW BRANCH fix/loops-runner-episodes-r1. PR-first; never push to main. Commits end with 'Agent: loops-runner-episodes-r1-<role>' (the ONLY attribution line; never Co-Authored-By). Commit identity MUST be the canonical fleet identity (Andrei Hasna <andrei@hasna.com>).
- FIX AT THE ROOT, NARROWLY: for each of the 5 findings: name the owning surface in apps/loops (the persisted-state store, the structured-events emitter, the outbox hook, the runner failure path), fix the root cause with the smallest change, and add a regression that fails without the fix (red-before/green-after per finding). Do NOT weaken the outbox guarantee or the persisted-state contract to make a test pass. Add a .changeset/loops-runner-episodes.md patch changeset. HARD SCOPE GATE: the PR diff MUST be limited to apps/loops (the feature's files + directly-flowing files + the regressions + the changeset) — any other app file is a self-inflicted NO_GO.
- VERIFY at the head (bounded): loops suite green (literal passed/failed counts); every regression per finding passes (literal, named per finding); 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules, literal); CI per-check table at the head (bounded polling — classify every failure against CURRENT origin/main state: main's own run must fail identically for a main-state residual (contracts 0.13.3 resolution class, versioning-integrity); loops-caused failures MUST be green); diff gate (apps/loops + changeset only); secrets scan clean.
- REVIEW (one Fable adversarial reviewer): (a) all 5 terminated findings addressed at the owning surface (each named, red-before/green-after measured), (b) the successor is a NEW PR (not a rebase of the terminated ${TERMINATED_PR} — no recycled review), (c) loops suite green + regressions pass (literal), (d) CI at the head green for the loops reason (or the exact named non-this-lane residual), (e) diff gate within scope, (f) mergeability vs CURRENT origin/main (merge-tree clean), (g) secrets clean. Post '[REVIEW] <GO|NO_GO> — loops-runner-episodes-r1 @ <sha> — lens: 5 terminated findings closed at the root, reviewer loops-runner-episodes-review' to #board. Block ONLY concrete P0/P1 defects; two remediation cycles max.
- LAND: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: loops-runner-episodes-r1-land', record the merged sha, LIVE-VERIFY the loops runner-episodes surface at the merged main tip (bounded), complete row ${ROW} with evidence and add a landing-evidence comment on feature row ${FEATURE_ROW} (it was completed 2026-08-21T12:49:26Z as superseded-by-successor — do NOT re-complete it, comment only). If NO_GO: comment findings + resume condition, leave open, rows stay pending. The package publishes via publish-all's next census (the ONLY publisher) — this lane never calls npm publish.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on the PR and rows ${ROW}/${FEATURE_ROW}, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Read the 5 review findings from PR ${TERMINATED_PR} comments and map each to its owning surface in apps/loops. Return (JSON): { rowState, findings: [{title, severity, owningSurface, fixShape}], filesToChange: [string], notChecked: [string] }
`

const FIX = CONST + `
ROLE: fix lane (Opus). At the head after investigate: implement the smallest owned root fix per finding in apps/loops (owning surfaces per the investigate mapping); add a regression PER FINDING (red-before/green-after, literal); changeset; HARD SCOPE GATE (apps/loops + changeset only); NEW BRANCH fix/loops-runner-episodes-r1 (never the terminated ${TERMINATED_PR} branch); canonical commit identity; commit; push; open the NEW PR referencing rows ${ROW}/${FEATURE_ROW}. Return (JSON): { newHead, findingsClosed: [string], regressionsAdded: [string], diffStatSummary, prNumber, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head: loops suite green (literal counts); every per-finding regression passes (literal, named); 'bun install --frozen-lockfile' rc=0 (literal, bun 1.3.14, zero node_modules); CI per-check table at the head (bounded polling; every failure classified vs CURRENT origin/main — main-state residuals named, loops-caused MUST be green); diff gate (apps/loops + changeset only); secrets scan clean. Return (JSON): { suiteCounts: {passed, failed}, regressions: [{finding, rc}], frozenInstallRc, ciGreen, checks: [{name, conclusion, classification}], ciResiduals: [string], diffGatePass, secretsClean, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). One review at the new head: (a) all 5 terminated findings addressed at the owning surface (each named, red-before/green-after measured), (b) the successor is a NEW PR (not a recycled terminated candidate), (c) loops suite green + regressions pass (literal), (d) CI at the head green for the loops reason (or the exact named non-this-lane residual), (e) diff gate within scope, (f) mergeability vs CURRENT origin/main (merge-tree clean), (g) secrets clean. Post '[REVIEW] <GO|NO_GO> — loops-runner-episodes-r1 @ <sha> — lens: 5 terminated findings closed at the root, reviewer loops-runner-episodes-review' to #board. Block ONLY concrete P0/P1 defects. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: loops-runner-episodes-r1-land', record merged sha, LIVE-VERIFY the runner-episodes surface at the merged main tip (bounded), complete row ${ROW} with evidence and add a landing-evidence comment on feature row ${FEATURE_ROW} (already completed as superseded 12:49:26Z — comment only, never re-complete). If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, liveVerifyRc, rowState, featureRowState, residue: [] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { rowState: { type: 'string' }, findings: { type: 'array' }, filesToChange: { type: 'array' }, notChecked: { type: 'array' } }, required: ['rowState', 'findings'] }
const FIX_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, findingsClosed: { type: 'array' }, regressionsAdded: { type: 'array' }, diffStatSummary: { type: 'string' }, prNumber: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'prNumber'] }
const VERIFY_SCHEMA = { type: 'object', properties: { suiteCounts: { type: 'object' }, regressions: { type: 'array' }, frozenInstallRc: { type: 'number' }, ciGreen: { type: 'boolean' }, checks: { type: 'array' }, ciResiduals: { type: 'array' }, diffGatePass: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['suiteCounts', 'ciGreen', 'checks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, liveVerifyRc: { type: ['number', 'null'] }, rowState: { type: 'string' }, featureRowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'loops-episodes-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
// Gate on the STRUCTURED signal (findings read = idempotency passed), never on the
// investigate's free-text rowState — measured three different phrasings
// ('IDEMPOTENCY CLEAR', 'READY — idempotency verified', 'pending') across runs.
const fix = investigate && investigate.findingsCount > 0 && !String(investigate.rowState).startsWith('STOP')
  ? await agent(FIX, { label: 'loops-episodes-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' })
  : null

phase('Verify')
const verify = fix && fix.pushed ? await agent(VERIFY, { label: 'loops-episodes-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'loops-episodes-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'investigate/fix/verify did not complete', detail: JSON.stringify({ investigate, fix, verify }) }] }

phase('Land')
const land = review && review.verdict === 'GO'
  ? await agent(LAND, { label: 'loops-episodes-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, liveVerifyRc: null, rowState: 'pending', featureRowState: 'in_progress', residue: ['NO_GO — fix lane must remediate per findings (two-cycle cap)'] }

return { investigate: investigate && { findingsCount: investigate.findings.length, rowState: investigate.rowState }, fix: fix && { newHead: fix.newHead, prNumber: fix.prNumber, findingsClosed: fix.findingsClosed }, verify: verify && { suiteCounts: verify.suiteCounts, ciGreen: verify.ciGreen, ciResiduals: verify.ciResiduals }, review: review && review.verdict, land }
