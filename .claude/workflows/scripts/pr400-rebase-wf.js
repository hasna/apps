export const meta = {
  name: 'pr400-rebase',
  description: 'Remediation lane for hasna/apps#400 (drain3 residue, row 111a9755): content GO at f1550606, merge-gate NO_GO after sibling #399 merged (f1fe3f2d) — main now deletes the baseUrl refusal that #400 still carries; merge-tree conflicts in 4 files. Fix: rebase 400 onto origin/main f1fe3f2d, resolve per the lane-verified composition (keep 399 baseUrl removal + 400 email-gate additions), suite + secrets, push, CI green, re-review, merge, complete 111a9755',
  phases: [
    { title: 'Rebase', detail: 'rebase #400 onto moved main, resolve per verified composition' },
    { title: 'Verify', detail: 'attachments suite green at new head + CI' },
    { title: 'Review', detail: 'Fable re-review at new head' },
    { title: 'Ship', detail: 'merge GO, complete row 111a9755' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PR = 400
const ROW = '111a9755-6ad3-49b1-8e7f-05e2c55726c3'

const CONST = `
You are a lane of the pr400-rebase workflow (2026-08-19, task-drain batch-3 residue). PR hasna/apps#${PR} (attachments hosted-path port: require_email/allowed_emails) — content GO at f1550606 (drain3-review), merge-gate NO_GO after sibling #399 merged (f1fe3f2d): main now deletes the baseUrl refusal in assertApiSupported that #400's branch still carries; merge-tree conflicts in 4 files (core/cloud-v1.ts, core/store.ts, serve/app.ts, serve/openapi.ts). The verified composition (drain3-fix): keep 399's baseUrl removal, keep 400's email-gate additions. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/pr400-r-<n>; work on the PR's OWN branch (find it via gh pr view ${PR} --json headRefName — never guess). PR-first; never push to main. Commits end with 'Agent: pr400-r-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check PR #${PR} comments — if the rebase already landed (head moved past f1550606), verify and record; do not duplicate.
- REBASE ONLY: rebase onto origin/main f1fe3f2d (or newer), resolve the 4 conflicted files in favor of the verified composition (both features present: baseUrl removal from #399's merged state + email-gate additions from #400), re-run the canonical attachments suite (apps/attachments/scripts/test.sh — per-file bun test isolation + tsc --noEmit, record counts), secrets scan (redirect + 'secrets scan input', rc 0 clean), commit ('Agent: pr400-r-<your-role>'), push --force-with-lease.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on PR #${PR} and row ${ROW}, posts to #board. English. Lineage 'conversations agents register' named pr400-r-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const REBASE = CONST + `
ROLE: rebase lane. Per the CONST: rebase #${PR} onto origin/main, resolve per the verified composition, suite green (record counts), secrets scan, commit ('Agent: pr400-r-<your-role>'), push --force-with-lease. Record the new head + the per-file resolution summary.
Return (JSON): { newHead: string, resolutions: [{file, kept}], suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks ${PR}', re-run failed jobs (gh run rerun), poll bounded (max 20 min), require 'build + test (affected)' GREEN at the new head (record the per-check table). The playwright-chromium apt-mirror stall is environmental (task 552e18cc) — if the ONLY failure, re-run once and record. Re-verify the attachments suite green locally at the new head.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, suiteGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) — re-review at the new head. Review: (a) the composition keeps BOTH features (baseUrl removal + email-gate additions) with no silent discard, (b) the attachments suite green at head, (c) CI affected-build green, (d) secrets clean, (e) PR-first. Post '[REVIEW] <GO|NO_GO> — pr400-r @ <sha> — lens: post-rebase composition, reviewer pr400-r-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge PR #${PR} (base-movement gate first; gh pr merge --squash --body-file ending 'Agent: pr400-r-ship'), record the merged sha, complete row ${ROW} with the evidence. If NO_GO: comment findings + resume condition, leave in_progress.
Return (JSON): { merged: bool, mergedSha: string|null, rowState: string, residue: [string] }
`

const RB_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, resolutions: { type: 'array' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, suiteGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Rebase')
const rebase = await agent(REBASE, { label: 'pr400-r-rebase', phase: 'Rebase', schema: RB_SCHEMA })

phase('Verify')
let verify = null
if (rebase && rebase.newHead) {
  verify = await agent(VERIFY, { label: 'pr400-r-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'rebase did not complete', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW, { label: 'pr400-r-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'rebase/verify did not complete', detail: JSON.stringify({ rebase, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'pr400-r-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { rebase, verify, review, ship }
