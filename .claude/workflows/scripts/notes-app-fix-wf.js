export const meta = {
  name: 'notes-app-fix',
  description: 'Owner brief 2026-08-19 (task e8349538): Hasna Notes macOS app — Fable analyzes the code, decides the fix per requirement and CREATES the todos tasks; worker lanes implement them; Fable review per PR; ship + live test. Requirements: recording screen (no recents, pause+timer only, smaller input), cloud-only, glass sidebar, home higher, header row with updated-just-now, bottom-center recording popover, inline label edit, trash-only icons, settings fix, "Hasna Notes" title',
  phases: [
    { title: 'Analyze', detail: 'Fable: read the notes app code (macOS UI + backend), map each owner requirement to the exact code surface, decide the fix, CREATE one todos task per requirement' },
    { title: 'Implement', detail: 'worker lanes per created task, worktree + PR-first, TDD where the change is testable' },
    { title: 'Review', detail: 'Fable adversarial review per PR (bounded, two-cycle cap)' },
    { title: 'Ship', detail: 'merge GO PRs with base gate, build the macOS app, live-test on the macOS station' },
    { title: 'Report', detail: 'per-task state, PRs, live-test evidence, owner acceptance handoff' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const TASK = 'e8349538-7a4e-40a3-ba70-83bd66e918fc'

const CONST = `
You are a lane of the notes-app-fix workflow (2026-08-19, task ${TASK}, HIGH — OWNER UX BRIEF, verbatim below). The owner's Hasna Notes macOS app must be fixed per his exact requirements. Final text = machine-readable JSON.

OWNER REQUIREMENTS (verbatim intent, 2026-08-19):
1. RECORDING SCREEN: when recording on the main screen, the recent files must NOT be visible — recents disappear; only the pause button and the timer stay; the input field must be smaller (it is full-width now — not acceptable).
2. CLOUD-ONLY: notes must live in the cloud; NOT cross-machine, NOT local. (Compose with the notes two-backend storage work; the app's storage must be the hosted path.)
3. SIDEBAR: currently purple — must be the ORIGINAL glass design, slightly transparent (SwiftUI material/vibrancy, not a purple fill).
4. HOME PAGE: should sit a bit higher; the sidebar has too much top margin / header space — tighten it.
5. NOTE HEADER: 'Updated just now' must be on the top header line, horizontally aligned with the copy button, trash button, comments button and minimize button — one row.
6. RECORDING POPOVER: the timer popover that shows recording state must appear at the BOTTOM CENTER of the page (not the middle vertical line); it must stay visible while recording AND while adding a new note.
7. LABELS: double-click (or right-click) on a label edits it INLINE.
8. TRASH/ARCHIVE: trash and archive sit on the same row as settings, as ICONS (no label text); archive and trash are BLENDED into just TRASH; trash is never deleted for now (soft delete / hidden state only).
9. SETTINGS: the settings page does not work at all — it must work.
10. APP TITLE: 'Hasna Notes' (with the space), never 'HasnaNotes'.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in task worktrees ~/.hasna/repos/worktrees/apps/notes-fix-<n> from origin/main. PR-first; never push to main. Commits end with 'Agent: notes-fix-<your-role>' (the ONLY attribution line). The macOS app source lives in the notes app (locate it: apps/notes — the Swift app dir; if it is a separate Swift package location, resolve it with the repos CLI semantics and name the exact path in the analysis).
- IDEMPOTENCY CHECK FIRST: before any mutation, check task ${TASK} comments and open PRs touching the notes app for an existing lane; if work already landed or is being worked, verify and record — do not duplicate.
- The ANALYSIS is Fable's job (owner explicit: 'Fable has to analyze and decide how to be fixed and create tasks'): the Analyze lane reads the code and maps EVERY requirement to an exact code surface + fix decision + one todos task per requirement (created in the oss-apps project, assigned marcellus, referencing ${TASK}). 'And then those tasks should be done by the agents': the Implement lanes execute those created tasks.
- Proper review steps (owner explicit): every PR gets the bounded Fable adversarial review; at most two remediation cycles; GO at exact head + base-movement gate before merge.
- No secrets: never print/capture/commit credential values; staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings in artifacts. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on ${TASK} and each created task, posts to #board, mementos for non-obvious findings. English. Lineage 'conversations agents register' named notes-fix-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const ANALYZE = CONST + `
ROLE: analyze lane (Fable). Per the CONST: read the notes app code (the macOS Swift UI + its storage/backend layer). For EACH of the 10 owner requirements: name the exact file/function/view that must change, the fix decision (how it will be fixed), and CREATE one todos task in the oss-apps project (title 'NOTES-FIX <requirement>: <short>', assigned marcellus, priority high for 1/2/5/6/8/9, medium otherwise, description = the requirement verbatim + the code surface + the fix decision, referencing ${TASK}). Verify the cloud-only requirement against the actual storage path (is the app already hosted-only? the two-backend storage work is in flight — record what the app currently does and what the cloud-only requirement needs). Also confirm/record the current app title string. Return the created task ids.
Return (JSON): { tasks: [{id, requirement, codeSurface, fixDecision}], cloudOnlyStatus: string, appTitleCurrent: string, residue: [string] }
`

const IMPLEMENT = CONST + `
ROLE: implement lanes. Per the CONST + the analysis ({ANALYSIS}): execute the CREATED tasks ({TASK_IDS}) — one lane per task (or grouped lanes where requirements share one surface, max 6 concurrent): worktree, implement the fix decision, TDD where the change is testable (Swift UI unit tests where the repo has a test target; backend changes follow the repo's test pattern), 'bun run check' where the change touches the monorepo surface, secrets scan, commit ('Agent: notes-fix-<your-role>'), push, PR per task referencing the task id + ${TASK}. Do NOT touch surfaces another lane is editing (state your lane's files).
Return (JSON): { prs: [{taskId, prNumber, diffSummary, files: [string], tests: {passed, failed}}] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Per the CONST: review each PR ({PRS}): the change matches the owner requirement it claims (verbatim requirement in the task), the fix is the smallest owned change, tests green or recorded, no secrets, PR-first. Post '[REVIEW] <GO|NO_GO> — notes-fix <req> @ <sha> — lens: owner UX brief, reviewer notes-fix-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { prs: [{number, verdict, findings: [{severity, title, detail}]}] }
`

const SHIP = CONST + `
ROLE: ship lane. Per the CONST + the verdicts: merge every GO PR (base-movement gate first; gh pr merge --squash --body-file ending 'Agent: notes-fix-ship'); then BUILD the macOS app from the merged main (xcodebuild or the repo's build script — bounded 25 min; record the build result) and install/launch it on the macOS station (station03) for the owner; record the live-test evidence for the UI requirements that are verifiable headlessly (title string, header row layout via the built app's Info.plist/strings) and hand the visual requirements (glass sidebar, popover position, recents-hidden) to the owner with the exact build to run.
Return (JSON): { merged: [{prNumber, sha}], buildOk: bool, appPath: string, liveEvidence: string, ownerHandoff: string }
`

const REPORT = CONST + `
ROLE: report. Aggregate per-task state (task id, requirement, PR, merged), the build + live-test result, and the owner handoff (which requirements need his eyes, with the exact app path). Comment ${TASK} + each created task with the outcome; post the summary to #board; save a memento.
Return (JSON): { tasks: [{id, requirement, prNumber, state}], buildOk: bool, ownerHandoff: string, residue: [string] }
`

const ANALYZE_SCHEMA = { type: 'object', properties: { tasks: { type: 'array', items: { type: 'object' } }, cloudOnlyStatus: { type: 'string' }, appTitleCurrent: { type: 'string' }, residue: { type: 'array' } }, required: ['tasks'] }
const IMPLEMENT_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REVIEW_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'array' }, buildOk: { type: 'boolean' }, appPath: { type: 'string' }, liveEvidence: { type: 'string' }, ownerHandoff: { type: 'string' } }, required: ['buildOk'] }
const REPORT_SCHEMA = { type: 'object', properties: { tasks: { type: 'array' }, buildOk: { type: 'boolean' }, ownerHandoff: { type: 'string' }, residue: { type: 'array' } }, required: ['tasks'] }

phase('Analyze')
const analysis = await agent(ANALYZE, { label: 'notes-analyze', phase: 'Analyze', schema: ANALYZE_SCHEMA, model: 'fable' })
log(`analyze: ${analysis && analysis.tasks ? analysis.tasks.length + ' tasks created' : 'FAILED'}`)

phase('Implement')
let implement = null
if (analysis && analysis.tasks && analysis.tasks.length) {
  implement = await agent(IMPLEMENT.replace('{ANALYSIS}', JSON.stringify(analysis)).replace('{TASK_IDS}', JSON.stringify(analysis.tasks.map(t => t.id))), { label: 'notes-implement', phase: 'Implement', schema: IMPLEMENT_SCHEMA })
} else {
  implement = { prs: [] }
}

phase('Review')
let review = null
if (implement && implement.prs && implement.prs.length) {
  review = await agent(REVIEW.replace('{PRS}', JSON.stringify(implement.prs)), { label: 'notes-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { prs: [] }
}

phase('Ship')
let ship = null
const goPrs = (review && review.prs || []).filter(p => p.verdict === 'GO')
if (goPrs.length) {
  ship = await agent(SHIP, { label: 'notes-ship', phase: 'Ship', schema: SHIP_SCHEMA })
} else {
  ship = { merged: [], buildOk: false, appPath: 'none', liveEvidence: 'no GO PRs to ship', ownerHandoff: 'review verdicts pending' }
}

phase('Report')
const report = await agent(REPORT, { label: 'notes-report', phase: 'Report', schema: REPORT_SCHEMA })

return { analysis, implement, review, ship, report }
