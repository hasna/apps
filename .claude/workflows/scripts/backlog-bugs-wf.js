export const meta = {
  name: 'backlog-bugs',
  description: 'Execute the backlog-bugs backlog from the apps todos project: read each task, execute it (code tasks TDD+PR-first, docs/knowledge tasks via the owning CLI), review, merge, complete the task',
  phases: [
    { title: 'Execute', detail: 'per-task lanes (max 4 concurrent): read task -> execute -> PR -> review -> merge -> complete' },
    { title: 'Report', detail: 'per-task outcome + residue' },
  ],
}

const APPS = '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'
const TASK_IDS = ["7778b9e5", "2d2d0e61", "04ee08fd", "bb129570", "1b774f36", "4d33b941", "39b91c28", "27c51f16", "2ffcad1b", "b66b3f04", "8d53ab26", "9b47675b", "c4459d0c", "542da752", "a71e18ce", "fcf705f7", "d2a6dec7", "3990c423", "25ba28cf", "852e20c5", "9b5c46a7", "60f2ab27", "4aa4b058", "48a92f1b", "3d3521a4", "1fb09589", "01c45b0c", "7f0baf75", "9de656a1", "f7e8c386", "bbe50c53"]

const CONST = `
You are a lane of the backlog-bugs backlog workflow (owner-authorized 2026-08-18). You execute todos tasks from the apps project (APPS) that were backlogged or stale. For EACH task: read it (todos show <id> --project APPS --json, redirect to a file), execute its description, land the PR (code tasks) or write via the owning CLI (knowledge/skills/docs), verify, then complete the task ('todos update <id> --status completed' with an evidence comment). Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- The monorepo is READ/context only when in hasna/apps (worktrees at ~/.hasna/repos/worktrees/apps/<task>-<n> from origin/main, PR-first, never push to main). Knowledge/skills/docs tasks use their owning CLIs (knowledge add/update, skills CLI, the docs' repo) — no direct DB writes anywhere.
- IDEMPOTENCY CHECK FIRST: if the task is already completed, verify its evidence and SKIP. If the task's premise is already satisfied on main (its PR merged or done-by-others), complete it by evidence with a comment naming the absorbing PR/evidence — do NOT re-implement.
- No secrets: never print/capture/commit credential values. No internal-infra strings in artifacts. Staged secrets scan before every commit/push. Capture path: redirect to files, never pipe large reads. Paste literal output lines.
- Record as you go: comments on each task row, posts to #board. English. Lineage identity 'conversations agents register' named backlog-bugs-<your-role>.
- TDD for code tasks: failing test first, see it fail, then implement.
- CREDENTIAL RULE for task fcf705f7 (token exposure): the exposure is recorded to incidents (name+scope, never the value); DO NOT rotate any token piecemeal — the owner rules that all credentials rotate together once the system is stable. The executable half is: verify all no-cloud repo remotes are sanitized (grep remotes for token-bearing URLs; redact or remove any found) and complete the task by evidence naming the incidents record.
- HOSTED-API PARITY for task 1fb09589 (CLI run-now unavailable on hosted API): the two-backend storage contract binds — the client (CLI) must work against BOTH the local store and the hosted API (HASNA_LOOPS_API_URL + key), fail-closed when unset, and the server (HASNA_LOOPS_DATABASE_URL -> Postgres else SQLite) must expose run-now. The fix RESTORES the hosted route (an API surface plus its CLI wiring) — never delete the verb to make the defect disappear. No mode enums anywhere.
- CANONICAL ROUTING for task 48a92f1b (agent preflight bypasses Machines canonical routing): the preflight must resolve the target machine THROUGH the machines CLI's canonical route (machines CLI, exact repo/machine lookup, never fuzzy output, never a hardcoded path or a hand-rolled resolution that duplicates the owning package). Fix the owning abstraction so every preflight path uses it.
- FK-SCOPE RULE for task 01c45b0c (CRITICAL: repos v15 migration whole-DB FK check bricks the CLI on drifted registries — 0.1.49, station01): the migration v15 verifyAfterMarker runs PRAGMA foreign_key_check over the WHOLE database and throws on any violation; the real registry holds 1560 PRE-EXISTING violations (branches 1230, tags 156, commits 129, remotes 3, worktree_leases 42) and the migration itself adds NO foreign keys. The fix must scope the post-migration verification to what the migration actually created (the pr_monitor_state table and any FK the migration itself defines) — never a whole-DB check that turns pre-existing drift into a hard brick. TDD first: a drifted-registry fixture (pre-existing FK violations in unrelated tables) on which the v15 migration must succeed and the CLI verbs must work; a clean-registry control must also pass. The migration must be idempotent on both. This is a PATCH release: changeset for @hasna/repos 0.1.50 (the 0.1.49 brick must be superseded on the registry — the publish-all cadence is the only publisher; the lane lands the fix PR + changeset only). Do NOT modify the real ~/.hasna/repos/repos.db — reproduction uses a copy or a scratch registry.
- SCHEDULE-IDENTITY RULE for task 9de656a1 (ceo-drift-check prompt identity disagrees with the schedule that executes it): the schedule's registered identity is authoritative — the prompt's self-claimed identity must MATCH the schedule's registered agent, never impersonate. The fix aligns the prompt to the schedule's registered identity (or re-registers the schedule under the prompt's identity — exactly one, decided by which is canonical). Verify with 'conversations whoami' and the schedule's run records.
- KILLED-VS-LOST for task f7e8c386 (scheduled Loops command run can emit STARTED and disappear without terminal diagnostic): an investigation lane MUST distinguish the dispatch-survivability signature — transcript ends '[Request interrupted by user for tool use]' with toolDenialKind: user-rejected at the pass's turn end (killed, known mechanism) — from genuine loss (no record, no process, no artefact). Report which class the measured case falls into with the exact evidence; do not assert a mechanism without the transcript tail.
- TARGET-INTEGRITY for task bbe50c53 (loops show hides command-target integrity behind the literal string 'shell'): the surface must show the REAL resolved target (the actual command or machine the loop will execute) — never a placeholder literal. The fix exposes the resolved target with its provenance.
`

