export const meta = {
  name: 'loops-machine-binding-fix',
  description: 'Fix the @hasna/loops hosted-scheduler lease-without-execution defect: --machine assignment does not persist at create (machineId None), the daemon leases the loop, and it never executes on the assigned machine (task 96c837b0, HIGH, fix-on-sight chain)',
  phases: [
    { title: 'Investigate', detail: 'read apps/loops create+assignment path in hosted mode; why machineId does not persist; daemon lease-vs-execute gap' },
    { title: 'Fix', detail: 'TDD regression first, smallest owned repair, PR-first' },
    { title: 'Verify', detail: 'real acceptance: create-with-machine persists machineId; execution lands on the assigned machine (bounded)' },
    { title: 'Review', detail: 'Fable adversarial review' },
    { title: 'Report', detail: 'task 96c837b0 + #board + sibling-row dedupe update' },
  ],
}

const TASK = '96c837b0-e879-4e62-ab72-747eb5e5f8fc'
const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'

const CONST = `
You are a lane of the loops-machine-binding-fix workflow (2026-08-19, task ${TASK}, HIGH — fix-on-sight chain). The @hasna/loops hosted scheduler LEASES a command loop but NEVER executes it on the assigned machine. Filed with a live artifact: loop 01a019fc3946f09e99dbee23b9ab5669 created on the hosted control plane (loops.hasna.xyz/v1) with --machine station02; 'loops show <id>' returns machineId: None and target.machine: {} (the --machine assignment does NOT persist); the station02 daemon reports a lease on the loop id but zero executions, no run records, empty gate log. Platform: station02, installed @hasna/loops 0.0.49 (the repo is at apps/loops 0.5.1 — installed-version lag is a candidate contributor, measure it). Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/loops-machine-fix-<n> from origin/main. PR-first; never push to main. Commits end with 'Agent: loops-machine-fix-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: before any mutation, check task ${TASK} comments and the repo for an existing fixer (an open PR in hasna/apps touching apps/loops machine/assignment/execution paths — note PR #509 already covers the separate run-now verb gap; 'gh pr list --repo hasna/apps --search "loops"'). If a fix for THIS defect already landed or is being worked, verify it and record — do not duplicate.
- DEDUPE: the sibling rows 94a957aa (active hosted loop overdue with no run) and 67c95be4 (active + past nextRunAt + zero runs, silently) are the same family; the CRITICAL outage row bb5f58ab is coordination/evidence (assigned None). Do NOT create new rows for those families. When the root cause is measured, update 94a957aa/67c95be4 with the mechanism + this fix's PR (comment, then complete only what is genuinely resolved).
- No secrets: never print/capture/commit credential values; consume ONLY via 'secrets exec <key> --as VAR -- <cmd>'. Staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings in artifacts. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on ${TASK}, posts to #board, mementos for non-obvious findings. English. Lineage 'conversations agents register' named loops-machine-fix-<your-role>. Distinguish measured vs inferred; state what you did not check.
- The fix must not weaken the scheduler: no skipping the machine binding, no treating machine-less loops as runnable-anywhere, no masking the silent state. The repair makes create-with-machine persist the assignment AND makes the scheduler refuse to lease what it cannot execute (or execute it on the right machine) — the silent lease-without-execution state must become impossible or loud.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). Per the CONST, DO NOT MUTATE. Establish with evidence:
1. Read the apps/loops code paths: the hosted create verb (POST /v1/loops or equivalent) and how --machine / machineId is (or is not) persisted; the daemon-side claim/lease logic and what happens when a loop has no machine binding; the scheduler's due-slot dispatch and where machine-less loops go. Name the exact files/functions.
2. The assignment loss: trace what happens to the 'machine' field at create in hosted mode — is it dropped by the client (flipped to hosted, field not sent), rejected by the server schema, or stored but not returned? Read both sides.
3. The lease-without-execution: given machineId None, why does the daemon still report a lease? Which code path leases without checking the machine binding? Does the installed daemon version (0.0.49 on station02) differ from the repo (0.5.1) in this path — is a stale install a contributor? Measure installed vs repo.
4. The sibling rows: read 94a957aa and 67c95be4 comments (if any) — is their evidence consistent with the same mechanism? Name what the mechanism explains and what it does not.
5. Candidate mechanisms to confirm or refute (do not assume): (a) client drops the machine field in hosted mode; (b) server schema ignores/does not persist it; (c) daemon leases by loop id without a machine-match check; (d) stale installed daemon predates the binding check. For whichever the evidence supports, name the exact evidence lines.
Return (JSON): { createPath: string, leasePath: string, assignmentLossMechanism: string, leaseWithoutExecutionMechanism: string, staleInstallContributor: {measured: bool, station02Installed: string, repoVersion: string}, siblingConsistency: {94a957aa: string, 67c95be4: string}, mechanism: string, mechanismEvidence: string, residue: [string] }
`

