export const meta = {
  name: 'accounts-display',
  description: 'Owner 2026-08-19 (row b27cc4a0): accounts app elegant display — CLI list/show output as JSON or table, per-machine auth status stored and rendered. TDD, Fable review, PR-first, ship via standing machinery',
  phases: [
    { title: 'Analyze', detail: 'map the accounts CLI display surfaces + the profile store (auth state per machine)' },
    { title: 'Implement', detail: 'table + JSON renderers, per-machine auth-status field stored, CLI verbs' },
    { title: 'Review', detail: 'Fable adversarial review' },
    { title: 'Ship', detail: 'merge GO PRs, live-verify the new verbs, report' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = 'b27cc4a0'

const CONST = `
You are a lane of the accounts-display workflow (2026-08-19, owner-authorized). Owner: 'for accounts we need to be able to see like especially when I am displaying information, information should be also displayed like a JSON or in a table. For instance, for better viewing and because right now it's all messy via the CLI. And I should be able to view these properly and see information more elegantly. When I'm displaying accounts, I should be able to see the accounts if they're authenticated on a certain machine or not, and we should store this information.' No rename — accounts stays 'accounts'. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/accdisp-<n> from origin/main. PR-first; never push to main. Commits end with 'Agent: accdisp-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check ${ROW} comments + open PRs touching apps/accounts; do not duplicate.
- THE FEATURE: (1) CLI display surfaces (list/show) render as a TABLE by default and --json for machine output (clean columns, no messy ad-hoc lines; keep the existing --json contract compatible); (2) a per-machine auth-status field: whether an account/profile is authenticated on a given machine, STORED in the accounts domain (profile metadata — the fleet already records revocation notes on profile descriptions; this formalizes it as a first-class field); (3) the verbs expose it: e.g. list shows an auth-status column, show shows per-machine status. TDD first (the rendering + status tests), smallest owned change.
- Verify: accounts suite green (record counts), secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on ${ROW}, posts to #board, mementos. English. Lineage 'conversations agents register' named accdisp-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const ANALYZE = CONST + `
ROLE: analyze lane. Map: the accounts CLI verbs and their current display code (messy spots named), the profile/store schema (what auth state exists today: lastUsedAt, revocation notes, per-machine keys), and where a per-machine auth-status field belongs (schema + migration surface). Return the exact change plan (files, schema field, verbs).
Return (JSON): { plan: {schemaField, migrationSurface, verbs: [string], displayFiles: [string]}, messySpots: [string], evidence: string }
`

const IMPLEMENT = CONST + `
ROLE: implement lane. Per the analyze plan ({PLAN}): TDD the table + JSON renderers and the per-machine auth-status field (stored; migration if the surface has one), wire the verbs, suite green, secrets scan, commit ('Agent: accdisp-<your-role>'), push, PR referencing ${ROW}.
Return (JSON): { prNumber: number, diffSummary: string, tests: {passed, failed}, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PR ({PR}): the table/JSON renderers are clean and the --json contract stays compatible, the auth-status field is stored (not ephemeral), TDD proven (red run recorded), suite green, secrets clean, PR-first, no scope creep. Post '[REVIEW] <GO|NO_GO> — accounts-display @ <sha> — lens: display elegance + auth-status storage, reviewer accdisp-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO: merge the PR (base-movement gate first; squash with 'Agent: accdisp-ship'), LIVE-VERIFY the new verbs (run the table + --json + auth-status output against the real store; paste the literal output), complete ${ROW} with evidence. If NO_GO: comment findings + resume condition, leave in_progress.
Return (JSON): { merged: bool, mergedSha: string|null, liveOutput: string, rowState: string, residue: [string] }
`

const AN_SCHEMA = { type: 'object', properties: { plan: { type: 'object' }, messySpots: { type: 'array' }, evidence: { type: 'string' } }, required: ['plan'] }
const IMPL_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, diffSummary: { type: 'string' }, tests: { type: 'object' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['prNumber'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, liveOutput: { type: 'string' }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

const FINISH = CONST + `
ROLE: finish lane — the ship lane held the merge at the base-movement gate (accdisp-review GO @ 8e06faf0; origin/main moved to 1abfde30a; merge-tree differs from the reviewed head, so the merge result is unreviewed at head per global-pr-base-change-invalidates-review; apps/accounts files in the difference: 0). IDEMPOTENCY CHECK FIRST: check PR #633 comments and its head — if the merge already landed (or another lane merged it at a newer head), verify and record; do NOT duplicate a rebase or a merge. Per the CONST, complete the chain: (1) rebase feat/accdisp-1-auth-status-display onto origin/main (verify 'git diff origin/main...<new head> -- apps/accounts' equals the reviewed delta; content unchanged, so NO new adversarial review cycle is owed — the P2/P3 findings from accdisp-review are non-blocking); (2) force-push, re-run CI at the new head — all 5 jobs must pass at the NEW merge ref, not the stale one (bounded poll, max 20 min); (3) re-run the base-movement gate: 'git merge-tree --write-tree origin/main <new head>' then 'git diff --quiet <new head> <tree>' must return 0; if main moved AGAIN, rebase again and re-poll; (4) squash-merge with --body-file ending 'Agent: accdisp-ship'; (5) LIVE-VERIFY the new verbs against the real store (accounts list table output, --json with authStatus when present, accounts auth-status probe verb — paste the literal output); (6) complete row ${ROW} with merged sha + live evidence; if CI never greens or the gate cannot pass, leave in_progress with the exact resume condition.
Return (JSON): { merged: bool, mergedSha: string|null, ciGreenAtHead: bool, gateOk: bool, liveOutput: string, rowState: string, residue: [string] }
`

const FINISH_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, ciGreenAtHead: { type: 'boolean' }, gateOk: { type: 'boolean' }, liveOutput: { type: 'string' }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Analyze')
const analyze = await agent(ANALYZE, { label: 'accdisp-analyze', phase: 'Analyze', schema: AN_SCHEMA })

phase('Implement')
let implement = null
if (analyze && analyze.plan) {
  implement = await agent(IMPLEMENT.replace('{PLAN}', JSON.stringify(analyze.plan)), { label: 'accdisp-implement', phase: 'Implement', schema: IMPL_SCHEMA })
} else {
  implement = { prNumber: null }
}

phase('Review')
let review = null
if (implement && implement.prNumber) {
  review = await agent(REVIEW.replace('{PR}', String(implement.prNumber)), { label: 'accdisp-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'implement did not open a PR', detail: 'record the exact gate' }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'accdisp-ship', phase: 'Ship', schema: SHIP_SCHEMA })

phase('Finish')
let finish = null
if (ship && !ship.merged) {
  finish = await agent(FINISH, { label: 'accdisp-finish', phase: 'Finish', schema: FINISH_SCHEMA })
} else {
  finish = { merged: ship && ship.merged ? true : false, rowState: ship && ship.rowState ? ship.rowState : 'unknown', residue: [] }
}

return { analyze, implement, review, ship, finish }
