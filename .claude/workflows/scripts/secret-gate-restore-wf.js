export const meta = {
  name: 'secret-gate-restore',
  description: 'Restore the fail-closed staged-credential scan into the station01 git hooks (the lefthook-hang fix kept the hooks fail-open; the fleet gate verify now measures commit/push not-enforcing on station01/02/03 — task 5936a0c5, LIVE)',
  phases: [
    { title: 'Fix', detail: 'wire the existing perl scanners fail-closed into the fixed hooks, keep bounded lefthook dispatch' },
    { title: 'Verify', detail: 'two-sided probe: staged credential REJECTED, benign commit PASSES, push arm enforced' },
    { title: 'Review', detail: 'Fable review' },
    { title: 'Report', detail: 'task 5936a0c5 + #board + propagation note' },
  ],
}

const TASK = '5936a0c5-422c-4f5e-ba85-0294bc17adcc'

const CONST = `
You are a lane of the secret-gate-restore workflow (2026-08-19, task ${TASK}, SECURITY — LIVE). The fleet credential gate is FAILING OPEN: the fleet verify (machine-security-git-secret-gate-fleet-verify) measured 2026-08-19T00:40Z — 14 machines, 11 enforcing, 3 FAILING: station01/02/03 commit:not-enforcing, push:not-enforcing (#incidents 711984). Root cause: the station01 no-cursor-coauthor hooks (machine-wide core.hooksPath) were rewritten 2026-08-19 to stop the pnpm-lefthook-hang OOM (incident 5dfde05f, closed) — the rewrite preserved the fail-open dispatch shape and DROPPED the fail-closed staged-credential scan, so with lefthook absent (everywhere on this box) the hooks pass everything through: 'staged credential COMMITTED SUCCESSFULLY' (verify-control.sh measured; 37 consecutive canary failures since 2026-08-12T16:35Z per the task). Final text = machine-readable JSON.

THE GATE MATERIAL EXISTS: /home/hasna/.config/hasna/git-hooks/no-cursor-coauthor/ contains hasna-secret-scan.pl (the scanner, with .bak-pre-5patterns-20260727), hasna-trailer-check.pl, hasna-hook-forward, fleet-verify.sh (+ .bak-pre-measuredfloor-20260731T082945Z), commit-msg.bak-pre-pathfix-20260727. The pre-pathfix backups hold the prior fail-closed shape.

THE FIX (smallest owned):
1. Read hasna-secret-scan.pl + the pre-pathfix backups to recover the scan invocation contract (args, exit codes, output).
2. Wire the scan into the FIXED hooks as a FAIL-CLOSED gate: pre-commit and pre-push must run the staged-credential scan (hasna-secret-scan.pl on the staged diff) and REJECT (exit non-zero with the finding named) when a credential-pattern value is staged; the trailer check (hasna-trailer-check.pl) restored to its prior behavior. The bounded lefthook dispatch (LEFTHOOK_BIN -> timeout 10 -> node_modules test -f) and the LEFTHOOK=0 kill switch stay UNCHANGED — the scan runs first and is never bypassable by the lefthook path.
3. NEVER break the hang fix: no unbounded probes, no package-manager cascade, no baked paths. Every scan invocation must be bounded.
4. Do not weaken: the gate must fail CLOSED on scan errors (a scanner that cannot run is a rejection with the reason, never a pass-through) — per the task's 'fails open on BOTH arms' finding.

VERIFY (two-sided, per the fleet verify's own fixture style):
(a) POSITIVE: a throwaway repo with a staged credential-shaped value (synthetic, e.g. sk-ant-... never a real value) — 'git commit' must FAIL (rc!=0) with the scanner naming the finding; the value must not leave the fixture.
(b) NEGATIVE: a benign commit in the same fixture must PASS (rc=0) within 60s.
(c) Push arm: the same positive on a push must be rejected (or the pre-push scan runs — verify which arm the push scan is wired to and prove it fires).
(d) The hooks still complete in bounded time (no hang): time the runs.
(e) LEFTHOOK=0 kill switch still exits 0 instantly (and note: the kill switch bypasses lefthook, NOT the scan — if the scan must run even under LEFTHOOK=0, wire it so; decide by reading the pre-pathfix behavior).
Run everything in a throwaway /tmp fixture, env scrubbed (env -i PATH=/usr/bin:/bin), identity via GIT_AUTHOR_*/GIT_COMMITTER_*.

NO SECRETS: only synthetic values in fixtures; never print/capture real credential values; LEFTHOOK_VERBOSE never set or run. Capture path: redirect to files. Paste literal output lines. Record as you go: comments on ${TASK}, posts to #board. English. Lineage 'conversations agents register' named secret-gate-<your-role>. Backup the changed hooks as .bak-secret-gate-restore-<ts>.
`

