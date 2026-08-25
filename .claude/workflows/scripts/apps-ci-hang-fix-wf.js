export const meta = {
  name: 'apps-ci-hang-fix',
  description: 'Fix the hasna/apps CI hang: "Install playwright chromium (member browser tests)" step stuck 50+ min fleet-wide (runs 32228437778, 32223364687; normal ~13 min; only terminal state was cancellation) — blocks every merge incl. #397 (task 552e18cc, HIGH)',
  phases: [
    { title: 'Investigate', detail: 'read the browser-tests step definition + the two hung runs\' logs; classify the stall' },
    { title: 'Fix', detail: 'smallest owned repair to the workflow definition, PR-first' },
    { title: 'Verify', detail: 'real acceptance: the step completes on a re-run / fresh run' },
    { title: 'Review', detail: 'Fable review' },
    { title: 'Report', detail: 'task 552e18cc + #board' },
  ],
}

const TASK = '552e18cc-cdcf-4006-98d6-c090346cab90'

const CONST = `
You are a lane of the apps-ci-hang-fix workflow (2026-08-19, task ${TASK}, HIGH — fix-on-sight chain). The hasna/apps CI 'Install playwright chromium (member browser tests)' step hangs fleet-wide and blocks every merge. Measured 2026-08-19 ~08:4xZ by pr-drain pass 16: #397 merge blocked because green is unverifiable — build+test (affected) in_progress 50+ min hung on that step (run 32228437778); the identical step stuck in run 32223364687 since 06:26:36Z; normal CI runs complete in ~13 min (32224483367, 32221213812); the only terminal state observed on the step was cancellation. Repo: hasna/apps at /home/hasna/workspace/repos/hasna/apps (READ/context only — sync first, work in a task worktree). Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- The monorepo is READ/context only; sync first (git pull, fast-forward). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/ci-hang-fix-<n> from origin/main. PR-first; never push to main. Commits end with 'Agent: apps-ci-fix-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: before any mutation, check task ${TASK} comments and the repo for an existing fixer (open PR touching the CI workflows, or a tracked fix lane). If a fix already landed, verify it and record — do not duplicate. 'gh pr list --repo hasna/apps --search "playwright"' and the task comments are the checks.
- No secrets: never print/capture/commit credential values; staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings in artifacts. Capture path: redirect to files, never pipe large reads. Paste literal output lines.
- Record as you go: comments on ${TASK}, posts to #board, mementos for non-obvious findings. English. Lineage 'conversations agents register' named apps-ci-fix-<your-role>. Distinguish measured vs inferred; state what you did not check.
- The fix must not weaken CI: no 'continue-on-error' on the failing step, no unconditional step skipping, no raising timeouts to hide the stall. The repair makes the step COMPLETE reliably.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). Per the CONST, DO NOT MUTATE. Establish with evidence:
1. Read the CI workflow definition(s) in hasna/apps that contain the 'Install playwright chromium (member browser tests)' step (.github/workflows/*.yml — find the exact step, its run command, timeout config, cache usage, and which job contains it). Record the exact step text.
2. Pull the two hung runs' step logs (gh run view 32228437778 --log-failed or the run's step log via 'gh api repos/hasna/apps/actions/runs/32228437778/jobs' — bounded; find the step's 'started_at' vs 'completed_at' and the last log lines before the stall). Record the last literal lines.
3. Classify the stall: (a) the install command has no timeout and the runner stalls on a network/registry fetch (which registry — playwright CDN, npm?); (b) a cache-key miss forcing a fresh download every run with no progress output; (c) a version pin that no longer resolves (stalled resolution); (d) runner-level issue (self-hosted vs github-hosted — which runner runs this job?). Name the mechanism with the exact evidence.
Return (JSON): { workflowFiles: [string], stepText: string, hungRuns: [{runId, stepStarted, stepCompleted, lastLogLines: string}], mechanism: string, mechanismEvidence: string, residue: [string] }
`

