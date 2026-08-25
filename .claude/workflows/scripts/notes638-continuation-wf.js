export const meta = {
  name: 'notes638-continuation',
  description: 'Continuation for hasna/apps#638 (notes cloud-only bridge, row eca5b6da): review GO at f3b548ac6 but merge-gated — main gained #624 (compact record affordance, merged 18:02Z) touching 4 files this PR owns (apps/notes/test/notes-functionality.test.mjs, web/app.js, web/index.html, web/styles.css). Rebase onto current main, resolve the combination (cloud-only + compact-record), scoped re-review of the 4 files, CI 5/5, base gate, merge, complete row',
  phases: [
    { title: 'Rebase', detail: 'rebase drain5/notes-cloud-only onto origin/main; resolve the 4-file combination' },
    { title: 'Verify', detail: 'CI 5/5 at the new head + notes suite green' },
    { title: 'Review', detail: 'scoped Fable re-review of the 4 combined files' },
    { title: 'Ship', detail: 'base gate, merge, complete eca5b6da' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PR = 638
const ROW = 'eca5b6da-9be9-4b53-ad28-49791357fa23'

const CONST = `
You are a lane of the notes638-continuation workflow (2026-08-19). PR hasna/apps#${PR} (notes cloud-only macOS bridge, row ${ROW}) got drain5-review GO at f3b548ac6 (2 P2s non-blocking: duplicate note.restored audit event; operational store failure rendering) but the merge gate NO_GO'd: main gained #624 (compact record affordance, merged 2026-08-19T18:02:03Z) touching 4 files this PR owns (apps/notes/test/notes-functionality.test.mjs, web/app.js, web/index.html, web/styles.css); merge tree 56affa25 != reviewed head f3b548ac6; 25 other differing files are main-side drift. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/notes638-<n>; work on the PR's OWN branch (drain5/notes-cloud-only — gh pr view ${PR} --json headRefName, never guess). PR-first; never push to main. Commits end with 'Agent: notes638-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check PR #${PR} comments — if the rebase already landed (head moved past f3b548ac6), verify and record; do not duplicate.
- THE REBASE: rebase onto origin/main, resolve the 4-file combination — BOTH changes kept: #624's compact-record affordance (#compact-rec) AND #638's cloud-only bridge (NotesHttpStore + bridge rewrite). The combination must keep the 154/0 suite AND the record-affordance regression test passing. The 2 P2s from the GO review stay non-blocking (recorded, not remediated, unless the rebase surfaces them as direct regressions).
- Verify: notes suite green (154 pass / 0 fail — record counts), Swift smoke still 30/30 on station03 (or record the exact limitation), secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on PR #${PR} and row ${ROW}, posts to #board. English. Lineage 'conversations agents register' named notes638-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const REBASE = CONST + `
ROLE: rebase lane. Per the CONST: rebase onto origin/main, resolve the 4-file combination (compact-record + cloud-only both kept), notes suite green (record counts), Swift smoke re-run on station03 if the bridge changed (or record the exact limitation), secrets scan, commit ('Agent: notes638-<your-role>'), push --force-with-lease. Record the merge-tree gate result at the new head.
Return (JSON): { newHead: string, diffSummary: string, combination: [{file, kept}], suiteCounts: {passed, failed}, swiftSmoke: string, secretsClean: bool, gateOk: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks ${PR}', re-run failed jobs (gh run rerun), poll bounded (max 20 min), require ALL FIVE checks GREEN at the new head (record the per-check table). The known environmental playwright stall, if the ONLY failure, re-run once and record.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) — scoped re-review of the 4 combined files. Review: (a) the combination keeps BOTH changes (compact-record affordance + cloud-only bridge; nothing regressed), (b) the merge-tree gate passes (merge result == reviewed head), (c) suite green at the new head, (d) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — notes638 @ <sha> — lens: 4-file combination, reviewer notes638-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge PR #${PR} (base-movement gate first — merge-tree against origin/main; gh pr merge --squash --body-file ending 'Agent: notes638-ship'), record the merged sha, complete row ${ROW} with the evidence. If NO_GO: comment findings + resume condition, leave in_progress.
Return (JSON): { merged: bool, mergedSha: string|null, rowState: string, residue: [string] }
`

const RB_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, diffSummary: { type: 'string' }, combination: { type: 'array' }, suiteCounts: { type: 'object' }, swiftSmoke: { type: 'string' }, secretsClean: { type: 'boolean' }, gateOk: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Rebase')
const rebase = await agent(REBASE, { label: 'notes638-rebase', phase: 'Rebase', schema: RB_SCHEMA })

phase('Verify')
let verify = null
if (rebase && rebase.newHead) {
  verify = await agent(VERIFY, { label: 'notes638-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'rebase did not complete', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW, { label: 'notes638-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'rebase/verify did not complete', detail: JSON.stringify({ rebase, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'notes638-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { rebase, verify, review, ship }
