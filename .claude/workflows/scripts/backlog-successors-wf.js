export const meta = {
  name: 'backlog-successors',
  description: 'Execute the backlog-successors backlog from the apps todos project: read each task, execute it (code tasks TDD+PR-first, docs/knowledge tasks via the owning CLI), review, merge, complete the task',
  phases: [
    { title: 'Execute', detail: 'per-task lanes (max 4 concurrent): read task -> execute -> PR -> review -> merge -> complete' },
    { title: 'Report', detail: 'per-task outcome + residue' },
  ],
}

const APPS = '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'
const TASK_IDS = ["ee591f1e", "d3adc303", "fd78936f", "337fa39e", "53318a55", "c19e64f9", "c3d3e63e", "666d6d1d", "82637029", "4b04f513", "2b4de2e4", "d55b98b7", "3240cbca"]

const CONST = `
You are a lane of the backlog-successors backlog workflow (owner-authorized 2026-08-18). You execute todos tasks from the apps project (APPS) that were backlogged or stale. For EACH task: read it (todos show <id> --project APPS --json, redirect to a file), execute its description, land the PR (code tasks) or write via the owning CLI (knowledge/skills/docs), verify, then complete the task ('todos update <id> --status completed' with an evidence comment). Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- The monorepo is READ/context only when in hasna/apps (worktrees at ~/.hasna/repos/worktrees/apps/<task>-<n> from origin/main, PR-first, never push to main). Knowledge/skills/docs tasks use their owning CLIs (knowledge add/update, skills CLI, the docs' repo) — no direct DB writes anywhere.
- IDEMPOTENCY CHECK FIRST: if the task is already completed, verify its evidence and SKIP. If the task's premise is already satisfied on main (its PR merged or done-by-others), complete it by evidence with a comment naming the absorbing PR/evidence — do NOT re-implement.
- No secrets: never print/capture/commit credential values. No internal-infra strings in artifacts. Staged secrets scan before every commit/push. Capture path: redirect to files, never pipe large reads. Paste literal output lines.
- Record as you go: comments on each task row, posts to #board. English. Lineage identity 'conversations agents register' named backlog-successors-<your-role>.
- TDD for code tasks: failing test first, see it fail, then implement.
`

const EXECUTE = CONST + `
ROLE: execute lane. Your batch: {BATCH} (task ids). For EACH task id:
1. IDEMPOTENCY CHECK FIRST (see CONST): todos show <id> --project APPS --json (redirect) — if completed, skip; if the premise is satisfied (the task names a PR that is merged, or a decision already executed), complete by evidence.
2. EXECUTE per the task description:
   - CODE/BUG tasks: worktree + branch fix/<task-short>, TDD, tests, secrets scan, commit ('Agent: backlog-successors-<task-short>' trailer LAST), push, PR.
   - DOCS/KNOWLEDGE/SKILL tasks: use the owning CLI (knowledge add/update for knowledge rows, the skills CLI for skill rows, repo PRs for docs) — write the artefact, verify it resolves.
   - DECISION rows (close-as-superseded etc.): complete by evidence with the comment naming the absorbing PR.
3. Merge (for code PRs): the REVIEW lane must GO first.
Return (JSON): { tasks: [{id, action: 'executed'|'skipped'|'completed-by-evidence', prNumber: number|null, evidence: string}] }
`

const RECONCILE = CONST + `
ROLE: reconcile lane. Wave-2 pre-review reconciliation of the wave-1 residue PRs: {PRS} (each: number + known state). For EACH PR: gh pr view <n> --json state,headRefOid,mergeable (projected). If merged/closed: record and skip. Then per known state:
- PR 499 (fd78936f, work-status integrity): it CONFLICTS at origin/main with the landed 464 (assertNoDuplicateWorkStatusTransitionPg guard + bulk-loop rework occupy the same write-path region in apps/conversations/src/lib/messages.ts and server/api.ts). REBASE it: worktree ~/.hasna/repos/worktrees/apps/bs-r2-499 on its branch, git rebase origin/main, resolve the conflict by RECONCILING BOTH REVIEWED BEHAVIOURS (464's duplicate-transition guard and 499's enforceWorkStatusEventWriteAsync schema block must coexist coherently — never a textual merge that matches neither), TDD for the combined write path, run the conversations suite (bounded 12 min), secrets scan, commit, push --force-with-lease. A textual merge that matches neither reviewed behaviour is forbidden; if the behaviours genuinely cannot coexist, record that precisely and leave the PR open with a comment.
- PR 476 (337fa39e, statusline): DUPLICATE of merged PR 494 (both successors of terminated #272, same files, same P1, 494 landed). Do NOT rebase or fix: comment on 476 naming 494 as the absorbing merge and CLOSE it by evidence.
- PRs 470 (d592019a) and 544 (dd6d3f70): verify their current state and mergeable status; if MERGEABLE and clean, leave for the review lane; if conflicting, rebase onto origin/main with the same discipline as 499.
Return (JSON): { prs: [{number, state: 'rebased'|'closed-by-evidence'|'skip'|'conflict-unresolvable', newHead: string|null, evidence: string}] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review {PRS} (each: number). For EACH PR first check state (gh pr view <n> --json state,headRefOid — projected fields only): merged or closed -> record and SKIP (do not review). Then verify per open PR: substance per the task, tests green, secrets clean, scope confined, head fresh (merge-tree check vs origin/main). Post '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: backlog execution, reviewer backlog-successors-review'. Block ONLY concrete P0/P1 defects. P2/P3 non-blocking.
Return (JSON): { prs: [{number, verdict: GO|NO_GO, findings: [{severity, title, detail}]}] }
`

