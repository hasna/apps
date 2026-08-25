export const meta = {
  name: 'naming-317-332-closeout',
  description: 'Close the last two naming display-name PRs: rebase 317 (recordings, merge-tree conflict) and 332 (notes, base movement), focused re-review, merge',
  phases: [
    { title: 'Rebase', detail: '317: rebase + resolve config.test.ts conflict; 332: rebase onto current main' },
    { title: 'Review', detail: 'focused Fable re-review of both merge results' },
    { title: 'Merge', detail: 'merge on GO' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const TASK = '6d824d44-8047-4121-ace6-dc5bd1cc7819'

const CONST = `
You are a lane of the naming-317-332-closeout workflow (task ${TASK}). The naming merge-gap run merged 35 of 37 display-name PRs. Two remain with real holds: #317 (recordings) — git merge-tree against origin/main CONFLICTS in apps/recordings/src/__tests__/config.test.ts (a file the PR modifies); #332 (notes) — main changed 43 apps/notes files since the branch cut, including apps/notes/README.md which the PR itself changes (merge result unreviewed at head). This lane: rebase both onto current main, resolve, focused Fable re-review of the merge results, merge on GO. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull; never discard local work). Work in task worktrees ~/.hasna/repos/worktrees/apps/naming-317-332 from origin/main. Never push to main. Force-push (--force-with-lease) ONLY on the PR's own branch. Merges ONLY via gh pr merge <n> --squash --body-file <file whose LAST line is 'Agent: naming-merge-gap'>.
- IDEMPOTENCY CHECK FIRST: skip any PR already MERGED.
- No secrets: never print/capture/commit credential values. No internal-infra strings. Staged secrets scan before every commit/push. Capture path: redirect to files, never pipe large reads. Paste literal output lines.
- Record as you go: comments on ${TASK}, posts to #board. English. Lineage identity 'conversations agents register' named naming-317-332.
- The changes are display-name only ('Hasna <Name>'); the rebase must not change that scope.
`

const REBASE = CONST + `
ROLE: rebase lane (Sonnet). PRs: {PRS} (numbers). For EACH:
1. IDEMPOTENCY CHECK FIRST (see CONST). Resolve the actual head branch: gh pr view <n> --repo hasna/apps --json headRefName,headRefOid,state.
2. Fetch: git -C ${MONOREPO} fetch origin pull/<n>/head:naming-<n>; worktree ~/.hasna/repos/worktrees/apps/naming-317-332; git checkout -B <ACTUAL headRefName> naming-<n>.
3. Rebase onto CURRENT origin/main (git rebase origin/main). #317: resolve the apps/recordings/src/__tests__/config.test.ts conflict — the PR's display-name change and main's changes must coexist; the resolution keeps BOTH sides' content (display-name strings + main's test changes). #332: apps/notes/README.md conflict — same rule. Any genuinely ambiguous hunk: ABORT + record.
4. Push: git push --force-with-lease origin HEAD:<branch>. Verify merge-tree equality: TREE=$(git -C ${MONOREPO} merge-tree --write-tree origin/main <new-head>); git -C ${MONOREPO} diff --quiet <new-head> "$TREE" — must be EQUAL.
5. Run the app's affected tests (bounded 8 min) + secrets scan the diff (rc 0). Commit message convention: the rebase keeps the PR's commits; if a fixup commit is needed, conventional message + 'Agent: naming-317-332' trailer LAST.
Return (JSON): { prs: [{number, newHead, rebased: bool, conflictResolved: string|null, mergeTreeEqual: bool, tests: {passed, failed}, secretsClean: bool}] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Focused re-review of the rebased merge results. PRs: {PRS} (number + newHead). For EACH verify: (a) merge result == head tree at CURRENT origin/main; (b) the display-name change is intact ('Hasna <Name>' strings correct, open- prefix retired) and the conflict resolution did not lose or alter main's content (for #317: config.test.ts contains both the display-name strings and main's test changes; for #332: README.md has both); (c) secrets clean; (d) scope confined to the app. Post '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: naming conflict-resolution re-review, reviewer naming-317-332-review'. Block ONLY concrete P0/P1 defects (lost content, broken tests, scope creep). P2/P3 non-blocking.
Return (JSON): { prs: [{number, verdict: GO|NO_GO, findings: [{severity, title, detail}]}] }
`

const MERGE = CONST + `
ROLE: merge lane (Sonnet). {BATCH} (each: number). For EACH GO'd PR: head == reviewed sha; merge-tree equality at CURRENT origin/main (re-measure; if main moved, verify the delta is disjoint and proceed); gh pr merge <n> --squash --body-file <file ending 'Agent: naming-merge-gap'>; record merged sha. NO_GO: comment findings, leave open.
Return (JSON): { prs: [{number, merged: bool, mergedSha: string|null, reason: string|null}] }
`

const REBASE_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REVIEW_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const MERGE_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }

phase('Rebase')
const rebase = await agent(REBASE.replace('{PRS}', JSON.stringify([317, 332])), { label: 'naming-317-332-rebase', phase: 'Rebase', schema: REBASE_SCHEMA, model: 'sonnet' })
const heads = (rebase && rebase.prs) ? rebase.prs : [{ number: 317, newHead: null }, { number: 332, newHead: null }]

phase('Review')
const review = await agent(REVIEW.replace('{PRS}', JSON.stringify(heads)), { label: 'naming-317-332-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })

phase('Merge')
let merge = null
if (review) {
  const go = (review.prs || []).filter(p => p.verdict === 'GO').map(p => p.number)
  if (go.length) merge = await agent(MERGE.replace('{BATCH}', JSON.stringify(go)), { label: 'naming-317-332-merge', phase: 'Merge', schema: MERGE_SCHEMA, model: 'sonnet' })
}

return { rebase, review, merge }
