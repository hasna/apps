export const meta = {
  name: 'stale-tasks',
  description: 'Owner-authorized 2026-08-19: every 30 min, sweep pending/in_progress tasks in the hasna/apps project (3bbc22e0) — evidence-backed DONE-but-unmarked rows get completed with proof; stale in_progress with no live worker gets demoted to pending with unlock+comment; never complete without evidence, never cancel without an owner',
  phases: [
    { title: 'Census', detail: 'enumerate pending+in_progress, gather per-row evidence signals (comments, PR links, merged shas)' },
    { title: 'Classify', detail: 'per-row verdict: COMPLETE-EVIDENCED / DEMOTE-STALE / LIVE / OWNER / UNCHANGED, each with an evidence line' },
    { title: 'Apply', detail: 'execute status corrections (todos complete with evidence; demote with unlock+comment); vocabulary-only, no deletes, no cancels' },
    { title: 'Report', detail: 'counts + one #board line per change' },
  ],
}

const APPS = '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'

const CONST = `
You are a lane of the stale-tasks workflow (2026-08-19, owner-authorized). Mission: every 30 minutes, check the hasna/apps todos project (${APPS}) for STALE tasks and update their status CORRECTLY — including tasks that are DONE but were never marked done. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- The status vocabulary is exactly: pending / in_progress / completed / failed / cancelled. NEVER invent another status. NEVER delete a task. NEVER cancel without an explicit recorded owner decision.
- COMPLETION REQUIRES EVIDENCE: a row may be marked completed ONLY when its work demonstrably landed — a merged PR sha, a verified fix (comment with the fix + test result), a resolved disposition (e.g. 'false positive', 'fixed by <PR>'), or a completion comment by the owning lane. A comment that says FIXED/REMEDIATION COMPLETE/MERGED counts as evidence. Without evidence, the row is NOT completed — it is demoted (stale) or left.
- DEMOTE-STALE: a row in_progress (or pending with a held lock) with NO activity for >24h (last comment/update older than 24h) AND no live workstream marker (open PR touching its package, an in-flight workflow, a recent heartbeat comment) is demoted: in_progress -> pending with an unlock (todos unlock; if a lock is held by a named agent, use the stale-lock handoff ONLY if >60 min idle per the stale-takeover rule; otherwise leave the lock and comment) + a comment 'STALE-DEMOTED: no activity since <date>; re-pick for dispatch'. NEVER demote a row with a live worker or an active lane.
- LIVE: recent activity (<24h) or a live workstream marker -> skip, record LIVE.
- OWNER: the owner-decision class (composition rulings, removal-premise, work-status rulings, budget questions) -> skip, record OWNER.
- IDEMPOTENCY: never re-process a row already corrected this pass; a second firing with no state change changes nothing.
- No secrets: never print/capture/commit credential values. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on each corrected row (evidence line), one #board line per change. English. Lineage 'conversations agents register' named stale-tasks-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const CENSUS = CONST + `
ROLE: census lane (Opus). PRIORITY YIELD CHECK FIRST: if any UNOWNED row's title starts with "HOTFIX:", the hotfix-drain lane owns the priority class — sleep 1800 (bash), re-check once, return {rows: [], bound: 0, yielded: true, hotfixCount: N}. Do NOT enumerate while yielding.

