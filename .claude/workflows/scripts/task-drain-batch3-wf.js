export const meta = {
  name: 'task-drain-batch3',
  description: 'Task-drain batch 3 (2026-08-19, every-10-min drain pass): five unowned rows dispatched together — (1) loops version endpoint emits retired self_hosted mode (263659dd), (2) incident 713549 stored-content token hit classification (afdfd8a8, read-only), (3) PR 591 deploy checker mutation expectations (a350cc27), (4) PRs 399+400 encrypt-at-rest merge conflicts (111a9755), (5) PR 445 send-suppression semantic conflict (6eb5afc4). Per-lane TDD, Fable review, PR-first',
  phases: [
    { title: 'Fix', detail: 'five lanes: loops mode purge; incident classify; 591 checker; 399+400 compose; 445 compose' },
    { title: 'Review', detail: 'Fable adversarial review per PR' },
    { title: 'Report', detail: 'merge GO PRs, complete rows by evidence, #board' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PROJECT = '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'

const CONST = `
You are a lane of the task-drain-batch3 workflow (2026-08-19, owner-authorized every-10-min task drain in ${MONOREPO}). Five unowned rows are done here, one lane each, PR-first. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/drain3-<n> from origin/main. PR-first; never push to main. Commits end with 'Agent: drain3-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check the row's comments + open PRs touching the package; if a fix already landed or is being worked, verify and record — do not duplicate.
- TDD FIRST where testable: the failing regression before the fix (red proven), then the smallest owned repair. No band-aids.
- No secrets: never print/capture/commit credential values; staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings in artifacts. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the row + PR, posts to #board, mementos for non-obvious findings. English. Lineage 'conversations agents register' named drain3-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const LANE_LOOPS_MODE = CONST + `
ROLE: fix lane for row 263659dd (BUG: @hasna/loops — version endpoint emits retired self_hosted mode). The version endpoint (apps/loops/src/server/version.ts or the route that serves it) still emits the retired deployment-mode vocabulary. Write the failing regression first (the version payload must not contain self_hosted / deployment mode fields), then the smallest owned fix removing the mode emission per the canonical no-modes doctrine (the only technical switch is the server data backend). Run the loops suite (bounded 8 min, record counts), secrets scan, commit ('Agent: drain3-<your-role>'), push, PR referencing 263659dd.
Return (JSON): { prNumber: number|null, regressionTest: string, diffSummary: string, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const LANE_INCIDENT = CONST + `
ROLE: classify lane for row afdfd8a8 (INCIDENT 713549 — package_registry_token detector hit at line 34658 of a full-project Todos task export). THIS LANE IS READ-ONLY UNLESS A SCRUB IS OWED. Steps: (1) locate the stored task content carrying the hit — scan path only ('secrets scan input' against exported JSON, or the todos CLI's own read surfaces); NEVER print, capture, or paste the value, NEVER 'secrets get --show'; (2) classify: real live credential vs synthetic placeholder vs docs sample — record which detector shape fired and where; (3) if synthetic/placeholder: record the false-positive classification on the row and STOP (no PR); (4) if real: do NOT scrub inline — record the exact task id + blast radius on the row and open a PR ONLY for the owning-package guard (a bounded export/redaction guard in apps/todos) if one does not already exist, referencing the row. Accept: classification + evidence on the row, zero value exposure anywhere.
Return (JSON): { classification: 'synthetic'|'real'|'unresolved', taskId: string|null, detector: string, prNumber: number|null, diffSummary: string, evidence: string }
`

const LANE_591 = CONST + `
ROLE: fix lane for row a350cc27 (PR 591 — deploy checker mutation expectations vs new deploy-todos.yml shape). Measured (drain pass 27, wf_d7cfe7af-d08): PR #591 rebase onto 44595dd3d composes textually (candidate ed915062bb) but the checker self-test fails 2 mutations ('host bun invoked with no bun installed', 'host bun installed only after it is used'); main replaced the host bun version-read step with node -p at deploy-todos.yml:255, so the checker's exits-127 guard has no host-bun invocation to pin. OWED: (a) update the checker's mutation expectations to the new file shape (TDD red first — write the two failing mutations, prove they now fail for the WRONG reason, then fix), (b) re-run the checker self-test green, (c) re-rebase PR #591 onto current origin/main, push --force-with-lease, verify self-test green at the new head. Do not change deploy-todos.yml behavior. PR referencing a350cc27 + #591.
Return (JSON): { prNumber: number|null, rebaseNewHead: string|null, rebased: bool, selfTestGreen: bool, diffSummary: string, evidence: string }
`

const LANE_399_400 = CONST + `
ROLE: fix lane for row 111a9755 (PRs 399+400 — post-encrypt-at-rest merge conflicts). Measured (drain pass 27): 399 aborts with 5 files/11 hunks both-sides conflicts (main encrypt-at-rest vs the PR's baseUrl work: store.ts same-line fields, cloud-v1.ts same-spread, upload.ts --internal vs --encrypt guards, app.ts 6 hunks, app.upload.test.ts whole-describe-block); 400 aborts with 4 files (main encrypt vs the PR's require_email/allowed_emails: cloud-v1.ts, store.ts, app.ts 5 hunks, cloud-v1.test.ts whole-block). OWED: compose BOTH changes on each branch — preserve the PR's feature AND main's encrypt-at-rest on the same files — resolving in favor of both features (a real both-sides merge, not a discard), run the attachments suite green (record counts), secrets scan, push --force-with-lease on each PR's own branch, verify CI state. PRs referencing 111a9755.
Return (JSON): { prs: [{number, rebased: bool, newHead: string, conflict: string|null, suiteCounts: {passed, failed}}], evidence: string }
`

const LANE_445 = CONST + `
ROLE: fix lane for row 6eb5afc4 (PR 445 — send-suppression semantic conflict). Measured (drain pass 27): rebase aborts with 4 files semantic both-sides conflicts — send-suppression.test.ts directly contradicts (main asserts --force sends on the API client, the PR asserts 409 refusal), send.ts 3 hunks (opposite --force wording + one PR-only hunk), inbox.api.ts rename+import collision, v1-stub.ts same-line DEFAULT_API_KEY value. OWED: determine the PR's intended --force semantics from its OWN description and diff (the PR is the authority on its intent; main is the authority on the new send path), compose both — if the PR's semantics are preserved by main's new behavior, align the PR to main and record; if the PR genuinely changes --force behavior that main now contradicts, keep the PR's intent and note the semantic decision in the PR body for the reviewer. Run the emails suite green (record counts), secrets scan, push --force-with-lease on the PR's branch, verify CI. PR referencing 6eb5afc4.
Return (JSON): { prNumber: number, rebased: bool, newHead: string, semanticDecision: string, suiteCounts: {passed, failed}, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PRs ({PRS}): (a) each regression FAILED before the fix (red proven), (b) smallest owned repair, (c) suites green or failures recorded with owners, (d) secrets clean, (e) PR-first, (f) for 399/400/445: both features present (no silent discard of either side). Post '[REVIEW] <GO|NO_GO> — drain3 <item> @ <sha> — lens: task-drain batch 3, reviewer drain3-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { prs: [{number, verdict, findings: [{severity, title, detail}]}] }
`

const REPORT = CONST + `
ROLE: report. For each GO PR: merge (base-movement gate first; gh pr merge --squash --body-file ending 'Agent: drain3-ship'), complete the row with the fix + merged sha. NO_GO: comment findings + resume condition, leave in_progress. For the incident row (afdfd8a8): record its classification outcome (no merge). Post one #board line per outcome.
Return (JSON): { rows: [{rowId, prNumber, verdict, merged, mergedSha, rowState}], residue: [string] }
`

const LANE_SCHEMA = { type: 'object', properties: { prNumber: { type: ['number', 'null'] }, regressionTest: { type: 'string' }, diffSummary: { type: 'string' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, rebaseNewHead: { type: ['string', 'null'] }, rebased: { type: 'boolean' }, selfTestGreen: { type: 'boolean' }, prs: { type: 'array', items: { type: 'object' } }, semanticDecision: { type: 'string' }, classification: { type: 'string' }, taskId: { type: ['string', 'null'] }, detector: { type: 'string' }, evidence: { type: 'string' } }, required: ['diffSummary'] }
const REVIEW_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REPORT_SCHEMA = { type: 'object', properties: { rows: { type: 'array', items: { type: 'object' } }, residue: { type: 'array' } }, required: ['rows'] }

phase('Fix')
const [lLoops, lIncident, l591, l399, l445] = await parallel([
  () => agent(LANE_LOOPS_MODE, { label: 'drain3-loops-mode', phase: 'Fix', schema: LANE_SCHEMA }),
  () => agent(LANE_INCIDENT, { label: 'drain3-incident', phase: 'Fix', schema: LANE_SCHEMA }),
  () => agent(LANE_591, { label: 'drain3-591', phase: 'Fix', schema: LANE_SCHEMA }),
  () => agent(LANE_399_400, { label: 'drain3-399-400', phase: 'Fix', schema: LANE_SCHEMA }),
  () => agent(LANE_445, { label: 'drain3-445', phase: 'Fix', schema: LANE_SCHEMA }),
])
const lanePrs = [lLoops, l591, l399, l445].filter(Boolean)
  .flatMap(l => (l.prs || [{ prNumber: l.prNumber, diff: l.diffSummary }]).filter(p => p.prNumber))
log(`fix lanes: ${lanePrs.map(p => '#' + p.prNumber).join(', ') || 'none opened'}`)

phase('Review')
let review = null
if (lanePrs.length) {
  review = await agent(REVIEW.replace('{PRS}', JSON.stringify(lanePrs)), { label: 'drain3-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { prs: [] }
}

phase('Report')
const report = await agent(REPORT, { label: 'drain3-report', phase: 'Report', schema: REPORT_SCHEMA })

return { loopsMode: lLoops, incident: lIncident, pr591: l591, prs399400: l399, pr445: l445, review, report }
