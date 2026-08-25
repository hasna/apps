export const meta = {
  name: 'backup-freshness-fix',
  description: 'Fix the station01 backup-freshness monitor parse defect (multi-row --output text LastModified): JSON+jq parse, fixture regression, install, verify DRY_RUN fresh on both tiers',
  phases: [
    { title: 'Fix', detail: 'parse fix in backup_s3_freshness_check.sh + regression fixtures' },
    { title: 'Verify', detail: 'DRY_RUN run reports FRESH on both tiers at the installed copy' },
    { title: 'Review', detail: 'independent adversarial review of the fix' },
    { title: 'Report', detail: 'bug task + #board' },
  ],
}

const TASK = '52f7dee4-99b5-4ef0-932d-06bb90308926'

const CONST = `
You are a lane of the backup-freshness-fix workflow (2026-08-18, bug task ${TASK}). The station01 offsite-backup freshness monitor (backup_s3_freshness_check.sh, cron-scheduled, alerts #incidents) has been blind since 2026-08-18T00:37Z on BOTH tiers: 'unparsable LastModified ... Freshness UNKNOWN' every 30-min fire (#incidents 711499/711500). Final text = machine-readable JSON.

MEASURED ROOT CAUSE (repro on this machine, aws-cli 2.34.41 aarch64):
- The query 'aws s3api list-objects-v2 --bucket hasna-xyz-infra-backups-prod --prefix open-backup/station01/hasna-critical/ --profile hasna-xyz-infra --query "sort_by(Contents[?contains(Key,'charter-critical-dbs')],&LastModified)[-1].[LastModified,Size,Key]" --output text' returns TWO rows (the whole filtered+sorted list, [-1] dropped by the text renderer) whenever >=2 archives match the key filter — which has been true since the 00:20Z bkp_<ts>_<rand> archive appeared.
- The IDENTICAL query with --output json returns exactly ONE object (the newest) — verified.
- The script then does 'big_lm="$(printf '%s' "$big" | awk '{print $1}')"': awk prints the first field of EVERY line joined by newlines -> GNU date -d fails -> epoch 0 -> CHECK-FAILED branch. Both the critical block (~line 166-190) and the big-tier block (~line 118-141) share the shape.
- Live copy: /home/hasna/.local/bin/backup_s3_freshness_check.sh. Source snapshot: /home/hasna/.hasna/projects/workspaces/wks_kkxxcuqn2mjh/ops-scripts-baseline/backup_s3_freshness_check.sh — check whether the ops workspace (wks_kkxxcuqn2mjh) is a git repo; if yes, work in a worktree at ~/.hasna/repos/worktrees/<repo>/backup-freshness-fix-<n> from origin/main, PR-first (never push to main); if it is NOT a git repo, edit the workspace copy (or the canonical source of the live file — establish which one is canonical by comparing to the live ~/.local/bin copy) and sync to ~/.local/bin as the install step.
- The digitalization variant cron reuses the same script with BACKUP_FRESH_* env overrides — fixed by the same change. ALSO check /home/hasna/.local/bin/secrets_dr_freshness_check.sh for the SAME parse shape (multi-row text output + awk '{print $1}'); if it has the identical defect, fix it in the same change (same class, same fix), else record it as clean.

THE FIX (smallest owned): switch BOTH aws queries in backup_s3_freshness_check.sh to --output json and parse with jq: 'sort_by(.LastModified)[-1] | [.LastModified, .Size, .Key] | @tsv' with explicit guards for empty/missing Contents (the existing None/empty branches must still fire with the same alert text). Keep the error-redirect-to-stderr behavior. Keep the script's damped-alert and status-state machinery byte-identical otherwise.

REGRESSION FIXTURES (must live with the script — a test/ dir or a -test.sh sibling): the parse must (a) pick the NEWEST from a captured multi-row fixture (paste the real two-row output from the repro), (b) parse a single-row fixture, (c) fire the no-objects branch on an empty/None fixture, (d) fire the aws-error branch on rc!=0. Run the fixtures and show fail-before/pass-after.

NON-NEGOTIABLE:
- No secrets: never print/capture credential values; aws output contains only object keys/sizes/dates (no secrets) — but never echo $AWS_* or profile credentials. Capture path: redirect to files, never pipe large reads. Paste literal output lines.
- Verification BEFORE install: DRY_RUN=1 /home/hasna/.local/bin/backup_s3_freshness_check.sh must report FRESH on BOTH tiers (the 19:20:18Z critical archive and the big-tier archive state) with no 'unparsable'. Only then install the fixed file to ~/.local/bin (backup the old one first to ~/.local/bin/backup_s3_freshness_check.sh.bak-<date>) and re-run DRY_RUN once against the INSTALLED file. Then let the next cron fire be observed (note the check.log entry after the next :07/:37 fire).
- Commit attribution: 'Agent: backup-freshness-fix' trailer LAST in any commit message. No Co-Authored-By.
- Record as you go: comments on ${TASK}, posts to #board. English. Lineage identity 'conversations agents register' named backup-freshness-fix.
- IDEMPOTENCY: if the bug task is already completed with a verified fix when you start, verify the installed state and SKIP.
`

