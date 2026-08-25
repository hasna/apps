export const meta = {
  name: 'skills-plan-t11t12',
  description: 'Tail of the skills plan (8022d27f): T11 e2e integration matrix (local folder + hosted instance on sqlite AND postgres) against the merged T8 contract and T9 sync surface; T12 deploy + live verification of the hosted skills instance',
  phases: [
    { title: 'Execute', detail: 'T11 lane (integration matrix, PR-first), T12 lane (deploy + live verify, exact-gate discipline)' },
    { title: 'Review', detail: 'Fable review of the T11 PR' },
    { title: 'Report', detail: 'per-task state + residue' },
  ],
}

const APPS = '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'
const PLAN = '8022d27f'
const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'

const CONST = `
You are a lane of the skills-plan-t11t12 workflow (owner-authorized 2026-08-18, todos plan ${PLAN}). The skills plan's successors for T8 (PR #440, writeCorpusSkill invariant) and T9 (PR #446, cloud-sync reconciliation verb) are MERGED on main; T13 (PR #500) merged. This run lands the plan's tail: T11 (69d59509, e2e integration matrix) and T12 (eacf9f19, deploy + live verification of the hosted skills instance). Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first: git -C ${MONOREPO} pull (fast-forward; never discard local work). Work in task worktrees ~/.hasna/repos/worktrees/apps/skills-t11t12-<n> from origin/main. Never push to main. PR-first; merges ONLY via gh pr merge <n> --squash --body-file <file whose LAST line is 'Agent: skills-t11t12-<your-role>'>.
- IDEMPOTENCY CHECK FIRST: read the task (todos show <id> --project APPS --json, redirect). If it is completed or its premise is already satisfied on main, complete by evidence with a comment naming the absorbing PR — do NOT re-implement.
- EXACT-GATE DISCIPLINE (T12): credentials are consumed ONLY via 'secrets exec <key> --as VAR -- <cmd>' — never print/capture/commit values. AWS_ACCOUNT_ID is a non-secret account id; set it as a repo secret only through the supported gh secret set path when the task requires it. If a genuine gate blocks (missing vault credential after 'secrets search <term>' comes back empty, an apply-role widening that is not authorized, an unreachable host), record the EXACT blocker with evidence on the task and LEAVE IT PENDING — do not force, do not bypass, do not mark done.
- No internal-infra strings in artifacts. Staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. Capture path: redirect to files, never pipe large reads. Paste literal output lines.
- Record as you go: comments on each task row, posts to #board. English. Lineage identity 'conversations agents register' named skills-t11t12-<your-role>.
- TDD for code: failing test first, see it fail, then implement. Distinguish measured vs inferred; state what you did not check.
`

const T11 = CONST + `
ROLE: T11 lane. Task 69d59509 — the end-to-end integration matrix: local folder AND hosted instance on BOTH sqlite AND postgres. The merged T8 contract (writeCorpusSkill invariant, PR #440) and T9 sync surface (reconcileRegistry, PR #446) are on main. Build the matrix as a test suite in apps/skills (or the app that owns the skills runtime): each cell exercises the real user-visible path — corpus write through writeCorpusSkill, registry sync through reconcileRegistry — on (a) local folder, (b) hosted instance with sqlite backend, (c) hosted instance with postgres backend (HASNA_SKILLS_DATABASE_URL). Where a cell needs a running server, start it bounded and tear down; where postgres is unavailable on this box, record the measured cell as SKIPPED-WITH-EVIDENCE (name the exact gate) rather than claiming coverage. TDD first: failing tests for each reachable cell, see them fail, then implement the harness. Run the suite (bounded 12 min), secrets scan, commit ('Agent: skills-t11t12-t11' trailer LAST), push, open the PR.
Return (JSON): { tasks: [{id: '69d59509', action: 'executed'|'skipped'|'completed-by-evidence', prNumber: number|null, cells: {localFolder: string, hostedSqlite: string, hostedPostgres: string}, tests: {passed, failed}, evidence: string}] }
`

