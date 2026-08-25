export const meta = {
  name: 'naming-fix-merge-r2',
  description: 'Final naming-lineage lane: rebase the 6 merge-gate-blocked PRs, complete 359\'s remediation, focused Fable re-review, merge all GO\'d',
  phases: [
    { title: 'Fix', detail: 'rebase 296/298/302/307/327/352 onto current main; complete 359\'s named smoke-script remediation' },
    { title: 'Review', detail: 'focused Fable re-review (merge-tree equality + own-files delta + 359\'s named lines)' },
    { title: 'Merge', detail: 'merge all GO\'d with attribution' },
    { title: 'Report', detail: 'final naming state + remaining follow-ups' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const TASK = '6d824d44-8047-4121-ace6-dc5bd1cc7819'

const CONST = `
You are a lane of the naming-fix-merge r2 workflow (task ${TASK}). FINAL lane of the naming lineage (initial review + remediation cycle 1 done). Remaining open PRs: 296 (logs), 298 (signatures), 302 (styles), 307 (context), 327 (contracts) — GO at exact head but blocked at the merge gate: origin/main advanced 45+ commits after branch cut, merge-tree != head (unreviewed-at-head, per the base-change rule). 352 (calendar) — same-file overlap: main landed in apps/calendar/src/cli/index.tsx, src/db/database.ts, src/db/database.test.ts which 352 also touches. 359 (knowledge) — remediation cycle 2: the cycle-1 fixer addressed only line 42 + the test assertion of named finding 4; the finding enumerated scripts/smoke-files-installed-boundary.mjs :43/:167/:170/:204/:237/:239 which STILL carry 'open-files' in user-visible output. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull; never discard local work). Work in task worktrees ~/.hasna/repos/worktrees/apps/naming-r2-<n> from origin/main. Never push to main. Force-push (--force-with-lease) ONLY on the PR's own branch. Merges ONLY via gh pr merge <n> --squash --body-file <file whose LAST line is 'Agent: naming-fix-ship'>.
- IDEMPOTENCY CHECK FIRST: skip any PR already MERGED (gh pr view --json state). If the branch already sits on an ancestor of origin/main with merge-tree equality, skip the rebase, go to review.
- No secrets: never print/capture/commit credential values; consume ONLY via 'secrets exec <key> --as VAR -- <cmd>'. No internal-infra strings. Staged secrets scan before every commit/push.
- Capture path: redirect to files, read both + $?; never pipe large reads. Paste literal output lines when reporting.
- Record as you go: comments on ${TASK}, posts to #board. English. Lineage identity 'conversations agents register' named naming-r2-<your-role>.
- Remediation discipline: fix ONLY the named defects and their direct regressions; do not re-litigate reviewed content.
`

const FIX = CONST + `
ROLE: remediation fixer (Sonnet). PRs: {PRS} (each: number). For EACH:
1. IDEMPOTENCY CHECK FIRST (see CONST). Resolve the actual head branch: gh pr view <n> --repo hasna/apps --json headRefName,headRefOid,state.
2. Fetch: git -C ${MONOREPO} fetch origin pull/<n>/head:naming-r2-<n>; worktree ~/.hasna/repos/worktrees/apps/naming-r2-<n>; git checkout -B <ACTUAL headRefName> naming-r2-<n>.
3a. FOR 296/298/302/307/327/352: rebase onto CURRENT origin/main (git rebase origin/main). Resolve ONLY unambiguous conflicts (single-sided deletions, non-overlapping hunks; for 352 the calendar files main changed — merge carefully, the PR's renames + main's changes must coexist); ambiguous -> ABORT + record (PR stays open with a comment).
3b. FOR 359 ONLY: also complete the named remediation — scripts/smoke-files-installed-boundary.mjs lines 43, 167, 170, 204, 237, 239 still carry 'open-files' in user-visible output/prose; rename to the bare 'files' form (matching the fixed line 42 and the test assertion). Fix the remaining named sites ONLY. P2/P3 items from the last review stay non-blocking follow-ups (do NOT open them).
4. Push: git push --force-with-lease origin HEAD:<branch>. Re-fetch the new head sha.
5. Verify merge-tree equality at CURRENT origin/main: TREE=$(git -C ${MONOREPO} merge-tree --write-tree origin/main <new-head>); git -C ${MONOREPO} diff --quiet <new-head> "$TREE" — must be EQUAL; if it differs, record which files differ (own-files differences are blockers for review).
6. Run the app's affected tests (bounded 8 min) + secrets scan the diff (rc 0 clean).
Return (JSON): { prs: [{number, newHead, rebased: bool, conflict: string|null, mergeTreeEqual: bool, tests: {passed, failed}, secretsClean: bool, note: string|null}] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Focused re-review — remediation cycle 1 (352) and cycle 2 (359) of the same lineage; the other five are merge-gate rebases of GO'd content. PRs: {PRS} (number + newHead). For EACH:
(a) merge result == rebased head tree at CURRENT origin/main (git merge-tree --write-tree origin/main <head> == head tree) — the gate that blocked before now passes;
(b) for 352: the combined apps/calendar files (the PR's renames + main's landed changes) are coherent — read the three files at the new head;
(c) for 359: the named lines (43/167/170/204/237/239) of scripts/smoke-files-installed-boundary.mjs no longer carry 'open-files' in user-visible output, and the test assertion matches;
(d) for the others: the delta vs the previously reviewed head is disjoint from the PR's own files;
(e) secrets scan clean on the delta.
DO NOT re-litigate content; DO NOT open new unrelated findings. Block ONLY: equality still false, own-files delta, or the named 359 lines remaining.
Post per-PR verdicts as PR comments, first line '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: naming merge-gate re-review, reviewer naming-r2-review ({I} of 2)'.
Return (JSON): { prs: [{number, verdict: GO|NO_GO, findings: [{severity, title, detail}], mergeTreeEqual: bool}] }
`

const MERGE = CONST + `
ROLE: merge lane (Sonnet). Merge the GO'd PRs in your batch IMMEDIATELY: {BATCH} (each: number). For EACH: (1) gh pr view <n> --json headRefOid == the reviewed sha; (2) merge-tree equality at CURRENT origin/main (re-measure; if main moved again, verify the delta is disjoint from the PR's files, then proceed); (3) gh pr merge <n> --squash --body-file <file ending 'Agent: naming-fix-ship'>; (4) record merged sha. NO_GO: comment findings, leave open.
Return (JSON): { prs: [{number, merged: bool, mergedSha: string|null, reason: string|null}] }
`

const REPORT = CONST + `
ROLE: report. Final naming-lineage state: per-PR (merged/open+reason), the 359 cycle-2 outcome, remaining follow-ups (the two OWNER DECISIONS already surfaced — router 'open-router' bin alias, markdown OMP spec name; the OPEN_DATASETS_* env var keep decision from #292; the knowledge 'not-a-real-secret' sentinel). Comment final state on ${TASK}, post summary to #board.
Return (JSON): { prs: [{number, state, mergedSha}], followUps: [string] }
Lanes: {LANES}
`

const FIX_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REVIEW_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object', properties: { number: { type: 'integer' }, verdict: { type: 'string' }, findings: { type: 'array' }, mergeTreeEqual: { type: 'boolean' } }, required: ['number', 'verdict'] } } }, required: ['prs'] }
const MERGE_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REPORT_SCHEMA = { type: 'object', properties: { prs: { type: 'array' }, followUps: { type: 'array', items: { type: 'string' } } }, required: ['prs'] }

const BATCHES = [
  [296, 298, 302],
  [307, 327, 352],
  [359],
]

phase('Naming r2')
const out = await pipeline(
  BATCHES,
  (batch) => agent(FIX.replace('{PRS}', JSON.stringify(batch)), { label: 'naming-r2-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'sonnet' }),
  (fix, batch) => {
    const prs = (fix && fix.prs) ? fix.prs.map(p => ({ number: p.number, newHead: p.newHead })) : batch.map(n => ({ number: n, newHead: null }))
    return agent(REVIEW.replace('{PRS}', JSON.stringify(prs)).replace('{I}', String(BATCHES.indexOf(batch) + 1)), { label: 'naming-r2-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  },
  (review, batch) => {
    const go = ((review && review.prs) || []).filter(p => p.verdict === 'GO').map(p => p.number)
    return agent(MERGE.replace('{BATCH}', JSON.stringify(go)), { label: 'naming-r2-merge', phase: 'Merge', schema: MERGE_SCHEMA, model: 'sonnet' })
  },
)

phase('Report')
const report = await agent(
  REPORT.replace('{LANES}', JSON.stringify(out.filter(Boolean))),
  { label: 'naming-r2-report', phase: 'Report', schema: REPORT_SCHEMA, model: 'sonnet' },
)

return { lanes: out.filter(Boolean), report }
