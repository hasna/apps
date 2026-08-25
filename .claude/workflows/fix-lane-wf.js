export const meta = {
  name: 'fix-lane',
  description: 'Standing task-drain fix lane for ONE unowned BUG/INCIDENT row: Investigate -> Fix -> Verify -> Fable Review -> Report. IDEMPOTENCY CHECK FIRST: stop if already fixed at head, a live fixer/PR exists, or the row is no longer pending. Worktree + PR-first + staged secrets scan + one Fable adversarial review (bounded, two remediation cycles), then comment the row and post one line to #board.',
  phases: [
    { title: 'Investigate', detail: 'IDEMPOTENCY CHECK FIRST, then read the row + comments, reproduce, name the root cause' },
    { title: 'Fix', detail: 'smallest owned fix in a task worktree, regression test first, PR' },
    { title: 'Verify', detail: 'real acceptance path at the exact PR head' },
    { title: 'Review', detail: 'one Fable adversarial review of the exact candidate, at most two remediation cycles' },
    { title: 'Report', detail: 'comment the row with evidence, save a memento, one line on #board' },
  ],
}

// args: { taskId, scope, summary } — set at dispatch by the task-drain pass
const TASK_ID = args.taskId
const SCOPE = args.scope
const SUMMARY = args.summary

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    idempotency: {
      type: 'object',
      properties: {
        rowStillPending: { type: 'boolean' },
        noLiveFixer: { type: 'boolean' },
        noOpenFixPR: { type: 'boolean' },
        defectReproducesAtHead: { type: 'boolean' },
      },
      required: ['rowStillPending', 'noLiveFixer', 'noOpenFixPR', 'defectReproducesAtHead'],
    },
    rootCause: { type: 'string' },
    fixPlan: { type: 'string' },
    evidence: { type: 'string' },
    repairClass: { type: 'string', enum: ['code-fix', 'operational'] },
  },
  required: ['idempotency', 'rootCause', 'fixPlan', 'evidence', 'repairClass'],
}

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    branch: { type: 'string' },
    prNumber: { type: 'number' },
    headSha: { type: 'string' },
    changedPaths: { type: 'array', items: { type: 'string' } },
    secretsScan: { type: 'string' },
  },
  required: ['branch', 'prNumber', 'headSha', 'changedPaths', 'secretsScan'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    acceptanceCommand: { type: 'string' },
    acceptanceOutput: { type: 'string' },
    acceptanceOk: { type: 'boolean' },
  },
  required: ['acceptanceCommand', 'acceptanceOutput', 'acceptanceOk'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['GO', 'NO_GO'] },
    findings: { type: 'array', items: { type: 'string' } },
    cyclesUsed: { type: 'number' },
  },
  required: ['verdict', 'findings', 'cyclesUsed'],
}

phase('Investigate')
const plan = await agent(
  `You are the INVESTIGATE phase of a fix lane for todos row ${TASK_ID} (scope: ${SCOPE}).
Task title/summary: ${SUMMARY}

IDEMPOTENCY CHECK FIRST — before any investigation work, verify ALL of:
1. The row ${TASK_ID} is still pending and unowned (re-read it via the todos CLI; an exact-line short-id match in /tmp/task-drain-seen.txt naming this lane counts as unowned).
2. NO live fixer: no in_progress row, no open PR, no branch, no workflow run already repairing this exact defect (search todos comments + open PRs on the owning repo; a comment naming a workstream or an open PR touching the same package = live).
3. The defect still reproduces at CURRENT origin/main HEAD (pull the repo first; if the defect is already fixed at head, that is a legitimate stop).
If ANY of 1-3 fails, STOP: do not write code, do not open a PR. Report which check failed and the evidence.

If the checks pass: read the full row (todos show ${TASK_ID}) INCLUDING ITS COMMENTS — the comments carry the diagnosis and any prescribed remedy. Reproduce the defect at head and name the ROOT CAUSE (not the symptom). Then produce:
- idempotency: the four booleans from the checks above
- rootCause: one or two sentences, evidence-backed
- fixPlan: the smallest owned fix, named files/commands
- evidence: the exact reproduce command and its output (paste the output line, never a paraphrase)

Rules: read-only investigation; never mutate a shared checkout — any file mutation happens later in the Fix phase, inside a task worktree.`,
  { label: `investigate:${TASK_ID}`, phase: 'Investigate', model: 'opus', schema: PLAN_SCHEMA },
)

if (!plan || !plan.idempotency || !plan.idempotency.rowStillPending || !plan.idempotency.noLiveFixer || !plan.idempotency.noOpenFixPR || !plan.idempotency.defectReproducesAtHead) {
  const reason = plan && plan.idempotency
    ? Object.entries(plan.idempotency).filter(([, v]) => v === false).map(([k]) => k).join(', ')
    : 'idempotency check could not complete'
  log(`fix-lane ${TASK_ID}: IDEMPOTENCY STOP (${reason}) — no fix dispatched`)
  return { outcome: 'idempotency-stop', taskId: TASK_ID, reason }
}

