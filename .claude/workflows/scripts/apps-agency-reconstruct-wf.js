export const meta = {
  name: 'apps-agency-reconstruct-r2',
  description: 'Cycle-1 remediation of PR #704 (agency reconstruction, row 91a7b09d): review NO_GO — P0 CI build+test FAILURE at c573f7d0 (parity suite times out at the 5000ms bun-test default; status --installed SyntaxError), P1 base moved to 1da0550b (#701) so a rebase is required, P2 the db-module premise did not reproduce (template strings, not live imports). This lane: rebase onto current main, fix the parity-suite CI failures (bounded timeouts, smallest owned), re-verify CI green, cycle-1 focused re-review, base gate, merge, complete 91a7b09d.',
  phases: [
    { title: 'Rebase', detail: 'rebase #704 onto current main, resolve, re-push' },
    { title: 'Fix', detail: 'parity-suite CI failures (bounded timeouts + SyntaxError) — smallest owned fix' },
    { title: 'Verify', detail: 'CI green at the new head + parity re-run' },
    { title: 'Review', detail: 'cycle-1 focused Fable re-review (named P0/P1 + direct regressions)' },
    { title: 'Land', detail: 'base gate + merge + complete 91a7b09d' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PROJ = '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'

const CONST = `
You are the apps-agency-reconstruct-r2 lane (owner-authorized, cycle-1 remediation of PR #704). Final text = machine-readable JSON.

Context (measured, review on #704): PR hasna/apps#704 reconstructs @hasna/agency source into apps/agency (parity verified locally: version 0.3.1, help equal, status table). Review NO_GO with: P0 — CI 'build + test (affected)' FAILURE at head c573f7d0 (run 32402573104): the PR's own parity suite fails deterministically in CI — (1) 'status --filter todos --json returns the todos row with the expected shape [7509.29ms]' timed out after the 5000ms bun-test default; (2) 'status --installed --json is an array [37802.25ms]' raised SyntaxError. P1 — base-movement: origin/main advanced to 1da0550b0 (fix(contracts): transport selection is explicit config, #701) after the PR was cut from 36f77170; merge-tree differs at current main — rebase required. P2 (non-blocking, record honestly) — the investigation's 'ERR_MODULE_NOT_FOUND by construction' mechanism did NOT reproduce: the ../db/database.js refs sit inside scaffold-template generator strings (new command), not live imports; both bundles are self-contained single files and run rc=0.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: confirm #704 is still OPEN (gh pr view 704; if merged while dispatching, verify + stop); read the NO_GO review comment on #704 (exact text).
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} fetch origin main -q; never discard local work). File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/apps-agency-reconstruct-r2 cut from origin/main. Work on the PR's existing branch (fetch it; never a duplicate PR). Commits end with 'Agent: apps-agency-reconstruct-r2-<role>' (the ONLY attribution line; never Co-Authored-By).
- REBASE onto current origin/main (1da0550b + anything newer): resolve conflicts keeping the reconstruction's source shape + parity surface; re-push.
- FIX the parity-suite CI failures with the smallest owned change: bounded per-test timeouts (bun test --timeout <n> or per-test timeout — the 5000ms default is too tight for status-table enumeration in CI; measure the real durations in the CI environment and set a bound that passes with headroom, never a silent skip), and fix the 'status --installed is an array' SyntaxError at its root (paste the literal error; name the cause). Do NOT weaken the parity assertions — they are the acceptance surface.
- P2 honesty: record on the PR + row 91a7b09d that the db-module premise did not reproduce (template strings, self-contained bundles); keep the reconstructed module only if it is part of the source shape with no dead-code cost — decide with evidence, and say what you decided and why.
- VERIFY: CI per-check table at the new head (gh api actions/runs?head_sha=<sha> + per-job conclusions) — 5/5 green or the exact RULING D class; local parity re-run (version/help/status table) with literal outputs; 'bun install --frozen-lockfile' rc=0 in the worktree; secrets scan clean.
- REVIEW (cycle-1 focused): re-review ONLY the named P0 (parity suite in CI at the new head), P1 (mergeability at current main) + direct regressions. Post '[REVIEW] <GO|NO_GO> — apps-agency-reconstruct @ <sha> — lens: reconstruction cycle-1 remediation, reviewer apps-agency-reconstruct-r2-review' to #board. Two remediation cycles max.
- LAND: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge 704 --squash --body-file ending 'Agent: apps-agency-reconstruct-r2-land', record merged sha, complete row 91a7b09d with the evidence. If NO_GO: comment findings + resume condition, leave open.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on PR #704 and row 91a7b09d, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is ${PROJ}.
`

const REBASE = CONST + `
ROLE: rebase+fix lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Rebase #704 onto current origin/main (resolve conflicts, keep reconstruction shape + parity surface). Then fix the parity-suite CI failures: reproduce the two failing tests locally (literal errors), add bounded timeouts with measured headroom, fix the status --installed SyntaxError at root. Record the P2 honestly on the PR. Push. Return (JSON): { newHead, conflicts: [{file, resolution}], parityFixes: [{test, cause, fix}], p2Decision, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head: CI per-check table (gh api actions/runs?head_sha=<sha> + per-job conclusions) — 5/5 green or exactly the RULING D class; local parity re-run (version == 0.3.1, help surface equal, status table) with literal outputs; 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules); secrets scan clean. Return (JSON): { ciGreen, checks: [{name, conclusion}], parity: {version, helpEqual, statusTable}, installRc, secretsClean, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Cycle-1 focused re-review at the new head: (a) the parity suite passes in CI with bounded timeouts (measured durations, no silent skips, no weakened assertions), (b) the status --installed SyntaxError is fixed at root, (c) mergeability at CURRENT origin/main (merge-tree clean), (d) parity surface intact (version/help/status), (e) the P2 is recorded honestly on the PR + row (db-module premise did not reproduce), (f) CI green at the head or exactly the RULING D class, (g) secrets clean. Re-review ONLY the named P0/P1 + direct regressions. Post '[REVIEW] <GO|NO_GO> — apps-agency-reconstruct @ <sha> — lens: reconstruction cycle-1 remediation, reviewer apps-agency-reconstruct-r2-review' to #board. Block ONLY concrete P0/P1 defects; two remediation cycles max. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge 704 --squash --body-file ending 'Agent: apps-agency-reconstruct-r2-land', record merged sha, complete row 91a7b09d with the evidence (merged sha, parity, review verdict, P2 record). If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, rowState, residue: [] }
`

const REBASE_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, conflicts: { type: 'array' }, parityFixes: { type: 'array' }, p2Decision: { type: 'string' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed'] }
const VERIFY_SCHEMA = { type: 'object', properties: { ciGreen: { type: 'boolean' }, checks: { type: 'array' }, parity: { type: 'object' }, installRc: { type: 'number' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['ciGreen', 'checks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Rebase')
const rebase = await agent(REBASE, { label: 'agency-r2-rebase', phase: 'Rebase', schema: REBASE_SCHEMA, model: 'opus' })

phase('Verify')
const verify = rebase && rebase.pushed ? await agent(VERIFY, { label: 'agency-r2-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'agency-r2-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'rebase/verify did not complete', detail: JSON.stringify({ rebase, verify }) }] }

phase('Land')
const land = review && review.verdict === 'GO'
  ? await agent(LAND, { label: 'agency-r2-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, rowState: 'pending', residue: ['NO_GO — rebase lane must remediate per findings'] }

return { rebase: rebase && { newHead: rebase.newHead, parityFixes: rebase.parityFixes }, verify: verify && { ciGreen: verify.ciGreen, parity: verify.parity }, review: review && review.verdict, land }
