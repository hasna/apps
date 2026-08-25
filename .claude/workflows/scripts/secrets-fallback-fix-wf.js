export const meta = {
  name: 'secrets-fallback-fix',
  description: 'Fix lane for BUG row b76e2d56 (incident 715558, task-drain dispatch 2026-08-20): @hasna/secrets 0.3.0 silently falls back to the local vault.db when the hosted API env vars are absent and reports "Vault is empty" at rc=0 — no error naming the mode switch (population-convention class). TDD regression first, smallest owned fix in apps/secrets (the fallback must NAME the mode switch), suite green, changeset, PR, CI, Fable review, merge, complete the row with evidence',
  phases: [
    { title: 'Investigate', detail: 'idempotency check + reproduce the silent fallback, name the code path' },
    { title: 'Fix', detail: 'failing regression test first, smallest owned fix, suite green, changeset, PR' },
    { title: 'Verify', detail: 'CI 5/5 at the new head' },
    { title: 'Review', detail: 'Fable adversarial review' },
    { title: 'Ship', detail: 'base gate, merge, complete row b76e2d56 with evidence' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = 'b76e2d56-38bf-468e-a6f9-90ea107e1b0e'

const CONST = `
You are a lane of the secrets-fallback-fix workflow (task-drain dispatch 2026-08-20, BUG row ${ROW}). Bug (incident 715558, measured by station-medicus 2026-08-20): after a session-server restart, bash tool shells on station01 lost the environment.d-sourced HASNA_SECRETS_API_* vars; @hasna/secrets 0.3.0 then SILENTLY fell back to the local vault.db (empty, 0 rows since Aug 17) and reported 'Vault is empty' at rc=0 — no error naming the fallback. Risk: any agent in a non-systemd shell misdiagnoses ALL hosted credentials as missing/deleted. The hosted API is healthy (1107 secrets, verified). The follow-up per the incident: a local-fallback emission that NAMES THE MODE SWITCH — population-convention class (state WHERE you looked and WHAT you counted alongside the result; never a silent clean zero from an unselected backing store). Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work; shared checkout dirty from other lanes — fetch refs and work from a worktree if the pull refuses). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/secrets-fallback-<n> from origin/main. NEW BRANCH fix/secrets-fallback; PR-first; never push to main. Commits end with 'Agent: secrets-fallback-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check for an existing open PR fixing the fallback (gh pr list --repo hasna/apps --search 'secrets fallback in:title,body'), and read the BUG row's comments for an existing fixer or duplicate filing. If a live fix exists, verify and record; do NOT duplicate.
- Scope is apps/secrets ONLY. The fix is the smallest owned change: when the hosted API env vars are absent and the CLI falls back to the local vault, it MUST emit an explicit notice naming the mode switch (the fallback path, the empty-local-vault state, and the fact that hosted credentials are not visible) — never a silent rc=0 'Vault is empty'. Preserve the existing fail-closed behavior for reads.
- TDD: failing regression test first (red: the silent fallback emits no mode-switch notice), smallest owned fix (green). Do NOT weaken tests.
- Verify: the secrets app suite green (record literal counts), 'bun install --frozen-lockfile' rc=0, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push, changeset (patch — bug fix).
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the PR and BUG row ${ROW}, posts to #board. English. Lineage 'conversations agents register' named secrets-fallback-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per the CONST). Then REPRODUCE: read apps/secrets — the store-selection code path (the env-var resolution + local-vault fallback; search for the 'Vault is empty' message and the storage-mode/backend selection), and reproduce the silent fallback in a test harness (env vars unset + empty local vault -> the CLI reports 'Vault is empty' rc=0 with no mode-switch notice). NAME THE CODE PATH and the exact place the notice belongs. State what you did not check.
Return (JSON): { idempotency: { existingPr: string|null, existingFixer: string|null, decision: string }, codePath: string, repro: string, fixDirection: string, testFiles: [string], evidence: string }
`

const FIX = CONST + `
ROLE: fix lane. Per the CONST + the code path ({CODEPATH}): (1) write the failing regression test first (the silent fallback must emit a notice naming the mode switch — fallback path, empty-local-vault state, hosted credentials not visible; never a silent rc=0 — red); (2) implement the smallest owned fix in apps/secrets; (3) full secrets suite green (literal counts), frozen install rc=0, secrets scan, changeset (patch), commit ('Agent: secrets-fallback-<your-role>'), push, open the PR referencing BUG ${ROW}.
Return (JSON): { prNumber: number, diffSummary: string, redBefore: {failed, named}, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks' on the PR ({PR}), re-run failed jobs, poll bounded (max 20 min), all five checks green at the new head (record the per-check table). The known environmental playwright stall, if the ONLY failure, re-run once and record.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PR ({PR}): (a) the regression test reproduces the silent fallback and the fix emits the mode-switch notice (red-before/green-after measured), (b) the fix is the smallest owned change, (c) fail-closed read behavior preserved, (d) no test weakening, (e) scope is apps/secrets only, (f) 5/5 CI green, (g) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — secrets-fallback-fix @ <sha> — lens: store-selection fallback, reviewer secrets-fallback-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge the PR (base-movement gate first — merge-tree against origin/main; gh pr merge --squash --body-file ending 'Agent: secrets-fallback-ship'), record the merged sha, complete BUG ${ROW} with the evidence (merged sha, suite counts, review verdict, incident 715558 linkage). If NO_GO: comment findings + resume condition, leave open.
Return (JSON): { merged: bool, mergedSha: string|null, rowState: string, residue: [string] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { idempotency: { type: 'object' }, codePath: { type: 'string' }, repro: { type: 'string' }, fixDirection: { type: 'string' }, testFiles: { type: 'array' }, evidence: { type: 'string' } }, required: ['idempotency', 'codePath'] }
const FIX_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, diffSummary: { type: 'string' }, redBefore: { type: 'object' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['prNumber', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'secrets-fallback-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
let fix = null
if (investigate && investigate.idempotency && investigate.idempotency.decision !== 'already-done') {
  fix = await agent(FIX.replace('{CODEPATH}', investigate.codePath), { label: 'secrets-fallback-fix', phase: 'Fix', schema: FIX_SCHEMA })
} else {
  fix = { prNumber: 0, diffSummary: 'skipped', evidence: 'idempotency: already-done' }
}

phase('Verify')
let verify = null
if (fix && fix.prNumber) {
  verify = await agent(VERIFY.replace('{PR}', String(fix.prNumber)), { label: 'secrets-fallback-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'fix did not open a PR', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW.replace('{PR}', String(fix.prNumber)), { label: 'secrets-fallback-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'fix/verify did not complete', detail: JSON.stringify({ fix, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'secrets-fallback-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { investigate, fix, verify, review, ship }