phase('Fix')
const fix = await agent(
  `You are the FIX phase of a fix lane for todos row ${TASK_ID} (scope: ${SCOPE}).
Root cause from the investigate phase: ${plan.rootCause}
Fix plan: ${plan.fixPlan}
Repro evidence: ${plan.evidence}

REPAIR CLASS BRANCH — the investigate phase classified the repair as ${plan.repairClass}:
- If OPERATIONAL (a sanctioned CLI/state repair with NO code change — e.g. unfreezing store rows through a documented verb): DO NOT create a worktree, test, or PR. Execute the exact sanctioned command(s) with before/after evidence (state captured pre and post mutation), verify the outcome against the real acceptance path, and report branch='operational', prNumber=null, headSha=null, changedPaths=[], secretsScan=<before/after evidence pointer>. If no sanctioned repair path exists, STOP and report the mechanism (never mutate blind).
- If CODE-FIX (a package/source change): follow steps 1-7.

Implement the smallest owned fix (CODE-FIX path):
1. Create a task-specific worktree at $HOME/.hasna/repos/worktrees/hasna-apps/<task-short>/ via the repos CLI worktree verb (or git worktree add at exactly that path), branched from CURRENT origin/main (pull first; never a shared checkout, never a stale base). Run repos scan after creating the worktree.
2. Write a failing regression test FIRST where a test surface exists for this defect; confirm it fails; then implement the root-cause fix (never the symptom, never a workaround).
3. Keep the diff to the fix and its test only. No unrelated cleanup.
4. Run the owning repo's check/tests for the affected lanes.
5. Staged secrets scan MUST be clean before commit: secrets scan staged (redirect to a file, read rc and bytesScanned). rc=0 AND bytesScanned > 0 required.
6. Conventional commit (fix: <row short id> — <one line>), then push the branch and open a PR against main referencing todos row ${TASK_ID}. Never push to main directly.
7. Post [BREAKING] to announcements FIRST only if the change affects other agents or machines; otherwise skip.

Report: branch, PR number, head sha, changed paths, and the exact secrets-scan rc/bytesScanned line.`,
  { label: `fix:${TASK_ID}`, phase: 'Fix', schema: FIX_SCHEMA },
)

phase('Verify')
const verify = await agent(
  `You are the VERIFY phase of a fix lane for todos row ${TASK_ID} (scope: ${SCOPE}).
The fix is PR #${fix ? fix.prNumber : '?'} @ ${fix ? fix.headSha : '?'} (${fix ? fix.changedPaths.join(', ') : ''}).

Run the REAL acceptance path that originally failed — the exact user-visible command from the investigate phase (${plan.evidence}) against the PR head (in the worktree, at the PR branch). A focused test supports this proof; it does not replace it. Also confirm the PR's CI checks for the affected lanes are green at head, and the base has not moved under the review (if main moved since the branch was cut, rebase first so the merged result is what you verified).
If acceptance fails, iterate the fix IN THE SAME WORKTREE (new commits on the branch) and re-verify until the real path passes — this is an acceptance gate, not a review cycle.
Report the exact command, the actual output line, and the pass/fail result.`,
  { label: `verify:${TASK_ID}`, phase: 'Verify', schema: VERIFY_SCHEMA },
)

phase('Review')
const review = await agent(
  `You are the INDEPENDENT FABLE ADVERSARIAL REVIEWER of the fix for todos row ${TASK_ID} (scope: ${SCOPE}).
Candidate: PR #${fix ? fix.prNumber : '?'} @ ${fix ? fix.headSha : '?'}, changed paths ${fix ? fix.changedPaths.join(', ') : '?'}.
Root cause claimed: ${plan.rootCause}. Acceptance evidence: ${verify ? verify.acceptanceOutput : 'MISSING'}.

Review the EXACT candidate at head (pull the PR branch fresh; verify the sha). Challenge: does the change fix the root cause or the symptom? Does the regression test actually fail on the old code and pass on the new? Does acceptance evidence match the claim (paste the raw line)? Any secrets, scope creep, or base-movement hazard (per the PR-base-change rule)? Then return one verdict: GO (no open P0/P1) or NO_GO (concrete, evidence-backed, reachable P0/P1 findings only). At most two remediation cycles total in this lane — the fixer fixes only your named defects and their direct regressions, then you re-review ONLY those.`,
  { label: `review:${TASK_ID}`, phase: 'Review', model: 'fable', schema: REVIEW_SCHEMA },
)

if (review && review.verdict === 'NO_GO') {
  log(`fix-lane ${TASK_ID}: NO_GO — ${review.findings.join('; ')} (cycles ${review.cyclesUsed})`)
  return { outcome: 'no-go', taskId: TASK_ID, findings: review.findings }
}

phase('Report')
const report = await agent(
  `You are the REPORT phase of a fix lane for todos row ${TASK_ID} (scope: ${SCOPE}).
PR #${fix ? fix.prNumber : '?'} @ ${fix ? fix.headSha : '?'} has a GO verdict. The fix lane already: fixed the root cause (${plan.rootCause}), verified the real acceptance path (${verify ? verify.acceptanceOutput : 'MISSING'}), and passed independent Fable review.

MERGE the exact reviewed head (gh pr merge <n> --squash --body-file with the Agent: trailer as the last line, naming the registered agent identity). Then:
1. Comment todos row ${TASK_ID}: one line — root cause, PR number, merge sha, acceptance evidence line (no ids without their meaning).
2. If the merged fix changes installed behavior (package/bin/CLI), it is now publishable — the publish-all lane is the ONLY publisher; do NOT publish. Leave the row pending-with-merge-evidence so publish-all/ship-latest picks it up; the row completes only after the shipped version is verified installed.
3. Save a memento under fix-lane-${TASK_ID}: root cause + fix + evidence (one or two sentences).
4. Post ONE line to #board: "fix-lane ${TASK_ID}: <scope> — PR #<n> merged <sha>, <acceptance line>".
Report the merge sha and the #board message id.`,
  { label: `report:${TASK_ID}`, phase: 'Report' },
)

return { outcome: 'fixed', taskId: TASK_ID, prNumber: fix && fix.prNumber, headSha: fix && fix.headSha, mergeSha: report || null }