const T12 = CONST + `
ROLE: T12 lane. Task eacf9f19 — deploy + live verification of the hosted skills instance: migrate, secrets (consumed via 'secrets exec', never captured), signed bundle, client flow. Read the task for the full recorded context, including the previously recorded gates (AWS_ACCOUNT_ID repo secret; iapp-infra apply-role widening). Sequence: (1) enumerate what exists today (hosted skills endpoint, deploy path, IaC) with measured evidence; (2) execute the deploy steps that are authorized and unblocked — migrate, secrets wiring via the supported path, signed bundle, client flow against the live instance; (3) live-test the real user-visible path (a corpus write + a registry sync through the hosted instance); (4) where a gate GENUINELY blocks (missing vault credential after 'secrets search' returns empty, unauthorized role widening, unreachable host), record the exact blocker with evidence on the task and LEAVE IT PENDING — do not force. Complete the task ONLY when the live test passes on the real hosted instance.
Return (JSON): { tasks: [{id: 'eacf9f19', action: 'executed'|'blocked'|'completed-by-evidence', deployed: bool, liveTest: string, blocker: string|null, evidence: string}] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review {PRS} (each: number). Verify per PR: the integration matrix genuinely exercises the four cells (local, hosted-sqlite, hosted-postgres) with honest SKIPPED-WITH-EVIDENCE where a cell is unreachable; tests pass; secrets clean; scope confined to the skills runtime. Post '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: skills e2e matrix, reviewer skills-t11t12-review'. Block ONLY concrete P0/P1 defects (a falsely-claimed cell, broken build, secrets). P2/P3 non-blocking.
Return (JSON): { prs: [{number, verdict: GO|NO_GO, findings: [{severity, title, detail}]}] }
`

const MERGE = CONST + `
ROLE: merge lane. {BATCH} (each: number). For EACH GO'd PR: head == reviewed sha; merge-tree equality at CURRENT origin/main (re-measure; if main moved, verify the delta is disjoint and proceed); gh pr merge <n> --squash --body-file <file ending 'Agent: skills-t11t12-ship'>; record merged sha. NO_GO: comment findings, leave open.
Return (JSON): { prs: [{number, merged: bool, mergedSha: string|null, reason: string|null}] }
`

const REPORT = CONST + `
ROLE: report. Aggregate: T11 state (matrix cells, PR), T12 state (deployed/live-test/blocker). Comment each task row (69d59509, eacf9f19), post the summary to #board. Residue = any task left pending with its exact blocker.
Return (JSON): { tasks: [{id, state, prNumber, mergedSha}], residue: [string] }
`

const T11_SCHEMA = { type: 'object', properties: { tasks: { type: 'array', items: { type: 'object' } } }, required: ['tasks'] }
const T12_SCHEMA = { type: 'object', properties: { tasks: { type: 'array', items: { type: 'object' } } }, required: ['tasks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const MERGE_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REPORT_SCHEMA = { type: 'object', properties: { tasks: { type: 'array' }, residue: { type: 'array' } }, required: ['tasks'] }

phase('Execute')
const t11 = await agent(T11, { label: 'skills-t11-matrix', phase: 'Execute', schema: T11_SCHEMA })
const t12 = await agent(T12, { label: 'skills-t12-deploy', phase: 'Execute', schema: T12_SCHEMA })
const t11Pr = (t11 && t11.tasks && t11.tasks[0] && t11.tasks[0].prNumber) || null
log(`t11: ${t11 && t11.tasks && t11.tasks[0] && t11.tasks[0].action} pr=${t11Pr}; t12: ${t12 && t12.tasks && t12.tasks[0] && t12.tasks[0].action}`)

phase('Review')
let review = null
if (t11Pr) {
  review = await agent(REVIEW.replace('{PRS}', JSON.stringify([{ number: t11Pr }])), { label: 'skills-t11t12-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
}

phase('Merge')
let merge = null
if (review) {
  const go = (review.prs || []).filter(p => p.verdict === 'GO').map(p => p.number)
  if (go.length) merge = await agent(MERGE.replace('{BATCH}', JSON.stringify(go)), { label: 'skills-t11t12-merge', phase: 'Merge', schema: MERGE_SCHEMA })
}

phase('Report')
const report = await agent(REPORT, { label: 'skills-t11t12-report', phase: 'Report', schema: REPORT_SCHEMA })

return { t11, t12, review, merge, report }
