export const meta = {
  name: 'loops-outage-repair',
  description: 'Repair the fleet Loops outage (25 frozen + 19 dead-cadence + 15 unproven of 66 active): classify per-loop mechanisms, repair the owning layer via the package-owned Loops ops, verify sample loops fire and succeed',
  phases: [
    { title: 'Classify', detail: 'runner claim state, lease wedge, machine-identity binding, per-loop exit classes' },
    { title: 'Repair', detail: 'package-owned repairs per mechanism class' },
    { title: 'Verify', detail: 'sample loops fire and succeed after repair' },
    { title: 'Review', detail: 'Fable review of the repairs' },
    { title: 'Report', detail: 'per-loop state + residue' },
  ],
}

const TASK = 'bb5f58ab-7596-4d83-8311-9fc7b29e98ee'

const CONST = `
You are a lane of the loops-outage-repair workflow (2026-08-19, task ${TASK}, CRITICAL). Fleet Loops failure measured by station01-loops-frozen-check on 2026-08-18T23:09Z (#incidents 711800 dead-cadence: 19 loops fire every schedule with ZERO successes; 711801 frozen: 25 ACTIVE loops whose nextRunAt is 7.4-254h past). The detector itself warns: on 2026-08-02 three DIFFERENT mechanisms produced this identical signature (claim-path prompt redaction, an inner-script timeout beating the loop timeout, an unreclaimed run lease) — classify per loop, never assume one shared root. Final text = machine-readable JSON.

Known facts (measured 2026-08-19 ~02:5x EEST on station01):
- Cloud runner process ALIVE: bash /home/hasna/.hasna/cloud/loops-cloud-runner.sh (pid 3247955). 'loops daemon status' is VALIDATION_ERROR under hosted mode (daemon verbs are local-store-only).
- A pr-monitor-every-5m-station01 run record: claimedBy=cloud-runner-station01, exitCode=1, durationMs=619, error redacted — instant failure consistent with the installed @hasna/repos 0.1.49 FK brick at DB open (fix merged in #530, release pending aaef650b — the release is the repair for THAT loop; do not fix it per-loop).
- Dead-cadence exit classes: exit=83 (chief-of-staff-coordination-v8-10m, 8/8 — tracked c1216d46), exit=1 (pr-monitor x10, publish-lane-detect-oss-v4 x10, digitalization-capture-eest x10, machine-comms-selftest x4, machine-security-git-secret-gate-fleet-verify x10, ecosystem-intel-digest x9), exit=71 (codewith-loop-probe x9), exit=127 (verify-shell x2, x5 each — command-not-found), exit=None x9 (repo-chief-staff-* loops, 4-10 runs each), 1 contract-excused (machine-ops-loop-health-slo-compact-v2, allowed [1]).
- Frozen set includes: ecosystem-intel-* (243-254h), chief-strategy-report (234h), chief-of-staff-coordination-v8-10m (218h), chief-harness-coordination (205h), chief-engineering-coordination (186h), chief-of-shipping-pass-v8 (96h), fleet-probe-scratch-db-cleanup apple03+spark01 x3 (36-108h), machine-ops-scratch-db-cleanup-apple03 x2 (104h), machine-ops-recovery-spark01 (7.4h), agent-chief-research-coordination-10m (13h), self-workspace-drift-every-15m (7.8h), telegram-inbound-every-5m (7.8h), chief-marketing-report-backstop (7.7h), stale-agent-scan-station01 (7.7h), codewith-loop-probe (7.8h), chief-shipping-followthrough (7.8h), repo-chief-staff-chief-loops-debloat-orchestrator (101h).

Non-negotiable rules (all agents):
- REPAIR THROUGH THE PACKAGE-OWNED OPS ONLY: loops CLI verbs (loops runs <name> to inspect, loops run/trigger for a bounded manual run, the runner script's own lifecycle) — never hand-rolled process kills, never direct DB writes, never editing the hosted store. The runner script /home/hasna/.hasna/cloud/loops-cloud-runner.sh is the owned surface for runner restarts — read it before acting; restart ONLY if it is provably wedged (stuck claim, no progress) and only via its own stop/start contract or the documented supervisor. Record every mutation.
- CLASSIFY BEFORE REPAIR: for each frozen loop, distinguish (a) lease wedge (status=running with expired lease — 'loops runs <name>' shows it), (b) machine-identity mismatch (loop binding vs the runner's --machine-id), (c) dead cloud runner, (d) per-loop command failure. For each dead-cadence loop, read its actual run error/output (the run record's error field may be redacted — the loop's log/output file carries the real cause; bounded reads).
- DEDUPE AGAINST KNOWN TRACKING: pr-monitor = repos 0.1.49 brick (release pending, record-and-skip); chief-of-staff-v8 = c1216d46 (already tracked, verify whether the repair here clears it); loops-cloud-runtime goal = D3 (4a88c658). Do not create parallel rows for known sub-causes.
- VERIFY: every repair is verified by a real run (loops run <name> or the next scheduled fire observed in the run list) with a terminal receipt/status.
- No secrets: never print/capture credential values. Capture path: redirect to files, never pipe large reads. Paste literal output lines. Record as you go: comments on ${TASK}, posts to #board. English. Lineage identity 'conversations agents register' named loops-repair-<your-role>.
`

