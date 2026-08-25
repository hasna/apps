export const meta = {
  name: 'session-env-pipeline-fix',
  description: 'Fix lane for BUG row 7d5f08a1 (incident 715712, task-drain dispatch 2026-08-20): harness session-env re-provision drops hosted API env for TODOS/KNOWLEDGE/EMAILS — CLIs silently fall back to empty local SQLite at rc=0. Verify the env-export/session-render pipeline restores hosted API env on every provision. TDD regression first, smallest owned fix, suite green, changeset, PR, CI, Fable review, merge, complete the row with evidence',
  phases: [
    { title: 'Investigate', detail: 'idempotency check + reproduce the env-drop on re-provision, name the code path' },
    { title: 'Fix', detail: 'failing regression test first, smallest owned fix, suite green, changeset, PR' },
    { title: 'Verify', detail: 'CI 5/5 at the new head' },
    { title: 'Review', detail: 'Fable adversarial review' },
    { title: 'Ship', detail: 'base gate, merge, complete row 7d5f08a1 with evidence' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '7d5f08a1-d217-4a58-89a3-4d8c0b8e5ed7'

const CONST = `
You are a lane of the session-env-pipeline-fix workflow (task-drain dispatch 2026-08-20, BUG row ${ROW}). Bug (incident 715712, station01, 2026-08-20T10:17Z): a harness session-env re-provision DROPPED the hosted API credentials for TODOS (HASNA_TODOS_API_URL/KEY), KNOWLEDGE (HASNA_KNOWLEDGE_API_URL/KEY) and EMAILS (EMAILS_SELF_HOSTED_URL/KEY); the CLIs then SILENTLY fell back to empty on-box SQLite stores — false-empty reads at rc=0 (a mailbox appeared empty; todos tasks appeared gone). Records written before the drop are safe in the hosted stores. Root cause on the incident: harness session-env re-provision. Owned fix per the incident: verify the env-export/session-render pipeline restores hosted API env on EVERY provision. Same silent-fallback family as incident 715558 (secrets) and BUG 34c5512c (identities roster) — the fallback must never present an unselected backing store as the real population. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work; shared checkout dirty from other lanes — fetch refs and work from a worktree if the pull refuses). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/env-pipeline-<n> from origin/main. NEW BRANCH fix/session-env-pipeline; PR-first; never push to main. Commits end with 'Agent: env-pipeline-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check for an existing open PR fixing the env re-provision (gh pr list --repo hasna/apps --search 'env provision in:title,body' + 'session env in:title,body' + 're-provision in:title,body'), and read the BUG row's comments for an existing fixer or duplicate filing. If a live fix exists, verify and record; do NOT duplicate.
- SCOPE: the env-export/session-render pipeline — the harness code path that (re)provisions a session environment and writes/exports the hosted API env. FIND the owning package first (the incident names 'harness session-env re-provision'; search the monorepo for the provisioner/export code — session-env, env-export, session render, provision). The fix: every provision MUST (re)apply the hosted API env vars (the exact set from the incident: HASNA_TODOS_API_URL/KEY, HASNA_KNOWLEDGE_API_URL/KEY, EMAILS_SELF_HOSTED_URL/KEY, plus whatever the pipeline's contract names), or fail loudly. Also: the CLIs' silent local fallback when the env is absent is the SAME family as the just-landed secrets fix (PR #681: stderr notice naming the mode switch) — if the same resolver pattern exists in the affected packages' store selection (todos/knowledge/emails), the fallback notice is in scope ONLY as the smallest owned mirror; the primary fix is the pipeline restoring the env.
- TDD: failing regression test first (red: a re-provision does not restore the hosted API env / the fallback is silent), smallest owned fix (green). Do NOT weaken tests.
- Verify: the owning package's suite green (record literal counts), 'bun install --frozen-lockfile' rc=0, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push, changeset (patch — bug fix).
- No secrets: never print/capture/commit credential VALUES — env NAMES only; incident 715743's root cause is the exact failure to avoid (a value-shaped sed redaction missed). Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the PR and BUG row ${ROW}, posts to #board and the incident thread 715712. English. Lineage 'conversations agents register' named env-pipeline-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per the CONST). Then REPRODUCE/MEASURE: find the env-export/session-render pipeline code path (the provisioner that writes/export the session env), read what it exports on a fresh provision vs a re-provision, and identify why the hosted API vars are dropped on re-provision (missing from the export list? a partial write? ordering?). NAME THE CODE PATH and the exact place the restore belongs. Also measure whether the todos/knowledge/emails store-selection silently falls back (same family) and whether that resolver is shared. State what you did not check.
Return (JSON): { idempotency: { existingPr: string|null, existingFixer: string|null, decision: string }, owningPackage: string, codePath: string, repro: string, fixDirection: string, testFiles: [string], evidence: string }
`

const FIX = CONST + `
ROLE: fix lane. Per the CONST + the code path ({CODEPATH}): (1) write the failing regression test first (a re-provision MUST restore the hosted API env — red); (2) implement the smallest owned fix per the fix direction ({FIXDIRECTION}); (3) full suite green (literal counts), frozen install rc=0, secrets scan, changeset (patch), commit ('Agent: env-pipeline-<your-role>'), push, open the PR referencing BUG ${ROW} and incident 715712.
Return (JSON): { prNumber: number, diffSummary: string, redBefore: {failed, named}, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks' on the PR ({PR}), re-run failed jobs, poll bounded (max 20 min), all five checks green at the new head (record the per-check table). The known environmental playwright stall, if the ONLY failure, re-run once and record.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PR ({PR}): (a) the regression test reproduces the env-drop on re-provision and the fix restores the hosted API env (red-before/green-after measured), (b) the fix is the smallest owned change in the owning package, (c) no credential VALUE appears anywhere in the diff or transcripts (env NAMES only), (d) the silent-fallback mirror (if any) names the mode switch, (e) no test weakening, (f) 5/5 CI green, (g) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — session-env-pipeline-fix @ <sha> — lens: session env provisioning, reviewer env-pipeline-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge the PR (base-movement gate first — merge-tree against origin/main; gh pr merge --squash --body-file ending 'Agent: env-pipeline-ship'), record the merged sha, complete BUG ${ROW} with the evidence (merged sha, suite counts, review verdict, incident 715712 linkage). If NO_GO: comment findings + resume condition, leave open.
Return (JSON): { merged: bool, mergedSha: string|null, rowState: string, residue: [string] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { idempotency: { type: 'object' }, owningPackage: { type: 'string' }, codePath: { type: 'string' }, repro: { type: 'string' }, fixDirection: { type: 'string' }, testFiles: { type: 'array' }, evidence: { type: 'string' } }, required: ['idempotency', 'owningPackage', 'codePath'] }
const FIX_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, diffSummary: { type: 'string' }, redBefore: { type: 'object' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['prNumber', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'env-pipeline-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
let fix = null
if (investigate && investigate.idempotency && investigate.idempotency.decision !== 'already-done') {
  fix = await agent(FIX.replace('{CODEPATH}', investigate.codePath).replace('{FIXDIRECTION}', investigate.fixDirection), { label: 'env-pipeline-fix', phase: 'Fix', schema: FIX_SCHEMA })
} else {
  fix = { prNumber: 0, diffSummary: 'skipped', evidence: 'idempotency: already-done' }
}

phase('Verify')
let verify = null
if (fix && fix.prNumber) {
  verify = await agent(VERIFY.replace('{PR}', String(fix.prNumber)), { label: 'env-pipeline-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'fix did not open a PR', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW.replace('{PR}', String(fix.prNumber)), { label: 'env-pipeline-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'fix/verify did not complete', detail: JSON.stringify({ fix, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'env-pipeline-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { investigate, fix, verify, review, ship }