const FIX = CONST + `
ROLE: fix lane. Per the CONST + the investigate verdict: apply the SMALLEST owned repair to the owning workflow definition (PR-first from a task worktree; the step gains what the mechanism requires — bounded timeout with retry for a transient network stall, correct cache key/restore, pinned resolvable version, or the proper install form). Do NOT weaken CI (no continue-on-error, no skip). Commit ('Agent: apps-ci-fix-<your-role>'), push the branch, open the PR referencing ${TASK}.
Return (JSON): { prNumber: number, diffSummary: string, stepAfter: string, mechanismDriven: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Real acceptance per the tier-1 phase model: the affected CI job must COMPLETE the step. Drive it: (a) re-run the affected job on the PR (gh run rerun <failed-run> --job <id> for the existing run, or a fresh run on the PR branch — bounded, pick the cheapest that exercises the step); (b) watch the step to a terminal state (gh run view --json jobs,status — poll bounded, max 25 min); (c) require the step 'completed' with success on the new run. If the hang does NOT reproduce on re-run, record that (with the literal run view output) as the acceptance evidence — the fix plus a clean re-run is the pass. If it hangs again, the fix failed: record the literal state and return acceptanceMet=false with the resume condition.
Return (JSON): { runId: number, jobId: number, stepState: string, stepCompleted: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review: (a) the stall mechanism is established with evidence (run logs + workflow text), (b) the fix is the smallest owned change and does NOT weaken CI (no continue-on-error, no unconditional skip, no timeout raised to hide the stall), (c) the verify drove a REAL CI run to a terminal step state (or honestly recorded a clean non-reproduction), (d) PR-first, no direct pushes, (e) no secrets. Post '[REVIEW] <GO|NO_GO> — apps-ci-hang-fix @ <evidence> — lens: CI step restore, reviewer apps-ci-fix-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const REPORT = CONST + `
ROLE: report. If GO + acceptanceMet: comment ${TASK} completed (mechanism, fix, PR, verify evidence), complete it, post to #board. If NO_GO or acceptance not met: comment findings + resume condition, leave in_progress, post residue to #board. Note on the task: the #397 merge becomes unblocked once this lands (GO at c0b57b50 + base-movement gate already pass — only CI was unverified).
Return (JSON): { taskState: string, residue: [string] }
`

const INV_SCHEMA = { type: 'object', properties: { workflowFiles: { type: 'array' }, stepText: { type: 'string' }, hungRuns: { type: 'array' }, mechanism: { type: 'string' }, mechanismEvidence: { type: 'string' }, residue: { type: 'array' } }, required: ['workflowFiles', 'mechanism', 'hungRuns'] }
const FIX_SCHEMA = { type: 'object', properties: { prNumber: { type: ['number', 'null'] }, diffSummary: { type: 'string' }, stepAfter: { type: 'string' }, mechanismDriven: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { runId: { type: ['number', 'null'] }, jobId: { type: ['number', 'null'] }, stepState: { type: 'string' }, stepCompleted: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const REPORT_SCHEMA = { type: 'object', properties: { taskState: { type: 'string' }, residue: { type: 'array' } }, required: ['taskState'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'ci-fix-investigate', phase: 'Investigate', schema: INV_SCHEMA, model: 'opus' })
log(`investigate: mechanism=${investigate && investigate.mechanism ? investigate.mechanism.slice(0, 100) : '?'}`)

phase('Fix')
let fix = null
if (investigate && investigate.mechanism) {
  fix = await agent(FIX, { label: 'ci-fix-fix', phase: 'Fix', schema: FIX_SCHEMA })
} else {
  fix = { diffSummary: 'none — investigation failed' }
}

phase('Verify')
let verify = null
if (fix && fix.diffSummary !== 'none — investigation failed') {
  verify = await agent(VERIFY, { label: 'ci-fix-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'investigation or fix did not complete', evidence: 'skipped' }
}

phase('Review')
let review = null
if (fix && fix.diffSummary !== 'none — investigation failed') {
  review = await agent(REVIEW, { label: 'ci-fix-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P0', title: 'investigation/fix did not complete', detail: JSON.stringify({ investigate, fix }) }] }
}

phase('Report')
const report = await agent(REPORT, { label: 'ci-fix-report', phase: 'Report', schema: REPORT_SCHEMA })

return { investigate, fix, verify, review, report }
