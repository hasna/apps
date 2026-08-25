export const meta = {
  name: 'apps-secrets-detector-fix',
  description: 'Row 2693dbc4: BUG @hasna/secrets — package_registry_token detector fires on env var NAME npm_lifecycle_event (false positive class). This lane: reproduce with a failing regression test first, fix the detector at root (value-shape requirement — values are npm_ + 20+ chars; names are not), verify suite + CI, one Fable review, PR, merge, complete the row.',
  phases: [
    { title: 'Investigate', detail: 'reproduce the false positive, name the root cause, TDD red' },
    { title: 'Fix', detail: 'smallest owned detector fix, suite green, push' },
    { title: 'Verify', detail: 'CI green at the new head + two-sided probes' },
    { title: 'Review', detail: 'one Fable adversarial review' },
    { title: 'Land', detail: 'base gate + merge + complete 2693dbc4' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PROJ = '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'

const CONST = `
You are the apps-secrets-detector-fix lane (owner-authorized; row 2693dbc4). Final text = machine-readable JSON.

Context (filed): BUG: @hasna/secrets — the package_registry_token detector fires on the env var NAME npm_lifecycle_event (a false positive class: a variable NAME that merely contains 'npm_' reads as a registry token). The fleet's own commit-gate history already established the value/name distinction: npm_ values are npm_ + 20+ chars, names are not (the scan widened to npm_[A-Za-z0-9]{20,} for exactly this reason). The secrets detector likely matches the bare name.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: confirm row 2693dbc4 is still pending and no live fixer exists (open PR on @hasna/secrets, in_progress fixer row); if already fixed or a lane is live, verify + stop. Confirm @hasna/secrets source lives in the apps monorepo at apps/secrets (repos repo --remote hasna/apps to resolve the checkout).
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} fetch origin main -q; never discard local work). File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/apps-secrets-detector-fix cut from origin/main. PR-first; never push to main. Commits end with 'Agent: apps-secrets-detector-fix-<role>' (the ONLY attribution line; never Co-Authored-By).
- REPRODUCE first (TDD): write the failing regression test that captures the false positive (scanning text containing 'npm_lifecycle_event' as a variable name must NOT fire; a real npm_ + 20+ char value MUST still fire — two-sided). Confirm it fails red with the literal output.
- FIX the smallest owned change in the secrets detector (package_registry_token): the detector must not fire on bare variable NAMES — require the value shape (npm_ + [A-Za-z0-9]{20,}) and/or exclude the '='-free bare-name context. Do not weaken the real npm_ value detection; both directions must hold.
- VERIFY: the two-sided probes pass at the head (known-positive npm_ value fires, known-negative npm_lifecycle_event name stays silent); the secrets suite green (literal counts, exit 0); CI per-check table at the new head (gh api actions/runs?head_sha=<sha> + per-job conclusions) — 5/5 green or exactly the RULING D loops class; 'bun install --frozen-lockfile' rc=0; secrets scan clean.
- REVIEW (one Fable adversarial reviewer): at the new head — (a) red-before/green-after measured for the false-positive regression, (b) real npm_ values still detected (positive control), (c) suite + CI green, (d) mergeability vs CURRENT origin/main (merge-tree), (e) secrets clean. Post '[REVIEW] <GO|NO_GO> — apps-secrets-detector @ <sha> — lens: detector false-positive remediation, reviewer apps-secrets-detector-fix-review' to #board.
- LAND: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: apps-secrets-detector-fix-land', record merged sha, complete row 2693dbc4 with the evidence.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on the PR and row 2693dbc4, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is ${PROJ}.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Locate the package_registry_token detector in apps/secrets, reproduce the false positive against 'npm_lifecycle_event' with the exact scan invocation (literal output), write the failing two-sided regression test (name must not fire; real value must fire), confirm red. Return (JSON): { detectorPath, reproOutput, redBefore: {nameFired, valueFired}, testPath, notChecked: [string] }
`

const FIX = CONST + `
ROLE: fix lane (Opus). At the head after investigate: apply the smallest owned fix (value-shape requirement for npm_ tokens; bare names excluded), suite green (literal counts, exit 0), both probes pass (name silent, value fires), frozen install rc=0, secrets scan clean, commit, push, open the PR. Return (JSON): { newHead, fixSummary, rootCause, probes: {nameSilent, valueFires}, suiteCounts: {passed, failed}, prNumber, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head: CI per-check table (gh api actions/runs?head_sha=<sha> + per-job conclusions) — 5/5 green or exactly the RULING D class; secrets suite green (literal counts, exit 0); two-sided probes re-run at the head; 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules); secrets scan clean. Return (JSON): { ciGreen, checks: [{name, conclusion}], suiteCounts: {passed, failed}, probesPass, installRc, secretsClean, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). One review at the new head: (a) the false-positive regression is red-before/green-after (measured, not skipped), (b) real npm_ values still detected (positive control on the exact scanner), (c) the fix is the smallest owned change (no broad detector rewrites), (d) suite + CI green at the head or exactly the RULING D class, (e) mergeability vs CURRENT origin/main, (f) secrets clean. Post '[REVIEW] <GO|NO_GO> — apps-secrets-detector @ <sha> — lens: detector false-positive remediation, reviewer apps-secrets-detector-fix-review' to #board. Block ONLY concrete P0/P1 defects. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: apps-secrets-detector-fix-land', record merged sha, complete row 2693dbc4 with the evidence. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, rowState, residue: [] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { detectorPath: { type: 'string' }, reproOutput: { type: 'string' }, redBefore: { type: 'object' }, testPath: { type: 'string' }, notChecked: { type: 'array' } }, required: ['detectorPath', 'redBefore'] }
const FIX_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, fixSummary: { type: 'string' }, rootCause: { type: 'string' }, probes: { type: 'object' }, suiteCounts: { type: 'object' }, prNumber: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'prNumber'] }
const VERIFY_SCHEMA = { type: 'object', properties: { ciGreen: { type: 'boolean' }, checks: { type: 'array' }, suiteCounts: { type: 'object' }, probesPass: { type: 'boolean' }, installRc: { type: 'number' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['ciGreen', 'checks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'secrets-fix-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
const fix = investigate ? await agent(FIX, { label: 'secrets-fix-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' }) : null

phase('Verify')
const verify = fix && fix.pushed ? await agent(VERIFY, { label: 'secrets-fix-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'secrets-fix-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'investigate/fix/verify did not complete', detail: JSON.stringify({ investigate, fix, verify }) }] }

phase('Land')
const land = review && review.verdict === 'GO'
  ? await agent(LAND, { label: 'secrets-fix-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, rowState: 'pending', residue: ['NO_GO — fix lane must remediate per findings'] }

return { investigate: investigate && { detectorPath: investigate.detectorPath, redBefore: investigate.redBefore }, fix: fix && { newHead: fix.newHead, prNumber: fix.prNumber, probes: fix.probes }, verify: verify && { ciGreen: verify.ciGreen, probesPass: verify.probesPass }, review: review && review.verdict, land }
