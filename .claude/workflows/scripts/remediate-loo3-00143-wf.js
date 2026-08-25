export const meta = {
  name: 'remediate-loo3-00143',
  description: 'Remediate PR #1046 (LOO3-00143 loops runs --json pagination envelope): fix the cycle-1 P1 — count/has_more computed from the UNFILTERED global run count (countRuns ignores loopId/labels), so filtered pagination never terminates. Fix countRuns to accept the same filters as listRuns, recompute has_more from the filtered population, re-review, merge.',
  phases: [
    { title: 'Remediate' },
    { title: 'ReReview' },
  ],
}

const REMEDIATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['pushed', 'gatesRc'],
  properties: {
    pushed: { type: 'boolean' },
    gatesRc: { type: 'integer' },
    fixes: { type: 'array', items: { type: 'string' } },
    newHead: { type: 'string' },
  },
}

const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'findings'],
  properties: {
    verdict: { enum: ['GO', 'NO_GO'] },
    findings: { type: 'array', items: { type: 'string' } },
  },
}

phase('Remediate')
const remediate = await agent(`Remediate hasna/apps PR #1046 (task LOO3-00143, branch LOO3-00143, 'fix(loops): loops runs --json emits a pagination envelope and gains --offset'). The cycle-1 review returned NO_GO with one P1:

P1: the new --json envelope's count/has_more/next_offset are computed from the UNFILTERED global run count, not the filtered population. CLI (apps/loops/src/cli/index.ts:2086-2095) calls store.listRuns({loopId, labels, limit, offset}) then store.countRuns() with NO filters; countRuns(status?) in the sqlite store (apps/loops/src/lib/store.ts:5761 SELECT COUNT(*) FROM loop_runs) and in ApiStore (/v1/runs/count, status-only) both ignore loopId/labels. Measured repro on the PR head: loop B has 5 runs, DB has 1015 total; page1 {"runs":5,"count":1015,"has_more":true,"next_offset":5}; page2 {"runs":0,"count":1015,"has_more":true,"next_offset":5} — has_more stays true forever after the filtered set is exhausted.

THE FIX (the review's own direction — apply it exactly): countRuns must accept and apply the SAME loopId/labels/status filters as listRuns (both sqlite store and ApiStore /v1/runs/count), and the CLI must pass them. has_more = offset + runs.length < filteredCount. next_offset only advances while has_more.

WORK (in the existing worktree for branch LOO3-00143, or a fresh one at ~/.hasna/repos/worktrees/apps/LOO3-00143):
1. Fetch the PR branch; implement the P1 fix: filter countRuns in BOTH the sqlite store and the ApiStore route (add loopId/labels query params to /v1/runs/count), and pass the CLI's filters to countRuns. Compute has_more = offset + runs.length < filteredCount.
2. Regression first: add/extend tests proving the filtered count is correct — the exact repro (loop B with 5 runs in a 1015-run DB: page1 count==5 has_more true next_offset 5; page2 runs==0 has_more FALSE) must hold. Confirm the test fails pre-fix and passes post-fix.
3. Re-run: apps/loops suite, bun run check at repo root, secrets scan staged rc=0 with real bytes.
4. Commit (message: 'fix(loops): filter countRuns for pagination envelope — has_more reflects the filtered population (LOO3-00143 P1)' + 'Agent: fix-lane-LOO3-00143' trailer), push to the PR branch.
5. Comment the todos row LOO3-00143 with the remediation.

Return the schema: pushed (true), gatesRc (0 = all gates pass), fixes (list), newHead.`, { label: 'remediate', phase: 'Remediate', schema: REMEDIATE_SCHEMA })

phase('ReReview')
const review = await agent(`Focused re-review of hasna/apps PR #1046 (LOO3-00143) after P1 remediation — SAME reviewer lineage, verification of the named P1 fix only (this is remediation cycle 1).

PR #1046 head after remediation: ${remediate ? remediate.newHead : 'unknown'}.

Verify:
1. countRuns (sqlite store + ApiStore /v1/runs/count) now accepts and applies loopId/labels/status filters identical to listRuns; the CLI passes its filters to countRuns.
2. has_more = offset + runs.length < filteredCount; next_offset does not advance past the filtered end. The exact repro holds: filtered set of 5 in a 1015-run DB — page1 count==5 has_more true, final page has_more FALSE (no never-terminating pagination).
3. The remediation delta is limited to the count-filtering change + its tests; the envelope shape change (bare array -> object) stays as the intended, recorded breaking change (P2 from cycle-1).
4. Base movement: TREE=$(git merge-tree --write-tree origin/main <head>); git diff --quiet <head> "$TREE" — only main-side files disjoint from the PR's files.
5. CI at the new head green for the affected lanes (apps/loops suite).

Return GO if all hold, else NO_GO with exact evidence. This is remediation cycle 1 — a further NO_GO is the second cycle, and a third terminates the candidate.`, { label: 're-review', phase: 'ReReview', schema: REVIEW_SCHEMA })

return { status: review && review.verdict === 'GO' ? 'remediate-loo3-00143-ready' : 'remediate-loo3-00143-no-go', remediate, review }
