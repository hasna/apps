export const meta = {
  name: 'repo-hygiene-r3',
  description: 'PR #702 cycle-2 (FINAL remediation cycle): cycle-1 fixed the verify-generated P1 (now PASS at 45237a7be) but the re-review surfaced a direct regression of the prepack change — @hasna/conversations#test fails: "packaged local-read worker (regression 0ae63bc7) > npm pack ships the worker" with a JSON parse error. This lane: reproduce the failing test at the head, smallest owned fix (prepack/pack-artifact compatibility in apps/conversations), re-verify CI green, cycle-2 focused re-review, merge, complete f32c886e + e49a6f5a.',
  phases: [
    { title: 'Fix', detail: 'reproduce the conversations packaged-worker failure, smallest owned fix, push' },
    { title: 'Verify', detail: 'CI green at the new head' },
    { title: 'Review', detail: 'cycle-2 focused Fable re-review (named P1 + direct regressions)' },
    { title: 'Ship', detail: 'base gate + merge + complete both rows' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PROJ = '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'

const CONST = `
You are the repo-hygiene-r3 lane (owner-authorized, PR #702 cycle-2 FINAL remediation). Final text = machine-readable JSON.

Context (measured): PR hasna/apps#702 (root .editorconfig + prepack on 20 members; rows f32c886e + e49a6f5a). Cycle-1 (hygiene-r2) measured the verify-generated P1 as PR-introduced and fixed it (verify generated artifacts now PASS at head 45237a7be) — but the cycle-1 re-review returned NO_GO with a NEW P1 (a direct regression of the prepack change): CI run 32405349394 at head 45237a7be, build + test (affected) FAILURE on @hasna/conversations#test — job log literal: "(fail) packaged local-read worker (regression 0ae63bc7) > npm pack ships the worker [10378.49ms]" / "SyntaxError: JSON Parse error: Unexpected identifi...". The prepack additions changed what npm pack ships for conversations (the built output now lands in the pack), and the packaged-worker regression test (0ae63bc7) pins the packed-artifact shape — the JSON the test parses is now malformed.

THIS IS CYCLE 2 — the FINAL remediation cycle for #702. The cycle-1 verified surfaces (verify-generated PASS, gates, test-suites) must be preserved; the re-review is focused on the named P1 + direct regressions.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: confirm #702 is still OPEN (gh pr view 702; if merged while dispatching, verify + stop); read the cycle-1 review comment on #702 (exact text).
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} fetch origin main -q; never discard local work). File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/repo-hygiene-r3 cut from origin/main. Work on the PR's existing branch (fetch it; never a duplicate PR). Commits end with 'Agent: repo-hygiene-r3-<role>' (the ONLY attribution line; never Co-Authored-By).
- REPRODUCE first: run the failing conversations test at the head (the exact test command from the CI job log; paste the literal error). Name the root cause: how the prepack change altered the packed artifact and why the packaged-worker test's JSON parse breaks.
- FIX the smallest owned change in apps/conversations (the prepack script's interaction with the packaged worker — the pack must ship the built worker with the shape the 0ae63bc7 regression test pins, or the prepack must not corrupt the worker file the test parses). Do NOT weaken or skip the regression test — it is the acceptance surface. Keep the verify-generated fix and all other cycle-1 surfaces intact.
- VERIFY: CI per-check table at the new head (gh api actions/runs?head_sha=<sha> + per-job conclusions) — 5/5 green or exactly the RULING D class; the conversations suite green at the head (literal counts, exit 0); 'bun install --frozen-lockfile' rc=0 in the worktree; secrets scan clean.
- REVIEW (cycle-2 focused): re-review ONLY the named P1 (conversations packaged-worker at the new head) + direct regressions of the fix. Post '[REVIEW] <GO|NO_GO> — repo-hygiene @ <sha> — lens: prepack regression remediation, reviewer repo-hygiene-r3-review' to #board. Two remediation cycles max — this is cycle 2.
- SHIP: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge 702 --squash --body-file ending 'Agent: repo-hygiene-r3-ship', record merged sha, complete rows f32c886e + e49a6f5a with the evidence. If NO_GO: comment findings + resume condition, leave open (cycle cap reached — do not dispatch further remediation).
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on PR #702 and both rows, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is ${PROJ}.
`

const FIX = CONST + `
ROLE: fix lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Reproduce the conversations packaged-worker test failure at the head (literal error), name the root cause (prepack/pack-artifact interaction), apply the smallest owned fix in apps/conversations, suite green (literal counts), frozen install rc=0, secrets clean, commit, push. Return (JSON): { newHead, rootCause, fixSummary, redBefore: {failed, named}, suiteCounts: {passed, failed}, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head: CI per-check table (gh api actions/runs?head_sha=<sha> + per-job conclusions) — 5/5 green or exactly the RULING D class; conversations suite green (literal counts, exit 0); 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules); verify-generated still PASS; secrets scan clean. Return (JSON): { ciGreen, checks: [{name, conclusion}], conversationsSuite: {exit, passed, failed}, installRc, verifyGeneratedPass, secretsClean, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Cycle-2 focused re-review at the new head: (a) the conversations packaged-worker test passes at the head with the root cause fixed (not skipped, not weakened — red-before/green-after measured), (b) CI is 5/5 green or exactly the RULING D class, (c) verify-generated still PASS, (d) the prepack additions remain intact for the other 19 members, (e) mergeability at CURRENT origin/main, (f) secrets clean. Re-review ONLY the named P1 + direct regressions. Post '[REVIEW] <GO|NO_GO> — repo-hygiene @ <sha> — lens: prepack regression remediation, reviewer repo-hygiene-r3-review' to #board. Block ONLY concrete P0/P1 defects; this is cycle 2 — the final remediation cycle. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge 702 --squash --body-file ending 'Agent: repo-hygiene-r3-ship', record merged sha, complete rows f32c886e + e49a6f5a with the evidence. If NO_GO: comment findings + resume condition, leave open (cycle cap reached). Return (JSON): { merged, mergedSha, rowsCompleted: [string], residue: [] }
`

const FIX_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, rootCause: { type: 'string' }, fixSummary: { type: 'string' }, redBefore: { type: 'object' }, suiteCounts: { type: 'object' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'rootCause', 'pushed'] }
const VERIFY_SCHEMA = { type: 'object', properties: { ciGreen: { type: 'boolean' }, checks: { type: 'array' }, conversationsSuite: { type: 'object' }, installRc: { type: 'number' }, verifyGeneratedPass: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['ciGreen', 'checks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowsCompleted: { type: 'array' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Fix')
const fix = await agent(FIX, { label: 'hygiene-r3-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' })

phase('Verify')
const verify = fix && fix.pushed ? await agent(VERIFY, { label: 'hygiene-r3-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'hygiene-r3-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'fix/verify did not complete', detail: JSON.stringify({ fix, verify }) }] }

phase('Ship')
const ship = review && review.verdict === 'GO'
  ? await agent(SHIP, { label: 'hygiene-r3-ship', phase: 'Ship', schema: SHIP_SCHEMA })
  : { merged: false, mergedSha: null, rowsCompleted: [], residue: ['NO_GO — cycle cap reached; candidate terminated'] }

return { fix: fix && { newHead: fix.newHead, rootCause: fix.rootCause }, verify: verify && { ciGreen: verify.ciGreen, conversationsSuite: verify.conversationsSuite }, review: review && review.verdict, ship }
