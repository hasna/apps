export const meta = {
  name: 'canonical-fix-merge-r2',
  description: 'Remediation cycle 1 for the 12 canonical-root PRs: rebase onto current main, delta-only Fable re-review, immediate per-batch merge',
  phases: [
    { title: 'Rebase', detail: 'per-batch: rebase onto current origin/main, force-push, verify merge-tree equality' },
    { title: 'Review', detail: 'delta-only Fable re-review (named defect: base movement; no re-litigation)' },
    { title: 'Merge', detail: 'immediate merge of GO\'d PRs with attribution' },
    { title: 'Report', detail: 'per-PR state + follow-ups' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const TASK = '875c805e-e14e-4cf3-a942-75545406108f'

const CONST = `
You are a lane of the canonical-fix-merge r2 workflow (owner-authorized 2026-08-18, task ${TASK}). This is REMEDIATION CYCLE 1 of the same lineage as wf_fb58d55b-e6b. The 12 canonical-root PRs (312, 315, 316, 318, 319, 321, 325, 326, 328, 335, 338, 362) were rebased and reviewed at heads that main then overtook (releases #374, #378, #379 landed mid-run) — every reviewed head is unreviewed-at-head for the SAME reason: base movement, not content. The r1 reviewers verified each PR's substance is correct and passing (fix intact, tests green, secrets clean, delta confined to the app dir) — the ONLY named defect is the stale base. This pass: rebase onto CURRENT origin/main, DELTA-ONLY re-review, and merge immediately. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first: git -C ${MONOREPO} pull (fast-forward; never discard local work). Work in task worktrees ~/.hasna/repos/worktrees/apps/canon-merge-<n> from origin/main. Never push to main. Force-push (--force-with-lease) ONLY on the PR's own branch. Merges ONLY via gh pr merge <n> --squash --body-file <file whose LAST line is 'Agent: canon-merge-<your-role>'>.
- IDEMPOTENCY CHECK FIRST: for each PR, gh pr view <n> --json state,mergedAt — if MERGED, skip (record merged). If the branch already sits on an ancestor of origin/main (git merge-base --is-ancestor <head> origin/main passes) and merge-tree equality holds, skip the rebase and go straight to review/merge.
- No secrets: never print/capture/commit credential values; consume ONLY via 'secrets exec <key> --as VAR -- <cmd>'. No internal-infra strings in artifacts. Staged secrets scan before every commit/push.
- Capture path: redirect to files, read both + $?; never pipe large reads. Paste literal output lines when reporting.
- Record as you go: comments on ${TASK}, mementos for non-obvious findings, posts to #board. English. Lineage identity 'conversations agents register' named canon-merge-<your-role>.
- Distinguish measured vs inferred; state what you did not check. Plain register.
`

const REBASE = CONST + `
ROLE: rebase lane (Sonnet). Your PRs: {BATCH} (each: number). For EACH PR (IDEMPOTENCY CHECK FIRST):
1. Resolve the PR's ACTUAL head branch: gh pr view <n> --repo hasna/apps --json headRefName,headRefOid,state (projected fields only). Skip if merged.
2. Fetch: git -C ${MONOREPO} fetch origin pull/<n>/head:canon-<n>; worktree ~/.hasna/repos/worktrees/apps/canon-merge-<n>; git checkout -B <ACTUAL headRefName> canon-<n>.
3. Rebase onto CURRENT origin/main: git rebase origin/main. Conflicts: resolve ONLY unambiguous (single-sided deletions, non-overlapping hunks); ambiguous -> ABORT + record (PR stays open with a comment). #328: re-apply the one-line 'hosted' reword if the rebase dropped it (it trips the no-cloud-boundary scan).
4. Push: git push --force-with-lease origin HEAD:<branch>. Re-fetch the new head sha.
5. Verify merge-tree equality at CURRENT origin/main: TREE=$(git -C ${MONOREPO} merge-tree --write-tree origin/main <new-head>); git -C ${MONOREPO} diff --quiet <new-head> "$TREE" — must be EQUAL; if it differs, record why (which files differ).
6. Run the app's affected tests (bounded 8 min) + secrets scan the diff (redirect + 'secrets scan input' — rc 0 clean; a pre-existing synthetic fixture finding in hunk context is a non-blocking follow-up, not a blocker).
Return (JSON): { prs: [{number, newHead, rebased: bool, conflict: string|null, mergeTreeEqual: bool, tests: {passed, failed}, secretsClean: bool}] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). DELTA-ONLY focused re-review — remediation cycle 1 of the r1 review (same lineage). Your PRs: {PRS} (each: number + newHead). The r1 reviewer already verified each PR's substance (canonical-root fix intact, tests green, secrets clean, app-confined delta). Your scope is EXACTLY the named defect and its direct consequence: the base moved. For EACH PR verify:
(a) merge result == rebased head tree at CURRENT origin/main (git merge-tree --write-tree origin/main <head> == head tree) — the gate that failed before now passes;
(b) the delta vs the r1-reviewed head is disjoint from the PR's own files (release bumps / other apps' changes only) — if the PR's OWN files changed beyond the r1 review, flag it;
(c) the canonical-root fix is still intact at the new head (grep the app's default-path line: default resolves to ~/.hasna/<app>/; env overrides still win);
(d) secrets scan clean on the delta.
DO NOT re-litigate the content. DO NOT open new unrelated findings — a P2/P3 from r1 that was already recorded as a follow-up (e.g. the synthetic fixture sentinel at tests/cli.test.ts:391) is NOT reopened. Block ONLY: equality still false, or the PR's own files changed beyond r1.
Post per-PR verdicts as PR comments, first line '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: canonical-root delta re-review, reviewer canon-merge-review-r2 ({I} of 4)'.
Return (JSON): { prs: [{number, verdict: GO|NO_GO, findings: [{severity, title, detail}], mergeTreeEqual: bool}] }
`

const MERGE = CONST + `
ROLE: merge lane (Sonnet). Merge the GO'd PRs in your batch IMMEDIATELY — the window matters, main is moving. {BATCH} (each: number). For EACH: (1) gh pr view <n> --json headRefOid == the reviewed sha; (2) merge-tree equality at CURRENT origin/main (re-measure; if main moved again, the delta is release bumps only, re-verify it is disjoint from the PR's files, then proceed — do NOT bounce the PR back for a second rebase on a disjoint delta); (3) gh pr merge <n> --squash --body-file <file ending 'Agent: canon-merge-ship'>; (4) record the merged sha. NO_GO: comment findings, leave open.
Return (JSON): { prs: [{number, merged: bool, mergedSha: string|null, reason: string|null}] }
`

const REPORT = CONST + `
ROLE: report. Aggregate per-PR state (rebased/reviewed/merged/skipped) + follow-ups (PRs left open with reasons; the 362 fixture-sentinel follow-up; the 316 P3 lazy-default follow-up; pre-existing test failures on domains/bridge). Comment final state on ${TASK}, post summary to #board.
Return (JSON): { prs: [{number, state, mergedSha}], followUps: [string] }
Lanes: {LANES}
`

const REBASE_SCHEMA = {
  type: 'object',
  properties: { prs: { type: 'array', items: { type: 'object', properties: { number: { type: 'integer' }, newHead: { type: 'string' }, rebased: { type: 'boolean' }, conflict: { type: ['string', 'null'] }, mergeTreeEqual: { type: 'boolean' }, tests: { type: 'object' }, secretsClean: { type: 'boolean' } }, required: ['number', 'rebased'] } } },
  required: ['prs'],
}
const REVIEW_SCHEMA = {
  type: 'object',
  properties: { prs: { type: 'array', items: { type: 'object', properties: { number: { type: 'integer' }, verdict: { type: 'string' }, findings: { type: 'array', items: { type: 'object' } }, mergeTreeEqual: { type: 'boolean' } }, required: ['number', 'verdict'] } } },
  required: ['prs'],
}
const MERGE_SCHEMA = {
  type: 'object',
  properties: { prs: { type: 'array', items: { type: 'object', properties: { number: { type: 'integer' }, merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, reason: { type: ['string', 'null'] } }, required: ['number', 'merged'] } } },
  required: ['prs'],
}
const REPORT_SCHEMA = {
  type: 'object',
  properties: { prs: { type: 'array', items: { type: 'object' } }, followUps: { type: 'array', items: { type: 'string' } } },
  required: ['prs'],
}

const BATCHES = [
  [312, 315, 316],
  [318, 319, 321],
  [325, 326, 328],
  [335, 338, 362],
]

phase('Canonical r2')
// per-batch pipeline: rebase -> delta review -> immediate merge, so each batch closes its window before the next finishes
const out = await pipeline(
  BATCHES,
  (batch) => agent(REBASE.replace('{BATCH}', JSON.stringify(batch)), { label: 'r2-rebase', phase: 'Rebase', schema: REBASE_SCHEMA, model: 'sonnet' }),
  (rebase, batch) => {
    const prs = (rebase && rebase.prs) ? rebase.prs.map(p => ({ number: p.number, newHead: p.newHead })) : batch.map(n => ({ number: n, newHead: null }))
    return agent(REVIEW.replace('{PRS}', JSON.stringify(prs)).replace('{I}', String(BATCHES.indexOf(batch) + 1)), { label: 'r2-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  },
  (review, batch) => {
    const go = ((review && review.prs) || []).filter(p => p.verdict === 'GO').map(p => p.number)
    return agent(MERGE.replace('{BATCH}', JSON.stringify(go)), { label: 'r2-merge', phase: 'Merge', schema: MERGE_SCHEMA, model: 'sonnet' })
  },
)

phase('Report')
const report = await agent(
  REPORT.replace('{LANES}', JSON.stringify(out.filter(Boolean))),
  { label: 'r2-report', phase: 'Report', schema: REPORT_SCHEMA, model: 'sonnet' },
)

return { lanes: out.filter(Boolean), report }
