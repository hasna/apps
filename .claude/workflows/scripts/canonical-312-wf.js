export const meta = {
  name: 'canonical-312-closeout',
  description: 'Rebase PR 312 (banking canonical root) onto current main, focused Fable re-review of the banking test-file combination with #380, merge',
  phases: [
    { title: 'Rebase', detail: 'rebase #312 onto current origin/main, verify merge-tree equality' },
    { title: 'Review', detail: 'Fable delta re-review: the #380 + #312 banking test-file combination' },
    { title: 'Merge', detail: 'merge on GO' },
    { title: 'Report', detail: 'final state + follow-ups' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const TASK = '875c805e-e14e-4cf3-a942-75545406108f'

const CONST = `
You are a lane of the canonical-312-closeout workflow (owner-authorized 2026-08-18, task ${TASK}). This closes the single remaining canonical-root PR: #312 (apps/banking canonical data root). The r2 lineage merged the other 11 (315-362); #312 was correctly refused because main's #380 also modified apps/banking/tests/execution-workflow.test.ts, so a squash would land a line-level combination nobody read. #380 is now merged; this pass rebases #312 onto current main, has a Fable reviewer read the COMBINED banking test file, and merges on GO. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first: git -C ${MONOREPO} pull (fast-forward; never discard local work). Work in task worktree ~/.hasna/repos/worktrees/apps/canon-merge-312 from origin/main. Never push to main. Force-push (--force-with-lease) ONLY on the PR's own branch. Merge ONLY via gh pr merge 312 --squash --body-file <file whose LAST line is 'Agent: canon-merge-ship'>.
- IDEMPOTENCY CHECK FIRST: gh pr view 312 --json state — if MERGED, skip everything (record merged).
- No secrets: never print/capture/commit credential values; consume ONLY via 'secrets exec <key> --as VAR -- <cmd>'. No internal-infra strings in artifacts. Staged secrets scan before every commit/push.
- Capture path: redirect to files, read both + $?; never pipe large reads. Paste literal output lines when reporting.
- Record as you go: comments on ${TASK}, posts to #board. English. Lineage identity 'conversations agents register' named canon-merge-312-<your-role>.
- Distinguish measured vs inferred; state what you did not check. Plain register.
`

const REBASE = CONST + `
ROLE: rebase lane (Sonnet). IDEMPOTENCY CHECK FIRST (see CONST).
1. Resolve the PR's ACTUAL head branch: gh pr view 312 --repo hasna/apps --json headRefName,headRefOid,state.
2. Fetch: git -C ${MONOREPO} fetch origin pull/312/head:canon-312; worktree ~/.hasna/repos/worktrees/apps/canon-merge-312; git checkout -B <ACTUAL headRefName> canon-312.
3. Rebase onto CURRENT origin/main: git rebase origin/main. Resolve ONLY unambiguous conflicts; ambiguous -> ABORT + record (PR stays open with a comment).
4. Push: git push --force-with-lease origin HEAD:<branch>. Re-fetch the new head sha.
5. Verify merge-tree equality: TREE=$(git -C ${MONOREPO} merge-tree --write-tree origin/main <new-head>); git -C ${MONOREPO} diff --quiet <new-head> "$TREE" — must be EQUAL.
6. Run the banking tests (bounded 8 min): bun test apps/banking — record passed/failed. Secrets scan the diff (rc 0 clean).
Return (JSON): { prs: [{number, newHead, rebased: bool, conflict: string|null, mergeTreeEqual: bool, tests: {passed, failed}, secretsClean: bool}] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Focused delta re-review of the rebased #312 head {PRS} (number + newHead). The r2 lineage already reviewed #312's substance at earlier heads (canonical-root fix intact, tests green); the ONLY open question is the banking test file: #380 (merged) and #312 both touch apps/banking/tests/execution-workflow.test.ts, and the r2 merge lane refused because the combination had not been read. Verify at the new head:
(a) merge result == rebased head tree at CURRENT origin/main (git merge-tree --write-tree origin/main <head> == head tree);
(b) READ apps/banking/tests/execution-workflow.test.ts at the new head in full: the combined #380+#312 content is coherent — the canonical-root assertions (#312) and the execution-workflow assertions (#380) coexist, no duplicated/deleted/mutually-contradictory tests, no test that passes only by accident of the combination;
(c) the canonical-root fix intact (default resolves to ~/.hasna/banking; HASNA_BANKING_HOME override wins; migration mkdir-only, never deletes, never overwrites);
(d) secrets scan clean on the delta vs the previously reviewed head.
Post the verdict as a PR comment, first line '[REVIEW] <GO|NO_GO> — hasna/apps#312 @ <sha> — lens: banking test-file combination, reviewer canon-merge-312-review'. Block ONLY concrete P0/P1 defects. P2/P3 non-blocking (list as follow-ups).
Return (JSON): { prs: [{number, verdict: GO|NO_GO, findings: [{severity, title, detail}], mergeTreeEqual: bool}] }
`

const MERGE = CONST + `
ROLE: merge lane (Sonnet). {BATCH} (each: number). For EACH GO'd PR: (1) gh pr view 312 --json headRefOid == the reviewed sha; (2) merge-tree equality at CURRENT origin/main (re-measure; if main moved again, verify the delta is disjoint from apps/banking and proceed); (3) gh pr merge 312 --squash --body-file <file ending 'Agent: canon-merge-ship'>; (4) record merged sha. NO_GO: comment findings, leave open.
Return (JSON): { prs: [{number, merged: bool, mergedSha: string|null, reason: string|null}] }
`

const REPORT = CONST + `
ROLE: report. Final state for #312 (merged or open with reason), follow-ups (any remaining P2/P3 on the banking lane). Comment final state on ${TASK}, post one line to #board.
Return (JSON): { prs: [{number, state, mergedSha}], followUps: [string] }
`

const REBASE_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REVIEW_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object', properties: { number: { type: 'integer' }, verdict: { type: 'string' }, findings: { type: 'array' }, mergeTreeEqual: { type: 'boolean' } }, required: ['number', 'verdict'] } } }, required: ['prs'] }
const MERGE_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REPORT_SCHEMA = { type: 'object', properties: { prs: { type: 'array' }, followUps: { type: 'array', items: { type: 'string' } } }, required: ['prs'] }

phase('312 closeout')
const out = await pipeline(
  [[312]],
  (batch) => agent(REBASE, { label: '312-rebase', phase: 'Rebase', schema: REBASE_SCHEMA, model: 'sonnet' }),
  (rebase) => {
    const prs = (rebase && rebase.prs) ? rebase.prs : [{ number: 312, newHead: null }]
    return agent(REVIEW.replace('{PRS}', JSON.stringify(prs)), { label: '312-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  },
  (review) => {
    const go = ((review && review.prs) || []).filter(p => p.verdict === 'GO').map(p => p.number)
    return agent(MERGE.replace('{BATCH}', JSON.stringify(go)), { label: '312-merge', phase: 'Merge', schema: MERGE_SCHEMA, model: 'sonnet' })
  },
)

phase('Report')
const report = await agent(REPORT, { label: '312-report', phase: 'Report', schema: REPORT_SCHEMA, model: 'sonnet' })
return { lanes: out.filter(Boolean), report }