const FIX = CONST + `
ROLE: fix lane. Execute per the CONST: recover the scan contract, wire the fail-closed scan into pre-commit + pre-push (+ prepare-commit-msg if the pre-pathfix shape had it), keep the bounded dispatch + kill switch, back up the changed hooks. Record the exact hook shape before/after (diff summary + the scan invocation lines).
Return (JSON): { scanWired: bool, arms: {preCommit: bool, prePush: bool, prepareCommitMsg: bool}, scanContract: string, killSwitchScanBehavior: string, backups: [string], evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Run the two-sided probes per the CONST: positive (synthetic staged credential -> commit REJECTED rc!=0, scanner names the finding), negative (benign commit PASSES rc=0 <60s), push arm probe, kill-switch probe, hang-bounded timing. Paste literal output lines. Report the exact rc + the scanner's output line for each arm.
Return (JSON): { positiveRejected: bool, positiveRc: number, positiveOutput: string, negativePassed: bool, negativeDurationMs: number, pushArmEnforced: bool, killSwitchRc: number, allBounded: bool, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review: (a) the scan is fail-closed (scanner errors reject, never pass), (b) the hang fix is intact (no unbounded probes, bounded time measured), (c) the kill switch bypasses lefthook only, not the scan (per the wired behavior), (d) synthetic-only fixtures, no secrets, (e) the two-sided probes genuinely discriminate. Post '[REVIEW] <GO|NO_GO> — secret-gate-restore @ <evidence> — lens: fail-closed gate restore, reviewer secret-gate-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const REPORT = CONST + `
ROLE: report. If GO + verified: comment ${TASK} completed with the fix + two-sided verify evidence; post to #board naming the propagation step (station02/03 install the same hooks — the hooks' canonical source and the machine propagation mechanism; if the propagation is not this machine's job, record the exact propagation owner + mechanism). If NO_GO: comment findings, leave in_progress.
Return (JSON): { taskState: string, propagationNote: string, residue: [string] }
`

const FIX_SCHEMA = { type: 'object', properties: { scanWired: { type: 'boolean' }, arms: { type: 'object' }, scanContract: { type: 'string' }, killSwitchScanBehavior: { type: 'string' }, backups: { type: 'array' }, evidence: { type: 'string' } }, required: ['scanWired'] }
const VERIFY_SCHEMA = { type: 'object', properties: { positiveRejected: { type: 'boolean' }, positiveRc: { type: 'number' }, positiveOutput: { type: 'string' }, negativePassed: { type: 'boolean' }, negativeDurationMs: { type: 'number' }, pushArmEnforced: { type: 'boolean' }, killSwitchRc: { type: 'number' }, allBounded: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['positiveRejected', 'negativePassed'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const REPORT_SCHEMA = { type: 'object', properties: { taskState: { type: 'string' }, propagationNote: { type: 'string' }, residue: { type: 'array' } }, required: ['taskState'] }

phase('Fix')
const fix = await agent(FIX, { label: 'secret-gate-fix', phase: 'Fix', schema: FIX_SCHEMA })
log(`fix: wired=${fix && fix.scanWired} arms=${fix && fix.arms ? JSON.stringify(fix.arms) : '?'}`)

phase('Verify')
let verify = null
if (fix && fix.scanWired) {
  verify = await agent(VERIFY, { label: 'secret-gate-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { positiveRejected: false, negativePassed: false, evidence: 'scan not wired — verify skipped' }
}

phase('Review')
let review = null
if (fix && fix.scanWired && verify && verify.positiveRejected && verify.negativePassed) {
  review = await agent(REVIEW, { label: 'secret-gate-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P0', title: 'scan not wired or probes did not discriminate', detail: JSON.stringify({ fix, verify }) }] }
}

phase('Report')
const report = await agent(REPORT, { label: 'secret-gate-report', phase: 'Report', schema: REPORT_SCHEMA })

return { fix, verify, review, report }
