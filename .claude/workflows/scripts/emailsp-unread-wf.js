export const meta = {
  name: 'emailsp-unread',
  description: 'Fix hasna/apps bug 1f3a870c (high, production-impacting on the hosted PG16 backend): unreadByAddress counts is_read:true messages as unread. Repro on station01: EMAILS_TEST_POSTGRES_URL=postgresql://postgres@127.0.0.1:5432/emailsp_priority_test bun test src/server/self-hosted/postgres.integration.test.ts -t unread-by-address — expected unread 2, received 3. Finder hypothesis: message_recipients.is_read does not reflect insert-time is_read. TDD (red first on the given repro), smallest owned fix, patch changeset for apps/emails (pool drives one 1.3.17 bump in the wave — coordinate with the emails-priority-server lane on the same app), 5/5 CI, Fable review, merge, complete 1f3a870c',
  phases: [
    { title: 'Fix', detail: 'TDD: reproduce rc=1 on the given PG16 command, fix, rc=0; changeset' },
    { title: 'Verify', detail: '5/5 CI green at the new head + local PG16 repro green' },
    { title: 'Review', detail: 'Fable adversarial review (scoped)' },
    { title: 'Ship', detail: 'merge GO, complete 1f3a870c; version note: emails 1.3.17 rides the wave' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '1f3a870c-b29e-45fe-bf07-8eb63d05c642'

const CONST = `
You are a lane of the emailsp-unread workflow (2026-08-19). Bug row ${ROW} (high): on PG16 the emails hosted backend counts a message created with is_read:true as unread — unreadByAddress returns 3 instead of 2 in the integration test. Reproduced on clean base main 9e0b93fcc (finder stashed all lane changes). Repro: EMAILS_TEST_POSTGRES_URL=postgresql://postgres@127.0.0.1:5432/emailsp_priority_test bun test src/server/self-hosted/postgres.integration.test.ts -t unread-by-address (station01, PG16 running locally; the emailsp_priority_test DB exists). Skipped in CI (needs PG env) — the LOCAL PG16 repro IS the acceptance gate, CI is the secondary gate. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/emailsp-u-<n> from origin/main. NEW BRANCH emailsp-unread-fix; PR-first; never push to main. Commits end with 'Agent: emailsp-u-<your-role>' (the ONLY attribution line).
- CO-LANE NOTICE: the emails-priority-server lane (PR for server-side priority folder) is IN FLIGHT on apps/emails. Do NOT touch MESSAGE_FOLDERS, priority-sender-rules, migration 0026, or the folder-validation surface — that lane owns them. Your scope is the unread-by-address counting defect only. Branch isolation; the merge base-movement gate handles sequencing.
- IDEMPOTENCY CHECK FIRST: check for an open PR touching unreadByAddress / message_recipients is_read (gh pr list --search 'unread in:title,body'); if the fix already landed, verify and record; do not duplicate.
- THE FIX (smallest owned change): measure the real insert path — why message_recipients.is_read does not reflect the message's insert-time is_read, and why unreadByAddress counts it. Fix the root cause (insert/recipient write or the count query, whichever measurement proves), keep the regression: the given integration test asserting unread 2 for first@example.test (is_read:true message NOT counted).
- CHANGESET: patch changeset for apps/emails. VERSION COORDINATION: the emails-priority-server lane ALSO carries an emails patch changeset — the wave (#602) pools changesets and computes ONE emails 1.3.17 bump from the pool; record on the PR that the pool (not the per-PR changeset) drives the version, so no double-bump and no coordination conflict.
- Verify: the local PG16 repro rc=0 at the new head (literal), emails hermetic suite green (record counts), 'bun install --frozen-lockfile' rc=0, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. The PG integration test also needs the hermetic suite to stay green.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the PR and row ${ROW}, posts to #board. English. Lineage 'conversations agents register' named emailsp-u-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const FIX = CONST + `
ROLE: fix lane. Per the CONST: reproduce the rc=1 on the given PG16 command (literal), measure the root cause (insert path vs count query), write the regression (red first), smallest owned fix, PG16 repro rc=0 + hermetic suite green (record counts), changeset, secrets scan, commit ('Agent: emailsp-u-<your-role>'), push, open the PR referencing ${ROW}.
Return (JSON): { prNumber: number, diffSummary: string, rootCause: string, beforeRc: string, afterRc: string, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks' on the PR ({PR}), re-run failed jobs, poll bounded (max 20 min), all five checks green at the new head (record the per-check table; the PG integration test is skipped in CI by design — record that the local PG16 repro is the acceptance gate and re-run it here if the environment is available). The known environmental playwright stall, if the ONLY failure, re-run once and record.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, pgReproOk: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PR ({PR}): (a) root cause measured, not guessed (the evidence names the insert/recipient path), (b) the regression asserts unread 2 with the is_read:true message NOT counted, (c) the fix is the smallest owned change, scope-limited to the counting defect (the priority-folder surface untouched), (d) changeset present with the pool-coordination note, (e) CI green + PG16 repro green, secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — emailsp-unread @ <sha> — lens: unread-by-address on PG16, reviewer emailsp-u-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge the PR (base-movement gate first — merge-tree against origin/main; gh pr merge --squash --body-file ending 'Agent: emailsp-u-ship'), record the merged sha, complete row ${ROW} with the evidence and the version note (emails 1.3.17 ships via the wave/publish-all pool; the deployed server updates on the next emails deploy). If NO_GO: comment findings + resume condition, leave pending.
Return (JSON): { merged: bool, mergedSha: string|null, rowState: string, residue: [string] }
`

const FIX_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, diffSummary: { type: 'string' }, rootCause: { type: 'string' }, beforeRc: { type: 'string' }, afterRc: { type: 'string' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['prNumber', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, pgReproOk: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Fix')
const fix = await agent(FIX, { label: 'emailsp-u-fix', phase: 'Fix', schema: FIX_SCHEMA })

phase('Verify')
let verify = null
if (fix && fix.prNumber) {
  verify = await agent(VERIFY.replace('{PR}', String(fix.prNumber)), { label: 'emailsp-u-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'fix did not open a PR', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW.replace('{PR}', String(fix.prNumber)), { label: 'emailsp-u-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'fix/verify did not complete', detail: JSON.stringify({ fix, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'emailsp-u-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { fix, verify, review, ship }