Otherwise enumerate: todos list --project ${APPS} --status pending --limit 300 --json AND --status in_progress --limit 300 --json (redirect to files, never pipe; parse both). For EACH row capture: id, title (trimmed to 80 chars), status, assigned_to, updated_at, created_at, lastActivity (the most recent comment date), and any PR/merge references in comments (gh pr list --repo hasna/apps --search '<package> in:title' bounded ONLY for rows whose comments lack a PR reference). Also note open PRs per package (bounded) as live-workstream markers. Cap: process the 150 most recently updated rows; record the bound.
COMPACT PAYLOAD (measured cap, 2026-08-20): the census return MUST stay under ~30KB — a ~88KB rows array with comment bodies truncates mid-JSON and fails the schema gate (5 retries, workflow failed). Do NOT include comment bodies in the census. The classify lane fetches each row's own comments itself when a decision needs them.
IF NOTHING NEEDS THE SWEEP (no rows older than 24h with no live marker — i.e. the classify pass would be a no-op): sleep 1800 (bash — 30 min), re-run the census once, and return the RE-CHECK result — the lane waits ~30 min between passes while idle. NEVER return an empty rows without the sleep+re-check having run.
Return (JSON): { rows: [{id, title, status, assignedTo, updatedAt, lastActivity, prRefs: [string]}], bound: number, yielded: bool, hotfixCount: int, residue: [string] }
`

const CLASSIFY = CONST + `
ROLE: classify lane (Opus). Per the CONST + the census rows ({ROWS}): for EACH row decide with the evidence line. The census carries COMPACT rows only (no comment bodies): fetch the row's own comments with 'todos show <id> --json' (or 'todos comments <id>') for exactly the rows where the decision needs the evidence text (activity >24h, in_progress with an old timestamp, or an ambiguous status) — bounded to those rows, never the full set. Evidence lines stay under 120 chars each, so the verdicts return stays small (per-response generation cap).
(a) COMPLETE-EVIDENCED — work landed (merged PR sha, 'FIXED'/'REMEDIATION COMPLETE'/'MERGED'/'false positive' comments, a resolved disposition). Evidence line = the comment/PR that proves it.
(b) DEMOTE-STALE — in_progress with no activity >24h AND no live marker (as defined); evidence line = last activity date + the live-marker check result.
(c) LIVE — recent activity or a live workstream marker; evidence = what is live.
(d) OWNER — owner-decision class; evidence = why it is owner-bound.
(e) UNCHANGED — anything else (recently created, no evidence either way): leave; evidence = 'no evidence for completion, no staleness'.
Return (JSON): { rows: [{id, verdict, evidence, action: 'complete'|'demote'|'skip'|'skip-owner'|'skip-live'|'skip-none'}] }
`

const APPLY = CONST + `
ROLE: apply lane. Per the classify verdicts ({VERDICTS}): execute ONLY the 'complete' and 'demote' actions.
- complete: todos complete <id> --agent <the row's assigned agent or marcellus> + a comment 'STALE-SWEEP COMPLETED: <evidence line>'.
- demote: if in_progress -> todos update <id> --status pending + comment 'STALE-DEMOTED: no activity since <date>, no live lane; re-pick for dispatch' + unlock (todos unlock <id>; if the unlock fails with a held lock by a named agent, comment only — never force).
- NEVER touch skip rows. NEVER complete without the evidence line. Record every executed action with its rc and literal output.
Return (JSON): { actions: [{id, action, rc, output, evidence}], errors: [string] }
`

const REPORT = CONST + `
ROLE: report. The authoritative counts ({COUNTS}) were DERIVED DETERMINISTICALLY from the apply lane's executed receipts and the classify verdicts by the workflow engine — use them EXACTLY, do not re-derive, do not invent numbers not present in them. Post ONE #board line exactly as provided ({BOARDLINE}); if nothing changed, one line 'stale-sweep: nothing to correct'. Comment any corrected row without an apply receipt (error) with the resume condition.
Return (JSON): { posted: bool, boardLine: string, errors: [string] }
`

const CENSUS_SCHEMA = { type: 'object', properties: { rows: { type: 'array', items: { type: 'object' } }, bound: { type: 'number' }, residue: { type: 'array' }, yielded: { type: 'boolean' }, hotfixCount: { type: 'integer' } }, required: ['rows'] }
const CLASSIFY_SCHEMA = { type: 'object', properties: { rows: { type: 'array', items: { type: 'object' } } }, required: ['rows'] }
const APPLY_SCHEMA = { type: 'object', properties: { actions: { type: 'array' }, errors: { type: 'array' } }, required: ['actions'] }
const REPORT_SCHEMA = { type: 'object', properties: { counts: { type: 'object' }, boardLine: { type: 'string' } }, required: ['counts'] }

// INFINITE SESSION-SCOPED LOOP (owner 2026-08-25): census -> classify -> apply ->
// report -> wait ~30 min when nothing to correct -> re-census, forever. The idle
// wait lives INSIDE the census agent (bash sleep 1800 + re-check) when the sweep
// finds nothing to correct. PRIORITY YIELD: any HOTFIX: row yields to hotfix-drain.
// Stop = owner stops the run or the session ends.
let pass = 0
for (pass = 1; ; pass++) {
phase('Census')
const census = await agent(CENSUS, { label: 'stale-tasks-census-' + pass, phase: 'Census', schema: CENSUS_SCHEMA, model: 'opus' })
log(`pass ${pass} census: ${census && census.rows ? census.rows.length + ' rows' : 'FAILED'}`)
if (census && census.yielded) {
  log(`pass ${pass}: YIELDED to hotfix-drain (${census.hotfixCount || 0} HOTFIX: row(s)) — waited 30 min inside the census, re-checking next pass`)
  continue
}
if (!census || !census.rows || census.rows.length === 0) {
  log(`pass ${pass}: nothing to correct — the census waited ~30 min and re-checked; re-checking next pass`)
  continue
}

phase('Classify')
let classify = null
if (census && census.rows && census.rows.length) {
  classify = await agent(CLASSIFY.replace('{ROWS}', JSON.stringify(census.rows)), { label: 'stale-tasks-classify', phase: 'Classify', schema: CLASSIFY_SCHEMA, model: 'opus' })
} else {
  classify = { rows: [] }
}

phase('Apply')
let apply = null
if (classify && classify.rows.length) {
  apply = await agent(APPLY.replace('{VERDICTS}', JSON.stringify(classify.rows)), { label: 'stale-tasks-apply', phase: 'Apply', schema: APPLY_SCHEMA })
} else {
  apply = { actions: [], errors: [] }
}

phase('Report')
// DERIVED COUNTS (deterministic): from the apply lane's executed receipts and
// the classify verdicts — never from the report lane's own summarization
// (measured defect 2026-08-20: the report lane returned 6 completed while
// apply executed ZERO actions and classify contained NO complete verdicts).
const derived = { completed: 0, demoted: 0, live: 0, owner: 0, unchanged: 0 }
for (const a of (apply && apply.actions) || []) {
  // Count EXECUTED receipts only (rc 0 or '0'): a 'complete' verdict the apply
  // lane declined (rc=not-run, decision recorded in a comment) is NOT a
  // completion — f16 measured this conflation (board line claimed 1 completed,
  // actual mutations 0).
  const rcOk = a.rc === 0 || a.rc === '0'
  if (a.action === 'complete' && rcOk) derived.completed++
  else if (a.action === 'demote' && rcOk) derived.demoted++
}
for (const r of (classify && classify.rows) || []) {
  if (r.action === 'skip-live') derived.live++
  else if (r.action === 'skip-owner') derived.owner++
  else if (r.action === 'skip-none') derived.unchanged++
}
const boardLine = (derived.completed + derived.demoted) === 0
  ? 'stale-sweep: nothing to correct'
  : `stale-sweep: ${derived.completed} completed (evidence), ${derived.demoted} demoted, ${derived.live} live, ${derived.owner} owner, ${derived.unchanged} unchanged`
const report = await agent(REPORT.replace('{COUNTS}', JSON.stringify(derived)).replace('{BOARDLINE}', boardLine), { label: 'stale-tasks-report-' + pass, phase: 'Report', schema: REPORT_SCHEMA })
log('stale-tasks pass ' + pass + ': ' + boardLine + ' — next pass re-censuses')
}
