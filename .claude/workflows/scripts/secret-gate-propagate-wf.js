export const meta = {
  name: 'secret-gate-propagate',
  description: 'Propagate the Fable-GO fail-closed secret-gate hooks (pre-commit/pre-push + perl scanners) from station01 to station02/03, verify each with raw-canary.sh AMBIENT = ENFORCING (task 3bb3d20d; fleet-verify loop posts [INCIDENT] until both flip)',
  phases: [
    { title: 'Propagate', detail: 'copy fixed hooks + referenced scanners to station02/03 via ssh BatchMode, backup the fail-open shims' },
    { title: 'Verify', detail: 'raw-canary.sh AMBIENT on each machine requires commit=ENFORCING push=ENFORCING' },
    { title: 'Review', detail: 'Fable review' },
    { title: 'Report', detail: 'task 3bb3d20d + #board' },
  ],
}

const TASK = '3bb3d20d-4cc8-4ad6-b1fb-5559d9459bd2'

const CONST = `
You are a lane of the secret-gate-propagate workflow (2026-08-19, task ${TASK}, SECURITY). Source of the fix: wf_12731d2e-504 (secret-gate-restore, COMPLETED with Fable review GO, 0 findings; task 5936a0c5 completed; #board 712027) restored the FAIL-CLOSED staged-credential scan on station01: /home/hasna/.config/hasna/git-hooks/no-cursor-coauthor/{pre-commit,pre-push} run the perl scanner hasna-secret-scan.pl on the staged diff BEFORE the LEFTHOOK=0 kill switch (exit 0 clean / 1 block / 2 refuse; scanner missing = refuse; redacted prefix+length output only), plus hasna-trailer-check.pl --audit on pre-push, then repo-local chain + bounded lefthook dispatch. Backups of the fail-open shims on station01: .bak-secret-gate-restore-20260819T004519Z. station02 (linux, home /home/hasna) and station03 (macos, home /Users/hasna) STILL run the fail-open '#!/bin/sh' lefthook shim at their no-cursor-coauthor dirs (git config --global core.hooksPath already points at the dir on both; ssh BatchMode reachable from station01). The fleet-verify loop (machine-security-git-secret-gate-fleet-verify) keeps posting [INCIDENT] until both flip to ENFORCING. Final text = machine-readable JSON.

THE FIX (idempotent propagation, never weaken):
1. Per machine: confirm core.hooksPath target; if raw-canary.sh AMBIENT already prints commit=ENFORCING push=ENFORCING, record already-enforcing and do not touch (idempotent).
2. Copy from station01: pre-commit, pre-push, hasna-secret-scan.pl, hasna-trailer-check.pl (+ hasna-hook-forward if the hooks reference it) to the SAME path on station02/03. Inspect the station01 hooks' references first and copy every file they reference (the perl scanner and trailer check are referenced by hook_dir-relative path — if they are absent on the target, the fixed hook FAILS CLOSED (refuses) and the raw-canary negative arm would fail; copy them).
3. Backup the target's old pre-commit/pre-push as .bak-failopen-<ts> BEFORE overwriting (never destroy).
4. Preserve executable bits; do NOT change core.hooksPath; do NOT touch any other hook.
5. The copied files must be byte-identical to station01 (sha256 compare after copy — this is the review-GO content; any difference is a defect).

VERIFY (per machine, the fleet fixture):
- raw-canary.sh AMBIENT (the fleet-verify fixture) must print the literal 'commit=ENFORCING push=ENFORCING'.
- Also confirm sha256 of the copied files matches station01's.
- Bounded: every ssh/scp call with BatchMode + ConnectTimeout 15; no unbounded probes.

NO SECRETS: the hooks/scanner carry no credential values (scanner prints prefix+length only). Never print/capture credential values; capture path: redirect to files. Paste literal output lines. Record as you go: comments on ${TASK}, posts to #board. English. Lineage 'conversations agents register' named secret-gate-prop-<your-role>.
`

const PROPAGATE = CONST + `
ROLE: propagate lane. Execute per the CONST: per-machine idempotency probe, copy the referenced hook files (byte-identical), backup the fail-open shims, sha256-verify the copies. Record per machine: path, files copied (with shas), backups, pre-state (fail-open or already-enforcing).
Return (JSON): { machines: [{name, preState, filesCopied: [string], backups: [string], postShas: object}], allCopied: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Run raw-canary.sh AMBIENT on station02 AND station03 (via ssh BatchMode, env-scrubbed per the fixture's own convention). Require the literal 'commit=ENFORCING push=ENFORCING' on both. Also re-compare sha256 of the deployed files against station01's. Paste literal output lines per machine.
Return (JSON): { station02: {enforcing: bool, literal: string}, station03: {enforcing: bool, literal: string}, shasMatch: bool, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review: (a) the deployed files are byte-identical to the reviewed station01 fix (sha256), (b) both machines' raw-canary AMBIENT outputs discriminate ENFORCING, (c) fail-open shims were backed up not destroyed, (d) core.hooksPath untouched, (e) no secrets, (f) idempotent (no re-copy if already enforcing). Post '[REVIEW] <GO|NO_GO> — secret-gate-propagate @ <evidence> — lens: cross-machine gate propagation, reviewer secret-gate-prop-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const REPORT = CONST + `
ROLE: report. If GO + both enforcing: comment ${TASK} completed with per-machine evidence (shas, raw-canary literals), complete it, post to #board (the fleet-verify loop re-measures and will stop posting [INCIDENT]). If NO_GO: comment findings, leave in_progress with residue.
Return (JSON): { taskState: string, residue: [string] }
`

const PROP_SCHEMA = { type: 'object', properties: { machines: { type: 'array' }, allCopied: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['allCopied'] }
const VERIFY_SCHEMA = { type: 'object', properties: { station02: { type: 'object' }, station03: { type: 'object' }, shasMatch: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['station02', 'station03'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const REPORT_SCHEMA = { type: 'object', properties: { taskState: { type: 'string' }, residue: { type: 'array' } }, required: ['taskState'] }

phase('Propagate')
const propagate = await agent(PROPAGATE, { label: 'secret-gate-prop-fix', phase: 'Propagate', schema: PROP_SCHEMA })
log(`propagate: allCopied=${propagate && propagate.allCopied} machines=${propagate && propagate.machines ? propagate.machines.length : 0}`)

phase('Verify')
let verify = null
if (propagate && propagate.allCopied) {
  verify = await agent(VERIFY, { label: 'secret-gate-prop-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { station02: { enforcing: false }, station03: { enforcing: false }, shasMatch: false, evidence: 'copy did not land — verify skipped' }
}

phase('Review')
let review = null
if (verify && verify.station02 && verify.station02.enforcing && verify.station03 && verify.station03.enforcing) {
  review = await agent(REVIEW, { label: 'secret-gate-prop-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P0', title: 'one or both machines not enforcing or shas mismatch', detail: JSON.stringify(verify) }] }
}

phase('Report')
const report = await agent(REPORT, { label: 'secret-gate-prop-report', phase: 'Report', schema: REPORT_SCHEMA })

return { propagate, verify, review, report }
