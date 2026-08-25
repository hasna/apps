export const meta = {
  name: 'canonical-fix-merge',
  description: 'Rebase the 12 review-GO canonical-root fix PRs onto current main, re-review the rebased heads (Fable), fix #328\'s one-line CI blocker, merge',
  phases: [
    { title: 'Rebase', detail: '4 lanes, 3 PRs each: rebase onto origin/main, push, fix #328 one-liner' },
    { title: 'Review', detail: 'Fable re-review of each rebased head (merge-tree equality + scope)' },
    { title: 'Merge', detail: 'merge the GO\'d rebased heads with attribution' },
    { title: 'Report', detail: 'per-PR outcome + follow-ups' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const TASK = '875c805e-e14e-4cf3-a942-75545406108f'

const CONST = `
You are a lane of the canonical-fix-merge workflow (owner-authorized 2026-08-18, task ${TASK}). The canonical-paths fix PRs (312, 315, 316, 318, 319, 321, 325, 326, 328, 335, 338, 362) were review-GO'd at their heads, but main moved since (the merge results differ from the reviewed trees) — so each must be REBASED onto current main and RE-REVIEWED at the rebased head before merging. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first: git -C ${MONOREPO} pull (fast-forward; never discard local work). Work in task worktrees ~/.hasna/repos/worktrees/apps/canon-merge-<n> from origin/main. Never push to main. Force-push (--force-with-lease) is allowed ONLY on the PR's own branch for the rebase. Merges ONLY via gh pr merge <n> --squash --body-file <file whose LAST line is 'Agent: canon-merge-<your-role>'>.
- No secrets: never print/capture/commit credential values in any encoding; consume ONLY via 'secrets exec <key> --as VAR -- <cmd>'. No internal-infra strings in artifacts.
- Capture path: redirect to files, read both + $?; never pipe large reads. Paste literal output lines when reporting.
- Record as you go: comments on ${TASK}, mementos for non-obvious findings, posts to #board. English. Register a lineage identity ('conversations agents register') named canon-merge-<your-role>.
- Distinguish measured vs inferred; state what you did not check. Plain register.
`

const REBASE = CONST + `
ROLE: rebase lane (Sonnet). Your PRs: {BATCH} (each: number + branch). For EACH PR:
1. Resolve the PR's ACTUAL head branch: gh pr view <n> --repo hasna/apps --json headRefName,headRefOid (projected fields only). Fetch the PR head: git -C ${MONOREPO} fetch origin pull/<n>/head:canon-<n>; worktree ~/.hasna/repos/worktrees/apps/canon-merge-<n>; git checkout -B <THE ACTUAL headRefName> canon-<n> — NEVER guess or create a different branch name (a pushed branch that is not the PR's head leaves the PR unupdated).
2. Rebase onto origin/main: git rebase origin/main. Resolve ONLY unambiguous conflicts (single-sided deletions, non-overlapping hunks); ambiguous -> ABORT + record the conflict (the PR stays open with a comment). For PR #328 ONLY: also apply the one-line fix — reword the doc comment in apps/emails/src/db/provider-secrets-canonical.test.ts that contains the word 'hosted' (it trips the no-cloud-boundary conformance scan; replace 'hosted' with 'cloud-configured' or similar neutral wording) — commit it as part of the rebase.
3. Push: git push --force-with-lease origin HEAD:<branch>. Re-fetch the new head sha.
4. Verify the merge-tree equality on the rebased head: TREE=$(git -C ${MONOREPO} merge-tree --write-tree origin/main <new-head>); git -C ${MONOREPO} diff --quiet <new-head> "$TREE" — must be EQUAL (if it still differs, record and flag for manual review).
5. Run the package's affected tests for the rebased head (bounded 8 min): the app's bun test for the touched test files — record counts. Secrets scan the diff (redirect + 'secrets scan input' — rc 0 clean).
Return (JSON): { prs: [{number, newHead, rebased: bool, conflict: string|null, mergeTreeEqual: bool, tests: {passed, failed}, secretsClean: bool}] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). You re-review the rebased heads of the lane's PRs adversarially. PRs: {PRS} (each: number + newHead).
For EACH PR: fetch the rebased head (git fetch origin pull/<n>/head), verify against the diff vs origin/main: (a) the canonical-root fix is intact and correct (default resolves to ~/.hasna/<app>/; env overrides still win; the migration is safe — never deletes, never overwrites, verified); (b) the merge result equals the rebased head tree (git merge-tree --write-tree origin/main <head> == head); (c) for #328: the 'hosted' reword landed and the no-cloud-boundary scan would pass; (d) secrets scan clean; changes confined to the app's dir. Post per-PR verdicts as PR comments with the first line '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: canonical-root re-review, reviewer canon-merge-review ({I} of 4)'. Block ONLY concrete P0/P1 defects. P2/P3 non-blocking (list as follow-ups).
Return (JSON): { prs: [{number, verdict: GO|NO_GO, findings: [{severity, title, detail}], mergeTreeEqual: bool}] }
`

const MERGE = CONST + `
ROLE: merge lane (Sonnet). Merge the GO'd PRs in your batch: {BATCH} (each: number + verdict). For EACH GO'd PR: verify the head is unchanged since the review (gh pr view <n> --json headRefOid == the reviewed sha) and the merge-tree equality still holds; then gh pr merge <n> --squash --body-file <file ending 'Agent: canon-merge-ship'>. Record the merged sha. For NO_GO PRs: comment the open findings on the PR + task and leave them open.
Return (JSON): { prs: [{number, merged: bool, mergedSha: string|null, reason: string|null}] }
`

const REPORT = CONST + `
ROLE: report. Aggregate: per-PR state (rebased/reviewed/merged/skipped), the #328 CI state, follow-ups (any PR left open with findings). Comment the final state on ${TASK}, post the summary to #board.
Return (JSON): { prs: [{number, state, mergedSha}], followUps: [string] }
Lanes: {LANES}
`

const REBASE_SCHEMA = {
  type: 'object',
  properties: {
    prs: { type: 'array', items: { type: 'object', properties: { number: { type: 'integer' }, newHead: { type: 'string' }, rebased: { type: 'boolean' }, conflict: { type: ['string', 'null'] }, mergeTreeEqual: { type: 'boolean' }, tests: { type: 'object' }, secretsClean: { type: 'boolean' } }, required: ['number', 'rebased'] } },
  },
  required: ['prs'],
}
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    prs: { type: 'array', items: { type: 'object', properties: { number: { type: 'integer' }, verdict: { type: 'string' }, findings: { type: 'array', items: { type: 'object' } }, mergeTreeEqual: { type: 'boolean' } }, required: ['number', 'verdict'] } },
  },
  required: ['prs'],
}
const MERGE_SCHEMA = {
  type: 'object',
  properties: {
    prs: { type: 'array', items: { type: 'object', properties: { number: { type: 'integer' }, merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, reason: { type: ['string', 'null'] } }, required: ['number', 'merged'] } },
  },
  required: ['prs'],
}
const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    prs: { type: 'array', items: { type: 'object' } },
    followUps: { type: 'array', items: { type: 'string' } },
  },
  required: ['prs'],
}