const CLASSIFY = CONST + `
ROLE: classify lane (execute). (1) Read /home/hasna/.hasna/cloud/loops-cloud-runner.sh and its log (bounded tail) — establish the runner's claim cadence, machine-id, and whether it is wedged. (2) For each FROZEN loop in the list, inspect 'loops runs <name>' (bounded): classify lease-wedge vs identity-mismatch vs dead-runner vs per-loop. (3) For each DEAD-CADENCE loop, read the real failure cause from the run record/output (bounded) — record the exact error line per loop. (4) Return the per-loop classification and the runner verdict. Do NOT repair in this lane.
Return (JSON): { runner: {alive, machineId, claimedLoops, wedged: bool, evidence}, frozen: [{name, id, mechanism, evidence}], dead: [{name, id, exitCode, cause, evidence}], totals: {frozenClassified, deadClassified} }
`

const REPAIR = CONST + `
ROLE: repair lane (execute). Repairs per the classification {CLASS}: (1) lease wedge -> the package-owned reclaim path (loops run/lease verbs per the CLI surface; if the CLI lacks a reclaim verb, the runner's own recovery — read the runner script's documented behavior first) — never a direct store write; (2) machine-identity mismatch -> align the loop binding or the runner's --machine-id via the CLI's supported surface (record which side moved); (3) dead runner -> restart via the runner's own contract only if provably wedged; (4) per-loop command failures -> fix the owning command/config (exit=127 = missing command — locate and repair the reference; exit=1 classes per their recorded causes), EXCEPT pr-monitor (repos release pending — record-and-skip) and chief-of-staff-v8 (tracked c1216d46 — repair here if the mechanism is the same one, else record). Bounded: at most 12 loops repaired in this lane; the rest recorded for the next wave. Every repair verified with a real run (loops run <name> or observed next fire) and its terminal status.
Return (JSON): { repairs: [{name, mechanism, action, verified: bool, runStatus, evidence}], skipped: [{name, reason}], residue: [string] }
`

const VERIFY = CONST + `
ROLE: verify lane (execute). Sample the repaired set + the previously-frozen set: 'loops runs <name>' for each of the repaired loops (bounded) — require a terminal succeeded run after the repair timestamp. Also confirm the runner's claim activity (its log tail shows new claims). Return per-loop verdicts. Do NOT mutate.
Return (JSON): { verified: [{name, status, lastRunStatus, succeededAfterRepair: bool}], runnerClaiming: bool, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the repairs: (a) every mutation went through the package-owned surface (no hand-rolled kills, no direct store writes); (b) classification precedes repair per loop; (c) each repair verified by a real terminal run; (d) known sub-causes deduped (pr-monitor -> release, chief-of-staff-v8 -> c1216d46); (e) no secrets. Post '[REVIEW] <GO|NO_GO> — loops-outage-repair @ <evidence> — lens: Loops outage repair, reviewer loops-repair-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const REPORT = CONST + `
ROLE: report. Aggregate per-loop state (repaired/verified/recorded-skip/residue), runner verdict, residue. Comment ${TASK} (complete it only if the verified sample is green AND residue is only recorded-skips; else leave in_progress with the residue), post to #board.
Return (JSON): { taskState: string, residue: [string] }
`

const CLASS_SCHEMA = { type: 'object', properties: { runner: { type: 'object' }, frozen: { type: 'array' }, dead: { type: 'array' }, totals: { type: 'object' } }, required: ['runner', 'frozen', 'dead'] }
const REPAIR_SCHEMA = { type: 'object', properties: { repairs: { type: 'array' }, skipped: { type: 'array' }, residue: { type: 'array' } }, required: ['repairs'] }
const VERIFY_SCHEMA = { type: 'object', properties: { verified: { type: 'array' }, runnerClaiming: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['verified'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const REPORT_SCHEMA = { type: 'object', properties: { taskState: { type: 'string' }, residue: { type: 'array' } }, required: ['taskState'] }

phase('Classify')
const cls = await agent(CLASSIFY, { label: 'loops-repair-classify', phase: 'Classify', schema: CLASS_SCHEMA })
log(`classify: frozen ${cls && cls.frozen ? cls.frozen.length : 0}, dead ${cls && cls.dead ? cls.dead.length : 0}, runner wedged=${cls && cls.runner && cls.runner.wedged}`)

phase('Repair')
const repair = await agent(REPAIR.replace('{CLASS}', JSON.stringify(cls)), { label: 'loops-repair-lane', phase: 'Repair', schema: REPAIR_SCHEMA })
log(`repair: ${repair && repair.repairs ? repair.repairs.length : 0} repaired, ${repair && repair.skipped ? repair.skipped.length : 0} skipped`)

phase('Verify')
const verify = await agent(VERIFY, { label: 'loops-repair-verify', phase: 'Verify', schema: VERIFY_SCHEMA })

phase('Review')
const review = await agent(REVIEW, { label: 'loops-repair-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })

phase('Report')
const report = await agent(REPORT, { label: 'loops-repair-report', phase: 'Report', schema: REPORT_SCHEMA })

return { classify: cls, repair, verify, review, report }
