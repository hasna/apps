export const meta = {
  name: 'backlog-docs-knowledge',
  description: 'Execute the backlog-docs-knowledge backlog from the apps todos project: read each task, execute it (code tasks TDD+PR-first, docs/knowledge tasks via the owning CLI), review, merge, complete the task',
  phases: [
    { title: 'Execute', detail: 'per-task lanes (max 4 concurrent): read task -> execute -> PR -> review -> merge -> complete' },
    { title: 'Report', detail: 'per-task outcome + residue' },
  ],
}

const APPS = '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'
const TASK_IDS = ["189f7bbf", "d592019a", "de615c6d", "0edbfa2c", "515eb54e", "d23a7954", "9f74ab44", "f288ca2b", "4f87a747", "04ba8b90", "4536569b", "fb24f3cd", "a0f6b297", "d1a61972", "41744a3c", "1388859a", "5c5b00d3", "f5ea5fa1", "dd6d3f70", "8f7ae50f", "0a1ac2ad", "363aef25", "742f1667", "1a0ffae3"]

const CONST = `
You are a lane of the backlog-docs-knowledge backlog workflow (owner-authorized 2026-08-18). You execute todos tasks from the apps project (APPS) that were backlogged or stale. For EACH task: read it (todos show <id> --project APPS --json, redirect to a file), execute its description, land the PR (code tasks) or write via the owning CLI (knowledge/skills/docs), verify, then complete the task ('todos update <id> --status completed' with an evidence comment). Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- The monorepo is READ/context only when in hasna/apps (worktrees at ~/.hasna/repos/worktrees/apps/<task>-<n> from origin/main, PR-first, never push to main). Knowledge/skills/docs tasks use their owning CLIs (knowledge add/update, skills CLI, the docs' repo) — no direct DB writes anywhere.
- IDEMPOTENCY CHECK FIRST: if the task is already completed, verify its evidence and SKIP. If the task's premise is already satisfied on main (its PR merged or done-by-others), complete it by evidence with a comment naming the absorbing PR/evidence — do NOT re-implement.
- No secrets: never print/capture/commit credential values. No internal-infra strings in artifacts. Staged secrets scan before every commit/push. Capture path: redirect to files, never pipe large reads. Paste literal output lines.
- Record as you go: comments on each task row, posts to #board. English. Lineage identity 'conversations agents register' named backlog-docs-knowledge-<your-role>.
- TDD for code tasks: failing test first, see it fail, then implement.
`

const EXECUTE = CONST + `
ROLE: execute lane. Your batch: {BATCH} (task ids). For EACH task id:
1. IDEMPOTENCY CHECK FIRST (see CONST): todos show <id> --project APPS --json (redirect) — if completed, skip; if the premise is satisfied (the task names a PR that is merged, or a decision already executed), complete by evidence.
2. EXECUTE per the task description:
   - CODE/BUG tasks: worktree + branch fix/<task-short>, TDD, tests, secrets scan, commit ('Agent: backlog-docs-knowledge-<task-short>' trailer LAST), push, PR.
   - DOCS/KNOWLEDGE/SKILL tasks: use the owning CLI (knowledge add/update for knowledge rows, the skills CLI for skill rows, repo PRs for docs) — write the artefact, verify it resolves.
   - DECISION rows (close-as-superseded etc.): complete by evidence with the comment naming the absorbing PR.
3. Merge (for code PRs): the REVIEW lane must GO first.
Return (JSON): { tasks: [{id, action: 'executed'|'skipped'|'completed-by-evidence', prNumber: number|null, evidence: string}] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review {PRS} (each: number). Verify per PR: substance per the task, tests green, secrets clean, scope confined. Post '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: backlog execution, reviewer backlog-docs-knowledge-review'. Block ONLY concrete P0/P1 defects. P2/P3 non-blocking.
Return (JSON): { prs: [{number, verdict: GO|NO_GO, findings: [{severity, title, detail}]}] }
`

const MERGE = CONST + `
ROLE: merge lane. {BATCH} (each: number). For EACH GO'd PR: head == reviewed sha; merge-tree equality at CURRENT origin/main (re-measure; if main moved, verify the delta is disjoint and proceed); gh pr merge <n> --squash --body-file <file ending 'Agent: backlog-docs-knowledge-ship'>; record merged sha. NO_GO: comment findings, leave open.
Return (JSON): { prs: [{number, merged: bool, mergedSha: string|null, reason: string|null}] }
`

const REPORT = CONST + `
ROLE: report. Aggregate per-task state (executed/skipped/completed-by-evidence/merged), residue. Comment the tracking task, post to #board.
Return (JSON): { tasks: [{id, state, prNumber, mergedSha}], residue: [string] }
`

const EXEC_SCHEMA = { type: 'object', properties: { tasks: { type: 'array', items: { type: 'object' } } }, required: ['tasks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const MERGE_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REPORT_SCHEMA = { type: 'object', properties: { tasks: { type: 'array' }, residue: { type: 'array' } }, required: ['tasks'] }

phase('Execute')
const execResults = await parallel(TASK_IDS.map((tid, i) => () =>
  agent(EXECUTE.replace('{BATCH}', JSON.stringify([tid])), { label: `backlog-docs-knowledge-exec-${i + 1}`, phase: 'Execute', schema: EXEC_SCHEMA }),
))
const executed = execResults.filter(Boolean).flatMap(r => r.tasks || [])
const prs = executed.filter(t => t.prNumber).map(t => ({ number: t.prNumber }))
log(`execute: ${executed.length} tasks, ${prs.length} PRs`)

phase('Review')
let reviewResults = []
const reviewBatches = []
for (let i = 0; i < prs.length; i += 4) reviewBatches.push(prs.slice(i, i + 4))
if (reviewBatches.length) {
  reviewResults = await parallel(reviewBatches.map((rb, i) => () =>
    agent(REVIEW.replace('{PRS}', JSON.stringify(rb)), { label: `backlog-docs-knowledge-review-${i + 1}`, phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' }),
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
    return agent(MERGE.replace('{BATCH}', JSON.stringify(go)), { label: `backlog-docs-knowledge-merge-${i + 1}`, phase: 'Merge', schema: MERGE_SCHEMA, model: 'sonnet' })
  }))
}

phase('Report')
const report = await agent(REPORT, { label: 'backlog-docs-knowledge-report', phase: 'Report', schema: REPORT_SCHEMA, model: 'sonnet' })

return { exec: execResults.filter(Boolean), reviews: reviewResults.filter(Boolean), merges: mergeResults.filter(Boolean), report }