const EXECUTE = CONST + `
ROLE: execute lane. Your batch: {BATCH} (task ids). For EACH task id:
1. IDEMPOTENCY CHECK FIRST (see CONST): todos show <id> --project APPS --json (redirect) — if completed, skip; if the premise is satisfied (the task names a PR that is merged, or a decision already executed), complete by evidence.
2. EXECUTE per the task description:
   - CODE/BUG tasks: worktree + branch fix/<task-short>, TDD, tests, secrets scan, commit ('Agent: backlog-bugs-<task-short>' trailer LAST), push, PR.
   - DOCS/KNOWLEDGE/SKILL tasks: use the owning CLI (knowledge add/update for knowledge rows, the skills CLI for skill rows, repo PRs for docs) — write the artefact, verify it resolves.
   - DECISION rows (close-as-superseded etc.): complete by evidence with the comment naming the absorbing PR.
3. Merge (for code PRs): the REVIEW lane must GO first.
Return (JSON): { tasks: [{id, action: 'executed'|'skipped'|'completed-by-evidence', prNumber: number|null, evidence: string}] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review {PRS} (each: number). Verify per PR: substance per the task, tests green, secrets clean, scope confined. Post '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: backlog execution, reviewer backlog-bugs-review'. Block ONLY concrete P0/P1 defects. P2/P3 non-blocking.
Return (JSON): { prs: [{number, verdict: GO|NO_GO, findings: [{severity, title, detail}]}] }
`

const MERGE = CONST + `
ROLE: merge lane. {BATCH} (each: number). For EACH GO'd PR: head == reviewed sha; merge-tree equality at CURRENT origin/main (re-measure; if main moved, verify the delta is disjoint and proceed); gh pr merge <n> --squash --body-file <file ending 'Agent: backlog-bugs-ship'>; record merged sha. NO_GO: comment findings, leave open.
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
  agent(EXECUTE.replace('{BATCH}', JSON.stringify([tid])), { label: `backlog-bugs-exec-${i + 1}`, phase: 'Execute', schema: EXEC_SCHEMA }),
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
    agent(REVIEW.replace('{PRS}', JSON.stringify(rb)), { label: `backlog-bugs-review-${i + 1}`, phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' }),
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
    return agent(MERGE.replace('{BATCH}', JSON.stringify(go)), { label: `backlog-bugs-merge-${i + 1}`, phase: 'Merge', schema: MERGE_SCHEMA, model: 'sonnet' })
  }))
}

phase('Report')
const report = await agent(REPORT, { label: 'backlog-bugs-report', phase: 'Report', schema: REPORT_SCHEMA, model: 'sonnet' })

return { exec: execResults.filter(Boolean), reviews: reviewResults.filter(Boolean), merges: mergeResults.filter(Boolean), report }