const MERGE = CONST + `
ROLE: merge lane. {BATCH} (each: number). For EACH GO'd PR: head == reviewed sha; merge-tree equality at CURRENT origin/main (re-measure; if main moved, verify the delta is disjoint and proceed); gh pr merge <n> --squash --body-file <file ending 'Agent: backlog-successors-ship'>; record merged sha. NO_GO: comment findings, leave open.
Return (JSON): { prs: [{number, merged: bool, mergedSha: string|null, reason: string|null}] }
`

const REPORT = CONST + `
ROLE: report. Aggregate per-task state (executed/skipped/completed-by-evidence/merged), residue. Comment the tracking task, post to #board.
Return (JSON): { tasks: [{id, state, prNumber, mergedSha}], residue: [string] }
`

const EXEC_SCHEMA = { type: 'object', properties: { tasks: { type: 'array', items: { type: 'object' } } }, required: ['tasks'] }
const PR_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REVIEW_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const MERGE_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REPORT_SCHEMA = { type: 'object', properties: { tasks: { type: 'array' }, residue: { type: 'array' } }, required: ['tasks'] }

phase('Execute')
const execResults = await parallel(TASK_IDS.map((tid, i) => () =>
  agent(EXECUTE.replace('{BATCH}', JSON.stringify([tid])), { label: `backlog-successors-exec-${i + 1}`, phase: 'Execute', schema: EXEC_SCHEMA }),
))
const executed = execResults.filter(Boolean).flatMap(r => r.tasks || [])
const prs = executed.filter(t => t.prNumber).map(t => ({ number: t.prNumber }))
log(`execute: ${executed.length} tasks, ${prs.length} PRs`)

phase('Reconcile')
const RESIDUE_PRS = [
  { number: 499, note: 'conflicts with landed 464 — rebase reconciling both behaviours' },
  { number: 476, note: 'duplicate of merged 494 — close by evidence' },
  { number: 470, note: 'wave-1 residue — verify state, rebase if conflicting' },
  { number: 544, note: 'wave-1 residue — verify state, rebase if conflicting' },
]
const reconcile = await agent(
  RECONCILE.replace('{PRS}', JSON.stringify(RESIDUE_PRS)),
  { label: 'backlog-successors-reconcile', phase: 'Reconcile', schema: PR_SCHEMA },
)
log(`reconcile: ${reconcile && reconcile.prs ? reconcile.prs.length : 0} PRs processed`)

phase('Review')
let reviewResults = []
const reviewBatches = []
for (let i = 0; i < prs.length; i += 4) reviewBatches.push(prs.slice(i, i + 4))
if (reviewBatches.length) {
  reviewResults = await parallel(reviewBatches.map((rb, i) => () =>
    agent(REVIEW.replace('{PRS}', JSON.stringify(rb)), { label: `backlog-successors-review-${i + 1}`, phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' }),
  ))
}

phase('Merge')
let mergeResults = []
if (reviewResults.length) {
  const verdictMap = {}
  for (const rv of reviewResults.filter(Boolean)) {
    for (const p of (rv.prs || [])) verdictMap[p.number] = p.verdict
  }
  mergeResults = await parallel(reviewBatches.map((rb, i) => () => {
    const go = rb.map(p => p.number).filter(n => verdictMap[n] === 'GO')
    return agent(MERGE.replace('{BATCH}', JSON.stringify(go)), { label: `backlog-successors-merge-${i + 1}`, phase: 'Merge', schema: MERGE_SCHEMA, model: 'sonnet' })
  }))
}

phase('Report')
const report = await agent(REPORT, { label: 'backlog-successors-report', phase: 'Report', schema: REPORT_SCHEMA, model: 'sonnet' })

return { exec: execResults.filter(Boolean), reconcile, reviews: reviewResults.filter(Boolean), merges: mergeResults.filter(Boolean), report }