const FIX = CONST + `
ROLE: fix lane. Execute the fix per the CONST: locate the canonical source, apply the JSON+jq parse to both query blocks, write and run the regression fixtures (fail-before/pass-after), keep alert text and damping identical, shellcheck the result. If the ops workspace is a git repo, commit + push + open a PR; else record the edit path. Do NOT install yet (the Verify lane does that after review — actually: if the workspace is NOT a git repo, the edit IS the artifact; install to ~/.local/bin as the final step of this lane so Verify can test the installed copy).
Return (JSON): { fixed: bool, sourcePath: string, isGitRepo: bool, prNumber: number|null, fixtures: {run: bool, failBefore: string, passAfter: string}, otherScriptsChecked: [{path, sameDefect: bool, action: string}], installed: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Against the INSTALLED copy (/home/hasna/.local/bin/backup_s3_freshness_check.sh): (1) run the regression fixtures; (2) DRY_RUN=1 run — capture stdout+stderr to files and paste the literal lines; BOTH tiers must report FRESH or a correct STALE/ABSENT state — ZERO 'unparsable' and ZERO CHECK-FAILED; (3) confirm the digitalization variant config (BACKUP_FRESH_PREFIX=open-backup/station01/digitalization/ ...) also runs clean under DRY_RUN with its env overrides; (4) note whether the next cron fire produced a clean log line (check.log tail after the next :07/:37 fire if one happens during your run). If ANY tier still reports unparsable/CHECK-FAILED, return failed=true with the literal output — do NOT pass.
Return (JSON): { passed: bool, dryRunCritical: string, dryRunBig: string, dryRunDigitalization: string, cronLogTail: string, failed: bool }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the fix (the diff/edited source + fixtures + verify evidence): (a) the JSON+jq parse selects the NEWEST object correctly with empty/None guards; (b) alert texts, damping, status-state machinery unchanged; (c) fixtures genuinely discriminate (multi-row -> newest; single-row; empty/None; aws-error); (d) installed copy == fixed source; (e) no secrets in any artifact. Post '[REVIEW] <GO|NO_GO> — backup-freshness-fix @ <sha-or-path> — lens: parse fix, reviewer backup-freshness-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const REPORT = CONST + `
ROLE: report. Aggregate: fix, verify result, review verdict. If GO and verify passed: comment ${TASK} completed with the evidence and complete the task (todos update ${TASK} --status completed); if NO_GO: comment the findings, leave the task in_progress, return residue. Post one line to #board. Also note the next cron fire observation (check.log line after the next fire, if observed).
Return (JSON): { taskState: string, prNumber: number|null, residue: [string] }
`

const FIX_SCHEMA = { type: 'object', properties: { fixed: { type: 'boolean' }, sourcePath: { type: 'string' }, isGitRepo: { type: 'boolean' }, prNumber: { type: ['number', 'null'] }, fixtures: { type: 'object' }, otherScriptsChecked: { type: 'array' }, installed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['fixed'] }
const VERIFY_SCHEMA = { type: 'object', properties: { passed: { type: 'boolean' }, dryRunCritical: { type: 'string' }, dryRunBig: { type: 'string' }, dryRunDigitalization: { type: 'string' }, cronLogTail: { type: 'string' }, failed: { type: 'boolean' } }, required: ['passed'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const REPORT_SCHEMA = { type: 'object', properties: { taskState: { type: 'string' }, prNumber: { type: ['number', 'null'] }, residue: { type: 'array' } }, required: ['taskState'] }

phase('Fix')
const fix = await agent(FIX, { label: 'backup-freshness-fix-lane', phase: 'Fix', schema: FIX_SCHEMA })
log(`fix: fixed=${fix && fix.fixed} pr=${fix && fix.prNumber}`)

phase('Verify')
const verify = await agent(VERIFY, { label: 'backup-freshness-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
log(`verify: passed=${verify && verify.passed}`)

phase('Review')
let review = null
if (fix && fix.fixed && verify && verify.passed) {
  review = await agent(REVIEW, { label: 'backup-freshness-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P0', title: 'fix or verify did not pass', detail: JSON.stringify({ fix, verify }) }] }
}

phase('Report')
const report = await agent(REPORT, { label: 'backup-freshness-report', phase: 'Report', schema: REPORT_SCHEMA })

return { fix, verify, review, report }
