export const meta = {
  name: 'skills-plan-successors',
  description: 'Bounded-review adjudication: ONE materially-new successor per terminated skills-plan candidate (T8 writeCorpusSkill invariant, T9 sync verb, T13 docs P1) with FRESH review cycles',
  phases: [
    { title: 'Successor', detail: '3 lanes: new candidates from the retained fixes, fresh codewith review, merge on GO' },
    { title: 'Report', detail: 'per-task successor outcome' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PLAN = '8022d27f-fc09-437a-aa72-93eb8ad9517c'

const CONST = `
You are a lane of the skills-plan-successors workflow (plan ${PLAN}). The plan's T8 (revision/optimistic-concurrency/tombstone contract), T9 (cloud sync reconcile verb) and T13 (architecture docs + open-core boundary) were TERMINATED at the bounded-review cap (third NO_GO each; candidates non-mergeable). The policy allows AT MOST ONE adjudicated successor per lineage — a MATERIALLY NEW candidate addressing the named blockers, with a FRESH review cycle. This workflow creates exactly those three successors. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull; never discard local work). Work in task worktrees ~/.hasna/repos/worktrees/apps/skills-succ-<n> from origin/main. Never push to main. New SUCCESSOR branches/PRs only (plan/skills-<task>-successor-<n>) — never re-open or force-push a terminated PR. Merges ONLY via gh pr merge <n> --squash --body-file <file whose LAST line is 'Agent: skills-successor'>.
- IDEMPOTENCY CHECK FIRST: if the task is completed (successor merged) or a successor PR already exists open, skip.
- CAPACITY RULE: codewith review 'Selected model is at capacity' -> switch to a fresh healthy profile (sweep ~/.codewith/auth_profiles, codewith usage --auth-profile <p> | grep Healthy); two capacity failures on different accounts = review-unavailable -> SKIP (never merge unreviewed).
- No secrets; no internal-infra strings. Staged secrets scan before every commit/push. Capture path: redirect to files, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the task rows, posts to #board. English. Lineage identity 'conversations agents register' named skills-successor-<role>.
`

const SUCC_T8 = CONST + `
ROLE: T8 successor lane (Sonnet). TASK d061fcda (revision + optimistic-concurrency + tombstone contract). The terminated candidate's third-NO_GO fix (writeCorpusSkill trailing-newline revision-proof invariant) is IMPLEMENTED AND TESTED LOCALLY (1304 pass) but UNPUSHED in the worktree from the terminated lineage. Find that worktree (~/.hasna/repos/worktrees/apps/skills-*d061fcda* or the branch plan/d061fcda on origin), verify the local fix's tests, then create the SUCCESSOR candidate: a new branch plan/skills-d061fcda-successor-1 from current origin/main carrying the terminated candidate's merged-ready content PLUS the third-NO_GO fix (writeCorpusSkill revision-proof invariant). The successor MUST address the three earlier NO_GO blocker classes: updateSkill race maps to 409; tombstone 410 never deletes unmanaged local skills; pull proves revision from installed content; purged slug reported not bundled swap. Regression tests FIRST for each. Run the skills suite (bounded 10 min), secrets scan, commit ('Agent: skills-successor-t8' trailer LAST), push, open the successor PR. Then run a FRESH codewith review of the successor head (healthy profile, gpt-5.6-sol xhigh, capacity-switch rule) and merge on GO (gh pr merge --squash --body-file trailer). NO_GO -> remediate the named findings, re-review (fresh cycles, <=2), third NO_GO terminates THIS successor and the lineage closes.
Return (JSON): { task: 'd061fcda', successorPr: {number, headSha, merged: bool, mergedSha}, reviewVerdict, tests: {passed, failed} }
`

const SUCC_T9 = CONST + `
ROLE: T9 successor lane (Sonnet). TASK 9df1ea14 (cloud sync reconciliation verb --push/--pull/--all/--dry-run/conflict policy). The terminated candidate's branch plan/9df1ea14 retains the remediation-cycle fixes; PR hasna/apps#382 is open at that head. Create the SUCCESSOR: a new branch plan/skills-9df1ea14-successor-1 from current origin/main carrying the retained fixes (cherry-pick the remediation commits from plan/9df1ea14) as a materially-new candidate. The successor MUST address the three NO_GO blocker classes recorded on the task (read the task comments for the exact findings). Regression tests FIRST for each blocker class. Run the skills suite (bounded 10 min), secrets scan, commit ('Agent: skills-successor-t9' trailer LAST), push, open the successor PR. FRESH codewith review of the successor head (healthy profile, gpt-5.6-sol xhigh, capacity-switch rule), merge on GO. NO_GO -> remediate named findings, re-review (<=2 fresh cycles), third NO_GO terminates THIS successor and the lineage closes. Close the OLD terminated PR #382 with a comment pointing at the successor (it is non-mergeable per policy).
Return (JSON): { task: '9df1ea14', successorPr: {number, headSha, merged: bool, mergedSha}, reviewVerdict, tests: {passed, failed} }
`

const SUCC_T13 = CONST + `
ROLE: T13 successor lane (Sonnet). TASK 55140781 (reconcile architecture docs + record open-core boundary). The terminated candidate's verified open P1: docs/open-core-saas-pattern.md classifies browse/list as local-only while src/cli/commands/list.ts getBrowseRegistry MERGES the configured API registry (the docs misclassify the behavior). Create the SUCCESSOR: a new branch plan/skills-55140781-successor-1 from current origin/main fixing the named P1 (docs corrected to match getBrowseRegistry behavior + any doc/tests the correction requires) — a materially-new candidate. Regression test FIRST where behavior is documented. Run the skills suite (bounded 8 min), secrets scan, commit ('Agent: skills-successor-t13' trailer LAST), push, open the successor PR. FRESH codewith review (healthy profile, gpt-5.6-sol xhigh, capacity-switch rule), merge on GO. NO_GO -> remediate named findings, re-review (<=2 fresh cycles), third NO_GO terminates THIS successor and the lineage closes. Close the OLD terminated PR #390 with a comment pointing at the successor.
Return (JSON): { task: '55140781', successorPr: {number, headSha, merged: bool, mergedSha}, reviewVerdict, tests: {passed, failed} }
`

const REPORT = CONST + `
ROLE: report. Per-task successor outcome (merged sha / terminated-closed), what remains. Comment each task row, post to #board.
Return (JSON): { tasks: [{id, state, successorPr, mergedSha}], followUps: [string] }
`

const SUCC_SCHEMA = { type: 'object', properties: { task: { type: 'string' }, successorPr: { type: 'object' }, reviewVerdict: { type: ['string', 'null'] }, tests: { type: 'object' } }, required: ['task'] }
const REPORT_SCHEMA = { type: 'object', properties: { tasks: { type: 'array' }, followUps: { type: 'array' } }, required: ['tasks'] }

phase('Successor')
const t8 = await agent(SUCC_T8, { label: 'succ-t8', phase: 'Successor', schema: SUCC_SCHEMA, model: 'sonnet' })
const t9 = await agent(SUCC_T9, { label: 'succ-t9', phase: 'Successor', schema: SUCC_SCHEMA, model: 'sonnet' })
const t13 = await agent(SUCC_T13, { label: 'succ-t13', phase: 'Successor', schema: SUCC_SCHEMA, model: 'sonnet' })

phase('Report')
const report = await agent(REPORT, { label: 'succ-report', phase: 'Report', schema: REPORT_SCHEMA, model: 'sonnet' })

return { t8, t9, t13, report }
