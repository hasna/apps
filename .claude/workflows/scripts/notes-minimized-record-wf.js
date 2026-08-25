export const meta = {
  name: 'notes-minimized-record',
  description: 'Owner 2026-08-19 (row 9ec010a2, NOTES-FIX 11): when the Notes macOS app is minimized, recording must stay available — the minimized window must offer the recording affordance, not only the note composer. Fable analyze the window-state/recording path, implement, Fable review, ship + live test on station03',
  phases: [
    { title: 'Analyze', detail: 'Fable: the minimize path + what the minimized window shows; decide the recording affordance surface' },
    { title: 'Implement', detail: 'recording entry available in the minimized state; TDD where testable' },
    { title: 'Review', detail: 'Fable adversarial review' },
    { title: 'Ship', detail: 'merge, build+install on station03, live test the minimized recording' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '9ec010a2'

const CONST = `
You are a lane of the notes-minimized-record workflow (2026-08-19, owner-authorized). Owner: 'for the Notes app when I minimize it, I should also be able to record stuff. Because right now it's only asking me to add notes. It's not cool.' Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/notesmin-<n> from origin/main. PR-first; never push to main. Commits end with 'Agent: notesmin-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check ${ROW} comments + open PRs touching apps/notes; do not duplicate.
- THE FIX: when the macOS app window is minimized (and while minimized), the user can start/see a recording — the minimized surface offers the recording affordance (mic/record), NOT only the note composer. The Fable analyze phase decides the exact surface (mini-window recording entry, the recording popover bottom-center already shipped in NOTES-FIX must be reachable from the minimized state, etc.) — the owner's words are the acceptance: minimized -> can record.
- Verify: the notes suite green (record counts), the macOS build compiles, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on ${ROW}, posts to #board, mementos. English. Lineage 'conversations agents register' named notesmin-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const ANALYZE = CONST + `
ROLE: analyze lane (Fable). Per the CONST: read the macOS app's window/minimize handling (Sources/HasnaNotesApp — window state, the header drag strip, minimize-to-whatever), and the recording surfaces (web/app.js recording state, the bottom-center rec pill from NOTES-FIX req 6). Decide the exact change: what the minimized window shows and how recording starts from it. Return the change plan.
Return (JSON): { plan: {surface, files: [string], behavior}, evidence: string }
`

const IMPLEMENT = CONST + `
ROLE: implement lane. Per the analyze plan ({PLAN}): implement the minimized-recording surface, TDD where testable, notes suite green (record counts), macOS build compiles, secrets scan, commit ('Agent: notesmin-<your-role>'), push, PR referencing ${ROW}.
Return (JSON): { prNumber: number, diffSummary: string, suiteCounts: {passed, failed}, buildOk: bool, secretsClean: bool, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PR ({PR}): the minimized window offers recording per the owner's words, the change is the smallest owned change, suite green, build compiles, secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — notes-minimized @ <sha> — lens: minimized recording, reviewer notesmin-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO: merge the PR (base-movement gate; squash with 'Agent: notesmin-ship'), build + install on station03 (/Applications/HasnaNotes.app per deploy_notes.sh), LIVE TEST: with the app running, minimize it and confirm the recording affordance is present (record the literal evidence — the surface visible in the minimized state, or the runtime probe), complete ${ROW} with evidence + the owner visual check request. If NO_GO: comment + resume condition, leave in_progress.
Return (JSON): { merged: bool, mergedSha: string|null, station03Installed: bool, liveTest: string, rowState: string, residue: [string] }
`

const AN_SCHEMA = { type: 'object', properties: { plan: { type: 'object' }, evidence: { type: 'string' } }, required: ['plan'] }
const IMPL_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, diffSummary: { type: 'string' }, suiteCounts: { type: 'object' }, buildOk: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['prNumber'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, station03Installed: { type: 'boolean' }, liveTest: { type: 'string' }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

const FINISH = CONST + `
ROLE: finish lane — the ship lane yielded with the merge pending (Fable review GO at 983468aa3; branch rebased to 997f78245; base gate re-verified; notes suite 154/0 at head; CI re-running at 997f78245 with 4 checks pending at yield; merge body at /tmp/merge-body-624.txt ending 'Agent: notesmin-ship'). Per the CONST, complete the chain the owner's phase model requires — a merged PR is not the end: (1) poll 'gh pr checks 624' bounded (max 20 min) until all green at 997f78245 (the known environmental playwright stall, if the ONLY failure, re-run once and record); (2) re-run the base-movement gate (merge-result tree vs head tree; if main moved again, rebase --force-with-lease and re-poll); (3) squash-merge with --body-file /tmp/merge-body-624.txt (create it if missing — the last line MUST be 'Agent: notesmin-ship'), record the merged sha; (4) build + install /Applications/HasnaNotes.app on station03 (rsync the worktree reset to the merged origin/main state, run the macOS build per deploy_notes.sh — BUILD_RC=0 recorded); (5) LIVE TEST on station03 per the ship plan: activate the app, click win-min (Minimize to quick note) -> the compact 380x220 shell shows the #compact-rec mic, start a recording (Cmd+Shift+R menu mirror), stop, confirm the voice note saved under ~/.hasna/notes/notes (record the literal evidence; if a headless/remote limitation blocks the GUI exercise, record the exact manual step + the strongest available probe); (6) complete row ${ROW} with merged sha + live-test evidence; if NO_GO or CI never green, leave in_progress with the exact resume condition.
Return (JSON): { merged: bool, mergedSha: string|null, ciGreenAtHead: bool, station03Installed: bool, liveTest: string, rowState: string, residue: [string] }
`

const FINISH_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, ciGreenAtHead: { type: 'boolean' }, station03Installed: { type: 'boolean' }, liveTest: { type: 'string' }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Analyze')
const analyze = await agent(ANALYZE, { label: 'notesmin-analyze', phase: 'Analyze', schema: AN_SCHEMA, model: 'fable' })

phase('Implement')
let implement = null
if (analyze && analyze.plan) {
  implement = await agent(IMPLEMENT.replace('{PLAN}', JSON.stringify(analyze.plan)), { label: 'notesmin-implement', phase: 'Implement', schema: IMPL_SCHEMA })
} else {
  implement = { prNumber: null }
}

phase('Review')
let review = null
if (implement && implement.prNumber) {
  review = await agent(REVIEW.replace('{PR}', String(implement.prNumber)), { label: 'notesmin-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'implement did not open a PR', detail: 'record the exact gate' }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'notesmin-ship', phase: 'Ship', schema: SHIP_SCHEMA })

phase('Finish')
let finish = null
if (ship && !ship.merged) {
  finish = await agent(FINISH, { label: 'notesmin-finish', phase: 'Finish', schema: FINISH_SCHEMA })
} else {
  finish = { merged: ship && ship.merged ? true : false, rowState: ship && ship.rowState ? ship.rowState : 'unknown', residue: [] }
}

return { analyze, implement, review, ship, finish }
