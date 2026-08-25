export const meta = {
  name: 'stale-217-220-rebase',
  description: 'Rebase PRs 217 (governance/CI gate) and 220 (wave-2 census fixes) onto current main, fresh Fable review at the new heads, merge on GO',
  phases: [
    { title: 'Rebase', detail: 'both PRs onto current origin/main (217 has an own-file ci.yml delta on main)' },
    { title: 'Review', detail: 'fresh Fable review at the rebased heads' },
    { title: 'Merge', detail: 'merge on GO' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const TASK = '9ef14d65'

const CONST = `
You are a lane of the stale-217-220-rebase workflow (task ${TASK}, pr-zero lineage). The stale-drain held two PRs base-moved: #217 (governance: fail-closed secrets scan, least-privilege CI, census) — GO recorded at c8ff8c4b but main added deploy-lane gate steps to the PR's own .github/workflows/ci.yml since its last sync, so the merge result is unreviewed at head; #220 (wave-2 4-surface census + junk-state fixes) — recorded verdict is [REVIEW] SKIP base-moved, the earlier GO is pinned at an older sha. This lane: rebase both onto current main, FRESH Fable review at the new heads, merge on GO. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull; never discard local work). Work in task worktrees ~/.hasna/repos/worktrees/apps/stale-217-220 from origin/main. Never push to main. Force-push (--force-with-lease) ONLY on the PR's own branch. Merges ONLY via gh pr merge <n> --squash --body-file <file whose LAST line is 'Agent: stale-drain'>.
- IDEMPOTENCY CHECK FIRST: skip any PR already MERGED.
- No secrets: never print/capture/commit credential values. No internal-infra strings. Staged secrets scan before every commit/push. Capture path: redirect to files, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the task rows, posts to #board. English. Lineage identity 'conversations agents register' named stale-217-220.
`

const REBASE = CONST + `
ROLE: rebase lane (Sonnet). PRs: {PRS} (numbers). For EACH:
1. IDEMPOTENCY CHECK FIRST (see CONST). Resolve the actual head branch: gh pr view <n> --repo hasna/apps --json headRefName,headRefOid,state.
2. Fetch: git -C ${MONOREPO} fetch origin pull/<n>/head:stale-<n>; worktree ~/.hasna/repos/worktrees/apps/stale-217-220; git checkout -B <ACTUAL headRefName> stale-<n>.
3. Rebase onto CURRENT origin/main (git rebase origin/main). #217: the ci.yml conflict with main's deploy-lane gate steps — resolve keeping BOTH (the PR's governance gate steps + main's deploy-lane steps must coexist in the workflow file). Ambiguous hunks: ABORT + record.
4. Push: git push --force-with-lease origin HEAD:<branch>. Verify merge-tree equality: TREE=$(git -C ${MONOREPO} merge-tree --write-tree origin/main <new-head>); git -C ${MONOREPO} diff --quiet <new-head> "$TREE" — must be EQUAL.
5. Run the affected checks (bounded 8 min: the touched apps' tests where runnable) + secrets scan the diff (rc 0 clean).
Return (JSON): { prs: [{number, newHead, rebased: bool, conflictResolved: string|null, mergeTreeEqual: bool, tests: {passed, failed}, secretsClean: bool}] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). FRESH review of the rebased heads. PRs: {PRS} (number + newHead). For EACH verify: (a) merge result == head tree at CURRENT origin/main; (b) the PR's substance at the new head (for 217: the governance gates are intact AND the merged ci.yml contains both the PR's gate steps and main's deploy-lane steps; for 220: the census + junk-state fixes intact); (c) secrets clean; (d) scope confined. Post '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: stale-drain rebase re-review, reviewer stale-217-220-review'. Block ONLY concrete P0/P1 defects. P2/P3 non-blocking.
Return (JSON): { prs: [{number, verdict: GO|NO_GO, findings: [{severity, title, detail}]}] }
`

const MERGE = CONST + `
ROLE: merge lane (Sonnet). {BATCH} (each: number). For EACH GO'd PR: head == reviewed sha; merge-tree equality at CURRENT origin/main (re-measure; if main moved, verify the delta is disjoint and proceed); gh pr merge <n> --squash --body-file <file ending 'Agent: stale-drain'>; record merged sha. NO_GO: comment findings, leave open.
Return (JSON): { prs: [{number, merged: bool, mergedSha: string|null, reason: string|null}] }
`

const REBASE_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REVIEW_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const MERGE_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }

phase('Rebase')
const rebase = await agent(REBASE.replace('{PRS}', JSON.stringify([217, 220])), { label: 'stale-217-220-rebase', phase: 'Rebase', schema: REBASE_SCHEMA, model: 'sonnet' })
const heads = (rebase && rebase.prs) ? rebase.prs : [{ number: 217, newHead: null }, { number: 220, newHead: null }]

phase('Review')
const review = await agent(REVIEW.replace('{PRS}', JSON.stringify(heads)), { label: 'stale-217-220-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })

phase('Merge')
let merge = null
if (review) {
  const go = (review.prs || []).filter(p => p.verdict === 'GO').map(p => p.number)
  if (go.length) merge = await agent(MERGE.replace('{BATCH}', JSON.stringify(go)), { label: 'stale-217-220-merge', phase: 'Merge', schema: MERGE_SCHEMA, model: 'sonnet' })
}

return { rebase, review, merge }