const FIX = CONST + `
ROLE: fix lane. Per the CONST + the investigate verdict: apply the SMALLEST owned repair. TDD FIRST: write the failing regression test that captures the defect (create-with-machine in hosted mode must persist machineId; a machine-less loop must not be leased for execution, or must execute on its binding) — watch it fail, then implement. Repair the owning layer (client field persistence, server schema, or daemon lease guard — whichever the evidence names); do not band-aid (no '|| true', no swallowing the silent state). PR-first from the task worktree, reference ${TASK}, commit ('Agent: loops-machine-fix-<your-role>'), push, open the PR.
Return (JSON): { prNumber: number, diffSummary: string, regressionTests: [string], mechanismDriven: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Real acceptance per the tier-1 phase model — the EXACT failure path must be shown fixed:
1. The regression suite passes (run the touched app's tests, bounded 10 min, record counts).
2. LIVE BOUNDED PROOF on the hosted control plane: create ONE command loop with a distinctive test name (loops-machine-fix-test-<ts>) and --machine <the machine you run this from>, verify 'loops show' now returns machineId/target.machine persisted, watch it execute ONCE (bounded 5 min), then archive/delete the test loop. If the hosted plane cannot be written from here safely, record the exact gate and substitute the strongest evidence (integration tests against the local server store proving the field round-trips, plus the station02 artifacts referenced in the task).
3. FAIL-CLOSED: a machine-less loop (or one whose binding is unsatisfiable) must NOT silently lease-without-execution — it must be refused at lease or loudly recorded. Prove one side of this with a fixture.
Return (JSON): { suitePassed: bool, suiteCounts: {passed, failed}, liveProof: {done: bool, testLoopId: string, machineIdPersisted: bool, executed: bool, cleanedUp: bool}, failClosedProved: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review: (a) the root cause is established with evidence (assignment-loss path + lease path named in code, not inherited), (b) the fix is the smallest owned change with a regression test that FAILED before the fix (TDD proven), (c) the verify proved the exact failure path fixed (suite + live bounded proof or the strongest substitute with the gate named), (d) the silent lease-without-execution state is closed or made loud, (e) PR-first, no direct pushes, no secrets, sibling rows updated. Post '[REVIEW] <GO|NO_GO> — loops-machine-binding-fix @ <evidence> — lens: hosted scheduler restore, reviewer loops-machine-fix-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const REPORT = CONST + `
ROLE: report. If GO + acceptanceMet: comment ${TASK} completed (mechanism, fix, PR, verify evidence), complete it, comment 94a957aa/67c95be4 with the mechanism + fix PR (complete only what is genuinely resolved), post to #board, save a memento. If NO_GO or acceptance not met: comment findings + resume condition, leave in_progress, post residue to #board.
Return (JSON): { taskState: string, siblingRowsUpdated: [string], residue: [string] }
`

const INV_SCHEMA = { type: 'object', properties: { createPath: { type: 'string' }, leasePath: { type: 'string' }, assignmentLossMechanism: { type: 'string' }, leaseWithoutExecutionMechanism: { type: 'string' }, staleInstallContributor: { type: 'object' }, siblingConsistency: { type: 'object' }, mechanism: { type: 'string' }, mechanismEvidence: { type: 'string' }, residue: { type: 'array' } }, required: ['mechanism', 'assignmentLossMechanism', 'leaseWithoutExecutionMechanism'] }
const FIX_SCHEMA = { type: 'object', properties: { prNumber: { type: ['number', 'null'] }, diffSummary: { type: 'string' }, regressionTests: { type: 'array' }, mechanismDriven: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { suitePassed: { type: 'boolean' }, suiteCounts: { type: 'object' }, liveProof: { type: 'object' }, failClosedProved: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const REPORT_SCHEMA = { type: 'object', properties: { taskState: { type: 'string' }, siblingRowsUpdated: { type: 'array' }, residue: { type: 'array' } }, required: ['taskState'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'loops-machine-investigate', phase: 'Investigate', schema: INV_SCHEMA, model: 'opus' })
log(`investigate: ${investigate && investigate.mechanism ? investigate.mechanism.slice(0, 100) : '?'}`)

phase('Fix')
let fix = null
if (investigate && investigate.mechanism) {
  fix = await agent(FIX, { label: 'loops-machine-fix', phase: 'Fix', schema: FIX_SCHEMA })
} else {
  fix = { diffSummary: 'none — investigation failed' }
}

phase('Verify')
let verify = null
if (fix && fix.diffSummary !== 'none — investigation failed') {
  verify = await agent(VERIFY, { label: 'loops-machine-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'investigation or fix did not complete', evidence: 'skipped' }
}

phase('Review')
let review = null
if (fix && fix.diffSummary !== 'none — investigation failed') {
  review = await agent(REVIEW, { label: 'loops-machine-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P0', title: 'investigation/fix did not complete', detail: JSON.stringify({ investigate, fix }) }] }
}

phase('Report')
const report = await agent(REPORT, { label: 'loops-machine-report', phase: 'Report', schema: REPORT_SCHEMA })

return { investigate, fix, verify, review, report }
