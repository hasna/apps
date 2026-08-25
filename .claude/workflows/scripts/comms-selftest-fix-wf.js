export const meta = {
  name: 'comms-selftest-fix',
  description: 'Fix machine-comms-selftest canary read-back: 5 consecutive daily [SELFTEST-FAIL] on station01 at ~08:2xZ (08-15..08-19); write lands (canary 712754 in #comms-selftest), read-back misses at read time (task 679e7681)',
  phases: [
    { title: 'Investigate', detail: 'read comms-selftest.sh + the loop schedule; why does read-back miss only at ~08:2xZ daily' },
    { title: 'Fix', detail: 'smallest owned repair to the owning surface' },
    { title: 'Verify', detail: 'real acceptance: fresh canary read back at read time, no SELFTEST-FAIL, two-sided' },
    { title: 'Review', detail: 'Fable review' },
    { title: 'Report', detail: 'task 679e7681 + #board + mementos' },
  ],
}

const TASK = '679e7681-2e44-44bf-8dcf-b9f25d0a71e3'

const CONST = `
You are a lane of the comms-selftest-fix workflow (2026-08-19, task ${TASK}, fix-on-sight chain). The fleet comms canary (machine-comms-selftest) is FAILING READ-BACK on station01: 5 consecutive daily [SELFTEST-FAIL] posts in #hq (707528 08-15, 708621 08-16, 709320 08-17, 710301 08-18, 712755 08-19), all at 08:15-08:23Z. The WRITE side lands every time — canary msg 712754 (nonce 1787127315-12769, ts 2026-08-19T08:15:16Z) is present in #comms-selftest and searchable now. The READ-BACK misses at read time. Prior fleet fires on spark01 (24463/24467, 08-03, 53s apart) show the class is fleet-wide. Script: /home/hasna/.hasna/loops/scripts/comms/comms-selftest.sh — line 27: READ_OUT="$(channel read "$CHANNEL" --limit 10 --from "$IDENT-reader" 2>&1)" then grep for "nonce=$NONCE"; failure posts [SELFTEST-FAIL] to hq and exits 1. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- The loops data dir (~/.hasna/loops) is the loops app's own surface — read-only for this lane except the exact owning file the fix changes. The fix's owning surface is the loop script (or the loop's schedule definition if the schedule is the defect). NEVER create stray files in ~/.hasna/loops; scratch goes to /tmp or ~/workspace/scratch.
- No secrets: never print/capture/commit credential values in any encoding. Capture path: redirect to files, read both + $?; never pipe large reads. Paste literal output lines when reporting.
- IDEMPOTENCY FIRST: before any mutation, state-check the task (${TASK}) and the loop's current state — a concurrent fixer may have landed; merge evidence into the existing row instead of duplicating. Check todos for the dedupe rows named below.
- DEDUPE: 'loops list' currently fails with LOOP_LIST_PAGINATION_FAILED (a loops CLI defect). Before filing anything new about loops list, check the tracked detector-blindness rows (3cdb46ce / fd65d225 — the loops list rc=1 class); if this pagination failure is not covered, file ONE row naming it. Do not create duplicate rows.
- Record as you go: comments on ${TASK}, posts to #board, mementos for non-obvious findings. English. Lineage 'conversations agents register' named comms-fix-<your-role>. Distinguish measured vs inferred; state what you did not check.
- Knowledge: conversations read-bounds semantics per knowledge item k_mso1r678_fhgm1o (verb/query-shape-specific bounds; a --limit value is not a recency guarantee) — read it before concluding.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). Per the CONST, DO NOT MUTATE. Establish with evidence:
1. Read /home/hasna/.hasna/loops/scripts/comms/comms-selftest.sh in full (already partially known: read-back is 'channel read --limit 10 --from <ident>-reader' grepping the nonce). Record the exact read-back lines and the failure path.
2. Determine the loop's SCHEDULE and fire pattern: how often machine-comms-selftest runs on station01, and what is special about the 08:15-08:23Z window. Sources (bounded): the loops daemon run records (~/.hasna/loops/logs, ~/.hasna/loops/state, daemon.log), system cron for station01 (crontab -l), the loop's schedule definition. NOTE: 'loops list' is broken (LOOP_LIST_PAGINATION_FAILED) — use the filesystem/daemon records; do not block on the CLI.
3. Classify the read-back miss: run the SAME read command shape NOW (bounded, read-only, no canary post) against #comms-selftest and record what 'channel read --limit 10' actually returns (oldest vs newest; the row count; ordering). Compare with knowledge k_mso1r678_fhgm1o. Check how many messages #comms-selftest holds and what the newest 10 look like vs the oldest.
4. Candidate mechanisms to confirm or refute (do not assume): (a) daily same-time burst — many machines' canaries land in the same window and '--limit 10' newest-suffix bounds exclude this machine's canary at read time; (b) a daily service window on the conversations hosted API where read-your-own-write lags; (c) a read-bounds defect (oldest-retained vs newest-retained per verb shape); (d) reader-identity visibility (the -reader identity cannot see the channel / self-filter). For whichever mechanism the evidence supports, name the exact evidence lines.
Return (JSON): { scheduleEvidence: string, firePattern: string, readBackLines: string, readProbe: {rows, newestHasFreshCanary: bool, ordering: string}, mechanism: string, mechanismEvidence: string, loopsListPaginationCovered: bool, residue: [string] }
`

