export const meta = {
  name: 'repo-hygiene-r2',
  description: 'PR #702 (repo hygiene: root .editorconfig + prepack on 20 members, rows f32c886e + e49a6f5a) review returned NO_GO — P1: "verify generated artifacts (byte-reproducible) FAILED at 911c098a". NOTE: the sibling #701 reviewer measured the SAME check as pre-existing on main (non-blocking). This lane: measure which it is (PR-side vs pre-existing on main) with evidence, remediate the smallest owned cause, re-verify CI, cycle-1 focused re-review, merge, complete both rows.',
  phases: [
    { title: 'Measure', detail: 'verify-generated failure at PR head vs at origin/main — PR-side or pre-existing?' },
    { title: 'Fix', detail: 'smallest owned remediation of the measured cause, re-push' },
    { title: 'Verify', detail: 'CI per-check at the new head' },
    { title: 'Review', detail: 'cycle-1 focused Fable re-review (named P1 + direct regressions)' },
    { title: 'Ship', detail: 'base gate + merge + complete f32c886e + e49a6f5a' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PROJ = '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'

const CONST = `
You are the repo-hygiene-r2 lane (owner-authorized, cycle-1 remediation of PR #702). Final text = machine-readable JSON.

Context (measured): PR hasna/apps#702 (root .editorconfig + prepack on 20 members, completing rows f32c886e + e49a6f5a; commit 911c098ac, rebased onto origin/main 36f771705) was reviewed NO_GO with P1: "CI not green at head sha — verify generated artifacts (byte-reproducible) FAILED at 911c098a". CRITICAL CONFLICT IN EVIDENCE: the sibling #701 reviewer (contracts-transport-mode) measured the SAME check "verify generated artifacts (byte-reproducible)" red at its head and classified it "pre-existing main-side, not caused by this PR" (P2, non-blocking). Per the bounded-review policy, pre-existing defects are non-blocking follow-ups. THIS LANE MUST MEASURE WHICH IT IS before fixing: does the verify-generated check fail at origin/main WITHOUT #702's changes, or is the failure PR-introduced?

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: confirm #702 is still OPEN (gh pr view 702; if it merged while dispatching, verify + stop); read the NO_GO review comment on #702 (the review's exact text) and the #701 review's P2 wording for the same check.
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} fetch origin main -q; never discard local work). File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/repo-hygiene-r2 cut from origin/main. Work on the PR's existing branch (fetch it; never a duplicate PR). Commits end with 'Agent: repo-hygiene-r2-<role>' (the ONLY attribution line; never Co-Authored-By).
- MEASURE (evidence, before any fix): reproduce the verify-generated check locally at (a) the PR head and (b) origin/main (the exact CI job command — read it from the workflow file that runs 'verify generated artifacts (byte-reproducible)'; run both with redirects; paste literal output). Classification: (1) fails at PR head AND at main -> pre-existing -> the P1 is misclassified; record the measurement on #702 and request the cycle-1 re-review classify it non-blocking per the policy; the PR's own changes need no fix for this check. (2) fails at PR head, passes at main -> PR-introduced -> find the smallest owned cause (likely the prepack additions changing packed/generated output the check compares) and fix it in the PR branch. Do NOT weaken or skip the check either way.
- VERIFY: CI per-check table at the new head (or unchanged head for case 1) — 5/5 green or the exact RULING D class; 'bun install --frozen-lockfile' rc=0 in the worktree; secrets scan clean; the PR's own content unchanged except the measured remediation.
- REVIEW (cycle-1 focused): re-review ONLY the named P1 (verify-generated state at the head, with the measurement evidence) + direct regressions. Post '[REVIEW] <GO|NO_GO> — repo-hygiene @ <sha> — lens: verify-generated remediation, reviewer repo-hygiene-r2-review' to #board. Two remediation cycles max.
- SHIP: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge 702 --squash --body-file ending 'Agent: repo-hygiene-r2-ship', record merged sha, complete rows f32c886e + e49a6f5a with the evidence. If NO_GO: comment findings + resume condition, leave open.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on PR #702 and both rows, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is ${PROJ}.
`

const MEASURE = CONST + `
ROLE: measure lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Reproduce the verify-generated check at the PR head AND at origin/main (exact CI job command read from the workflow file; redirects; literal output). Classify pre-existing vs PR-introduced with the evidence. If PR-introduced: name the smallest owned cause + fix. If pre-existing: no code change for this check — prepare the measurement for the re-review. Apply the fix to the PR branch if case 2; push. Return (JSON): { classification, evidence: {headOutcome, mainOutcome, command}, fixApplied, newHead, pushed, notChecked: [string] }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the PR head (newHead if pushed, else the existing head): CI per-check table (gh api actions/runs?head_sha=<sha> + per-job conclusions) — 5/5 green or exactly the RULING D class; fresh-checkout 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules); the PR's own content unchanged except the measured remediation (diff vs the pre-remediation head named); secrets scan clean. Return (JSON): { ciGreen, checks: [{name, conclusion}], installRc, diffVsPriorHead, secretsClean, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Cycle-1 focused re-review at the head: (a) the measurement evidence classifies the verify-generated failure (pre-existing on main vs PR-introduced) with literal outputs from BOTH runs, (b) if PR-introduced the smallest owned fix is applied and the check now passes at the head, (c) if pre-existing, the check's failure at main is recorded and the PR is not blamed for it (per the bounded-review policy), (d) the PR's own content is otherwise unchanged, (e) CI is green at the head or exactly the RULING D class, (f) secrets clean. Re-review ONLY the named P1 + direct regressions. Post '[REVIEW] <GO|NO_GO> — repo-hygiene @ <sha> — lens: verify-generated remediation, reviewer repo-hygiene-r2-review' to #board. Block ONLY concrete P0/P1 defects; two remediation cycles max. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge 702 --squash --body-file ending 'Agent: repo-hygiene-r2-ship', record merged sha, complete rows f32c886e + e49a6f5a with the evidence (merged sha, review verdict, classification). If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, rowsCompleted: [string], residue: [] }
`

const MEASURE_SCHEMA = { type: 'object', properties: { classification: { type: 'string' }, evidence: { type: 'object' }, fixApplied: { type: 'boolean' }, newHead: { type: ['string', 'null'] }, pushed: { type: 'boolean' }, notChecked: { type: 'array' } }, required: ['classification', 'evidence'] }
const VERIFY_SCHEMA = { type: 'object', properties: { ciGreen: { type: 'boolean' }, checks: { type: 'array' }, installRc: { type: 'number' }, diffVsPriorHead: { type: 'string' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['ciGreen', 'checks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowsCompleted: { type: 'array' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Measure')
const measure = await agent(MEASURE, { label: 'hygiene-r2-measure', phase: 'Measure', schema: MEASURE_SCHEMA, model: 'opus' })

phase('Verify')
const verify = measure ? await agent(VERIFY, { label: 'hygiene-r2-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'hygiene-r2-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'measure/verify did not complete', detail: JSON.stringify({ measure, verify }) }] }

phase('Ship')
const ship = review && review.verdict === 'GO'
  ? await agent(SHIP, { label: 'hygiene-r2-ship', phase: 'Ship', schema: SHIP_SCHEMA })
  : { merged: false, mergedSha: null, rowsCompleted: [], residue: ['NO_GO — measure lane must remediate per findings'] }

return { measure: measure && { classification: measure.classification, fixApplied: measure.fixApplied }, verify: verify && { ciGreen: verify.ciGreen }, review: review && review.verdict, ship }
