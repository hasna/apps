export const meta = {
  name: 'canonical-312-remediation-1',
  description: 'Remediation cycle 1 for PR 312: apply the one-line :memory: fix at execution-workflow.test.ts:66, suite, focused re-review, merge',
  phases: [
    { title: 'Fix', detail: 'one-line fix: createSqliteDevStore({ path: \':memory:\' }) at line 66, suite, push' },
    { title: 'Review', detail: 'remediation-cycle-1 focused re-review by the same reviewer role' },
    { title: 'Merge', detail: 'merge on GO' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const TASK = '875c805e-e14e-4cf3-a942-75545406108f'

const CONST = `
You are a lane of the canonical-312-remediation-1 workflow (task ${TASK}). Remediation CYCLE 1 for PR #312 (banking canonical root) — the last open canonical-root PR (11/12 merged). The 312-closeout reviewer (canon-merge-312-review) confirmed one blocking P1: apps/banking/tests/execution-workflow.test.ts:66 calls createSqliteDevStore() bare, which under ambient HOME resolves to ~/.hasna/banking/banking.db and writes the real canonical dev store on every bun test run; the other 4 call sites in the file are pinned :memory:. The remedy is EXACTLY the reviewer's one line. Final text = machine-readable JSON.

Non-negotiable rules:
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull; never discard local work). Work in task worktree ~/.hasna/repos/worktrees/apps/canon-merge-312 from origin/main. Never push to main. Force-push (--force-with-lease) ONLY on the PR's own branch. Merge ONLY via gh pr merge 312 --squash --body-file <file whose LAST line is 'Agent: canon-merge-ship'>.
- IDEMPOTENCY CHECK FIRST: if #312 is already MERGED, skip everything (record merged). If line 66 already carries the :memory: pin at the PR head, skip the edit, verify, go to review.
- No secrets; no internal-infra strings. Staged secrets scan before commit/push. Capture path: redirect to files, never pipe large reads. Paste literal output lines.
- Record as you go: comments on ${TASK}, posts to #board. English. Lineage identity 'conversations agents register' named canon-merge-312-r1-<your-role>.
- Remediation scope discipline: fix ONLY the named P1 and its direct regressions. Do not re-litigate content, do not open new findings.
`

const FIX = CONST + `
ROLE: remediation fixer (Sonnet). IDEMPOTENCY CHECK FIRST (see CONST).
1. Resolve the PR's actual head branch: gh pr view 312 --repo hasna/apps --json headRefName,headRefOid,state.
2. Fetch: git -C ${MONOREPO} fetch origin pull/312/head:canon-312-r1; worktree ~/.hasna/repos/worktrees/apps/canon-merge-312; git checkout -B <ACTUAL headRefName> canon-312-r1.
3. Apply the ONE-LINE fix: apps/banking/tests/execution-workflow.test.ts:66 — bare createSqliteDevStore() becomes createSqliteDevStore({ path: ':memory:' }) — matching the other 4 call sites in the file. Nothing else.
4. Run the banking suite: bun test apps/banking (bounded 8 min) — record passed/failed. Verify NO file at ~/.hasna/banking/banking.db was created/modified by the run (ls -la the canonical path before and after; the fix is exactly about not writing the real store).
5. Secrets scan staged (rc 0). Commit (conventional, 'Agent: canon-merge-312-r1-fix' trailer LAST line), push --force-with-lease.
6. Verify merge-tree equality: TREE=$(git -C ${MONOREPO} merge-tree --write-tree origin/main <new-head>); git -C ${MONOREPO} diff --quiet <new-head> "$TREE" — must be EQUAL.
Return (JSON): { prs: [{number, newHead, fixed: bool, tests: {passed, failed}, canonicalStoreUntouched: bool, mergeTreeEqual: bool, secretsClean: bool}] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) — remediation cycle 1, same reviewer role as the 312-closeout pass. PRs: {PRS} (number + newHead). Scope is EXACTLY the named P1 and its direct regressions:
(a) line 66 now pins :memory: (createSqliteDevStore({ path: ':memory:' })) and no other call site changed;
(b) no other file changed beyond the one-line fix (diff vs the previous reviewed head 5f40b2b8 is exactly this line);
(c) merge result == head tree at CURRENT origin/main;
(d) the suite result records pass and the canonical store was not touched.
Post the verdict '[REVIEW] <GO|NO_GO> — hasna/apps#312 @ <sha> — lens: banking canonical-store test isolation, reviewer canon-merge-312-review'. Block ONLY the named P1 remaining or a direct regression of it. P2/P3 non-blocking (list as follow-ups).
Return (JSON): { prs: [{number, verdict: GO|NO_GO, findings: [{severity, title, detail}], mergeTreeEqual: bool}] }
`

const MERGE = CONST + `
ROLE: merge lane (Sonnet). {BATCH} (each: number). For EACH GO'd PR: (1) gh pr view 312 --json headRefOid == the reviewed sha; (2) merge-tree equality at CURRENT origin/main (re-measure; if main moved, verify the delta is disjoint from apps/banking and proceed); (3) gh pr merge 312 --squash --body-file <file ending 'Agent: canon-merge-ship'>; (4) record merged sha. NO_GO: comment findings, leave open.
Return (JSON): { prs: [{number, merged: bool, mergedSha: string|null, reason: string|null}] }
`

const FIX_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REVIEW_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const MERGE_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }

phase('Fix')
const fix = await agent(FIX, { label: '312-r1-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'sonnet' })
const fixed = (fix && fix.prs) ? fix.prs.map(p => ({ number: p.number, newHead: p.newHead })) : [{ number: 312, newHead: null }]

phase('Review')
const review = await agent(REVIEW.replace('{PRS}', JSON.stringify(fixed)), { label: '312-r1-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })

phase('Merge')
let merge = null
if (review) {
  const go = (review.prs || []).filter(p => p.verdict === 'GO').map(p => p.number)
  if (go.length) merge = await agent(MERGE.replace('{BATCH}', JSON.stringify(go)), { label: '312-r1-merge', phase: 'Merge', schema: MERGE_SCHEMA, model: 'sonnet' })
}

return { fix, review, merge }