const FIX = CONST + `
ROLE: fix lane. Per the CONST + the investigate verdict: apply the SMALLEST owned repair in the owning surface (the loop script /home/hasna/.hasna/loops/scripts/comms/comms-selftest.sh, or the schedule definition if the schedule is the defect). The canary's purpose (strategy §4, task df981725) is to prove comms READ path works — a fix that weakens the check (e.g. retries that mask, greps on a looser match, or '|| true') is WRONG. Likely repair shapes if the mechanism is (a): make the read-back robust to burst (a deterministic read of the canary by its own identity/message, or a verified-window read per k_mso1r678_fhgm1o) while keeping it a REAL read of the channel; if (b): bounded retry with measured latency + the failure reported with the actual read output; if (c): use the verified read shape. Back up the changed file as .bak-comms-selftest-<ts> BEFORE editing (in place — the loops scripts dir is not a git repo; record the before/after diff of every changed line).
Return (JSON): { surfaceChanged: string, diffSummary: string, backupPath: string, mechanismDriven: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Run the REAL acceptance path: execute the fixed script end-to-end (bounded, env-scrubbed: env -i PATH=/usr/bin:/bin HOME=$HOME — the script resolves the conversations bin from $HOME/.bun/bin or PATH) and require: (a) the script exits 0 with 'GREEN' AND the canary nonce it posted IS read back at read time (the script's own grep passes); (b) a two-sided probe of the read-back shape: a fresh canary posted to #comms-selftest is visible to the SAME read command the fixed script uses, while an OLD canary (or a wrong nonce) is correctly NOT matched; (c) the [SELFTEST-FAIL] path still exists and would fire on a genuinely missing canary (fail-closed: a wrong nonce still exits non-zero with the FAIL line); (d) bounded: whole run <120s. Paste literal output lines. If the mechanism was time-window-dependent and cannot be reproduced now, state the exact resume condition and what the next 08:2xZ fire must show.
Return (JSON): { scriptExit: number, scriptOutput: string, greenWithReadback: bool, freshCanaryVisible: bool, staleNotMatched: bool, failClosed: bool, bounded: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review: (a) the root cause is established with evidence (the daily 08:2xZ mechanism confirmed or refuted, not inherited), (b) the fix is the smallest owned change and does NOT weaken the canary (no masking retries, no '|| true', the check still proves read-path visibility), (c) the verify ran the REAL script (exit 0 GREEN with the nonce read back at read time) plus the two-sided probes, (d) fail-closed honesty if the window could not be reproduced, (e) backup made, no stray files in ~/.hasna/loops, no secrets. Post '[REVIEW] <GO|NO_GO> — comms-selftest-fix @ <evidence> — lens: canary read-back restore, reviewer comms-fix-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const REPORT = CONST + `
ROLE: report. If GO + acceptanceMet: comment ${TASK} completed (mechanism, fix, verify evidence, backup path), complete it, post to #board, save a memento. If NO_GO or acceptance not met: comment findings + resume condition, leave in_progress, post residue to #board.
Return (JSON): { taskState: string, residue: [string] }
`

const INV_SCHEMA = { type: 'object', properties: { scheduleEvidence: { type: 'string' }, firePattern: { type: 'string' }, readBackLines: { type: 'string' }, readProbe: { type: 'object' }, mechanism: { type: 'string' }, mechanismEvidence: { type: 'string' }, loopsListPaginationCovered: { type: 'boolean' }, residue: { type: 'array' } }, required: ['mechanism', 'readProbe'] }
const FIX_SCHEMA = { type: 'object', properties: { surfaceChanged: { type: 'string' }, diffSummary: { type: 'string' }, backupPath: { type: 'string' }, mechanismDriven: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['surfaceChanged', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { scriptExit: { type: 'number' }, scriptOutput: { type: 'string' }, greenWithReadback: { type: 'boolean' }, freshCanaryVisible: { type: 'boolean' }, staleNotMatched: { type: 'boolean' }, failClosed: { type: 'boolean' }, bounded: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const REPORT_SCHEMA = { type: 'object', properties: { taskState: { type: 'string' }, residue: { type: 'array' } }, required: ['taskState'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'comms-fix-investigate', phase: 'Investigate', schema: INV_SCHEMA, model: 'opus' })
log(`investigate: mechanism=${investigate && investigate.mechanism ? investigate.mechanism.slice(0, 100) : '?'}`)

phase('Fix')
let fix = null
if (investigate && investigate.mechanism) {
  fix = await agent(FIX, { label: 'comms-fix-fix', phase: 'Fix', schema: FIX_SCHEMA })
} else {
  fix = { surfaceChanged: 'none — investigation failed' }
}

phase('Verify')
let verify = null
if (fix && fix.surfaceChanged !== 'none — investigation failed') {
  verify = await agent(VERIFY, { label: 'comms-fix-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'investigation or fix did not complete', evidence: 'skipped' }
}

phase('Review')
let review = null
if (fix && fix.surfaceChanged !== 'none — investigation failed') {
  review = await agent(REVIEW, { label: 'comms-fix-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P0', title: 'investigation/fix did not complete', detail: JSON.stringify({ investigate, fix }) }] }
}

phase('Report')
const report = await agent(REPORT, { label: 'comms-fix-report', phase: 'Report', schema: REPORT_SCHEMA })

return { investigate, fix, verify, review, report }
