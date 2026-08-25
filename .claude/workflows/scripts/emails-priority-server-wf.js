export const meta = {
  name: 'emails-priority-server',
  description: 'Owner ask completion: the priority inbox exists CLI-side (1.3.16 installed) and the server is now 1.3.16 (emails-prod:31), but the SERVER-side folder pushdown omits "priority" (MESSAGE_FOLDERS enum: inbox/starred/sent/archived/spam/trash) — priority server support was never shipped (PR #93 was CLI-side). This lane: implement server-side priority folder (enum + serve via priority-sender-rules, migration 0026 wiring), TDD, changeset (emails -> 1.3.17), PR, review, merge, deploy emails-serve, LIVE-VERIFY priority rows; record the data step (populating the owner\'s priority sender rules)',
  phases: [
    { title: 'Implement', detail: 'server priority folder (MESSAGE_FOLDERS + priority-sender-rules serve), TDD, changeset 1.3.17, PR' },
    { title: 'Verify', detail: '5/5 CI + suite green at the new head' },
    { title: 'Review', detail: 'Fable adversarial review' },
    { title: 'Ship', detail: 'merge, deploy emails-serve from new main, live-verify priority rows' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'

const CONST = `
You are a lane of the emails-priority-server workflow (2026-08-19, owner ask: priority inbox for hasna/emails). Measured state: CLI 1.3.16 installed with the priority folder; the hosted server is now 1.3.16 (emails-prod:31, /version=1.3.16) BUT the server-side folder pushdown omits priority — apps/emails/src/server/self-hosted/service.ts:1675 validates 'folder must be one of ' + MESSAGE_FOLDERS.join(', ') (inbox/starred/sent/archived/spam/trash), so 'emails inbox list --folder priority' still walks 10000 rows (rc=1). The priority-sender-rules API exists on main (api-routes.ts) backed by migration 0026_priority_sender_rules (currently zero rules). Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/emailsp-<n> from origin/main. PR-first; never push to main. Commits end with 'Agent: emailsp-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check for an open PR touching the emails server folder enum / priority (gh pr list --search 'priority in:title,body'); if the server priority support already landed, verify and record; do not duplicate.
- THE IMPLEMENTATION: (1) add 'priority' to the server's MESSAGE_FOLDERS (the smallest owned change), (2) serve the priority folder from the priority-sender-rules table (migration 0026 — the folder lists messages whose sender matches a priority rule; classify per the rules' semantics — read the migration + the existing API routes and follow their model; with zero rules the folder is EMPTY and the list completes with rc=0 — never a 10000-row walk), (3) the CLI-side behavior stays unchanged (the CLI already detects the honored filter). TDD: the regression is 'GET /v1/messages?folder=priority returns rows or [] promptly with the filter honored' (a stub server test asserting the folder is accepted and the rule-based classification filters — two-sided: a matching sender appears, a non-matching one does not).
- CHANGESET: add a patch changeset for apps/emails (the fix must release — registry already has 1.3.16; the changeset computes 1.3.17). VERSION COORDINATION: the wave #602's emails entry (registry 1.3.16 taken, same class as loops) — record on the PR that the wave's emails changeset must compute 1.3.17 or drop; do NOT double-bump.
- Verify: emails suite green (record counts), 'bun install --frozen-lockfile' rc=0, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the PR, posts to #board. English. Lineage 'conversations agents register' named emailsp-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const IMPLEMENT = CONST + `
ROLE: implement lane. Per the CONST: the server priority folder (enum + rule-based serve), TDD two-sided regression, emails suite green (record counts), changeset (patch, computes 1.3.17), secrets scan, commit ('Agent: emailsp-<your-role>'), push, PR. Record the version-coordination note on the PR.
Return (JSON): { prNumber: number, diffSummary: string, folderAccepted: string, classificationTest: string, suiteCounts: {passed, failed}, changesetVersion: string, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks' on the PR ({PR}), re-run failed jobs, poll bounded (max 20 min), all green at the new head (record the per-check table). The known environmental playwright stall, if the ONLY failure, re-run once and record.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PR ({PR}): (a) MESSAGE_FOLDERS gains priority with the smallest owned change, (b) the priority folder is served from the rules (zero rules = empty rc=0, never a walk), (c) two-sided classification test, (d) changeset computes 1.3.17 with the wave coordination noted, (e) CI green, secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — emails-priority-server @ <sha> — lens: server priority folder, reviewer emailsp-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge the PR (base-movement gate first; gh pr merge --squash --body-file ending 'Agent: emailsp-ship'), record the merged sha, then DEPLOY the emails-serve from the new main through the owning machinery (hasnaxyz/iapp-infra apps/emails/prod — register-api-taskdef.sh --deploy with the new image; the lane worktree pattern; rollback = rollback-api-taskdef.sh <prior rev>), and LIVE-VERIFY: /version = 1.3.17, 'emails inbox list --folder priority --limit 5 --json' completes with rc=0 (rows or []), --folder unread/inbox still work. Record the data step: populating the OWNER'S priority sender rules (which senders) is a follow-up for the owner's direction — record it as a residue, do not invent rules. If the deploy cannot run from here, record the exact gate + resume condition.
Return (JSON): { merged: bool, mergedSha: string|null, deployed: bool, deployedRev: string, liveVersion: string, priorityListOk: bool, residue: [string] }
`

const IMPL_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, diffSummary: { type: 'string' }, folderAccepted: { type: 'string' }, classificationTest: { type: 'string' }, suiteCounts: { type: 'object' }, changesetVersion: { type: 'string' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['prNumber', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, deployed: { type: 'boolean' }, deployedRev: { type: 'string' }, liveVersion: { type: 'string' }, priorityListOk: { type: 'boolean' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Implement')
const implement = await agent(IMPLEMENT, { label: 'emailsp-implement', phase: 'Implement', schema: IMPL_SCHEMA })

phase('Verify')
let verify = null
if (implement && implement.prNumber) {
  verify = await agent(VERIFY.replace('{PR}', String(implement.prNumber)), { label: 'emailsp-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'implement did not open a PR', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW.replace('{PR}', String(implement.prNumber)), { label: 'emailsp-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'implement/verify did not complete', detail: JSON.stringify({ implement, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'emailsp-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { implement, verify, review, ship }