const PR_BATCHES = [
  [312, 315, 316],
  [318, 319, 321],
  [325, 326, 328],
  [335, 338, 362],
]

phase('Rebase')
const rebaseResults = await parallel(PR_BATCHES.map((batch, i) => () => {
  const b = batch.map(n => ({ number: n }))
  return agent(REBASE.replace('{BATCH}', JSON.stringify(b)), { label: `rebase-${i + 1}`, phase: 'Rebase', schema: REBASE_SCHEMA, model: 'sonnet' })
}))
const rebased = rebaseResults.filter(Boolean).flatMap(r => r.prs || [])
log(`rebase: ${rebased.length} PRs processed`)

phase('Review')
let reviewResults = []
if (rebased.length) {
  reviewResults = await parallel(PR_BATCHES.map((batch, i) => () => {
    const prs = rebased.filter(p => batch.includes(p.number))
    return agent(REVIEW.replace('{PRS}', JSON.stringify(prs)).replace('{I}', String(i + 1)), {
      label: `review-can-${i + 1}`, phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable',
    })
  }))
  log(`reviews: ${reviewResults.filter(Boolean).length} lanes`)
}

phase('Merge')
let mergeResults = []
if (reviewResults.length) {
  const verdictMap = {}
  for (const rv of reviewResults.filter(Boolean)) {
    for (const p of (rv.prs || [])) verdictMap[p.number] = p.verdict
  }
  mergeResults = await parallel(PR_BATCHES.map((batch, i) => () => {
    const go = batch.filter(n => verdictMap[n] === 'GO')
    return agent(MERGE.replace('{BATCH}', JSON.stringify(go)), { label: `merge-${i + 1}`, phase: 'Merge', schema: MERGE_SCHEMA, model: 'sonnet' })
  }))
}

phase('Report')
const report = await agent(
  REPORT.replace('{LANES}', JSON.stringify(mergeResults.filter(Boolean))),
  { label: 'report-can-merge', phase: 'Report', schema: REPORT_SCHEMA, model: 'sonnet' },
)

return { rebase: rebaseResults.filter(Boolean), reviews: reviewResults.filter(Boolean), merges: mergeResults.filter(Boolean), report }
