export const meta = {
  name: 'bulk-internal-move',
  description: 'Owner 2026-08-19 (row 9df3f88e): move 25 apps from the open-source set to internal apps, PR-first with adversarial review steps. Reuses/extends the internal-move skill (accounts move, bdb1c431); banking checked for an existing PR first; computer renamed (new name, NOT station); waves of per-app move lanes, Fable review per PR, ship via standing machinery',
  phases: [
    { title: 'Prepare', detail: 'census the 25 apps; check banking existing PR; check the internal-move skill (accounts move) — reuse or extend; propose computer rename' },
    { title: 'Move', detail: 'per-app move lanes in waves of 4, PR-first, each via the skill procedure' },
    { title: 'Review', detail: 'Fable adversarial review per PR (bounded, two cycles max)' },
    { title: 'Ship', detail: 'merge GO PRs, publish handoff, complete row; unprocessed set recorded for the next pass' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '9df3f88e'
const SKILL_ROW = 'bdb1c431'

const CONST = `
You are a lane of the bulk-internal-move workflow (2026-08-19, owner-authorized). Owner: move the listed apps from the open-source set to internal apps, 'get workflow going with adversarial review steps'. Apps: actions, announce, banking, billing, brains, browser, computer (RENAME — new name required; NOT 'station', which is reserved for the machines->stations rename; propose and pick, record for the owner), consolidations, evals, fleet, gateway, holdings, markdown, pixels, router, search, sessions, shortlinks, signatures, snapshots, tenants, terminal, treasury, ui, workforce. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/bulkmove-<n> from origin/main. PR-first; never push to main. Commits end with 'Agent: bulkmove-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check ${ROW} comments + open PRs; banking may ALREADY have a move PR (the owner believes so) — verify and record, do not duplicate. Check the internal-move SKILL from the accounts move (${SKILL_ROW} / its workflow): if the skill exists, THE MOVE LANES USE IT; if it does not exist yet, the prepare lane builds/extends the generalized procedure and the accounts move dedupes against it.
- THE AUTHORITIES: global-monorepo-placement (destination repo + app group per role), global-monorepo-app-layout (manifest-only registration, one-way deps), internal-apps registry.json (immutable reviewed tuples), npm scopes, consumer impact, [BREAKING] sequencing for scope changes.
- THE MOVE per app: destination placement, package scope decision, registry tuple, every consumer updated, suite green, PR-first. Waves of 4 concurrent move lanes; each PR gets a Fable review (bounded, two remediation cycles max). The computer rename proposes + picks the new name (record the choice + rationale for the owner; never 'station').
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on ${ROW} and the skill row, posts to #board, mementos. English. Lineage 'conversations agents register' named bulkmove-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const PREPARE = CONST + `
ROLE: prepare lane. Per the CONST: census the 25 apps' current state (repo/dir/package/scope/consumers), CHECK banking's existing move PR (record its number + state), CHECK the internal-move skill (exists? where? — from the accounts move), and PROPOSE the computer rename (candidates + recommendation, never 'station'). Return the per-app move manifest (destination, scope decision, consumer list) + the skill state + the computer rename decision.
Return (JSON): { apps: [{name, destination, scopeDecision, consumers: [string]}], bankingPr: {number, state} | null, skillState: 'exists'|'absent', skillPath: string|null, computerRename: {chosen, rationale, candidates: [string]}, evidence: string }
`

const MOVE = CONST + `
ROLE: move lanes ({APPS} — one app per lane, waves of 4 handled by the script). Per the CONST + the manifest ({MANIFEST} for your app): execute the move via the skill procedure (or the generalized procedure if the skill is absent — and the prepare lane records the extension), PR-first, consumers updated, suite green (record counts), secrets scan, commit ('Agent: bulkmove-<your-role>'), push, PR referencing ${ROW}. If a real gate (registry/ownership/scope) blocks, record the exact gate + resume condition.
Return (JSON): { prs: [{app, prNumber, diffSummary, suiteCounts: {passed, failed}}], gatesHit: [string], evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review each move PR ({PRS}): placement/scope decision matches the authorities, consumers complete, suite green, secrets clean, PR-first, no scope creep, the computer rename is not 'station'. Post '[REVIEW] <GO|NO_GO> — bulkmove <app> @ <sha> — lens: internal-app move, reviewer bulkmove-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max per PR.
Return (JSON): { prs: [{number, verdict, findings: [{severity, title, detail}]}] }
`

const SHIP = CONST + `
ROLE: ship. Merge the GO PRs (base-movement gate; squash with 'Agent: bulkmove-ship'), record the publish handoff (per-app, via the standing machinery), record the unprocessed set for the next pass (apps whose gates or reviews did not complete), update the skill row if the procedure was extended, complete ${ROW} or leave in_progress with the unprocessed set. Post the pass summary to #board.
Return (JSON): { merged: [{app, prNumber, sha}], publishHandoff: string, unprocessed: [string], skillUpdated: bool, rowState: string, residue: [string] }
`

const PREP_SCHEMA = { type: 'object', properties: { apps: { type: 'array' }, bankingPr: { type: ['object', 'null'] }, skillState: { type: 'string' }, skillPath: { type: ['string', 'null'] }, computerRename: { type: 'object' }, evidence: { type: 'string' } }, required: ['apps', 'skillState'] }
const MOVE_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } }, gatesHit: { type: 'array' }, evidence: { type: 'string' } }, required: ['prs'] }
const REVIEW_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'array' }, publishHandoff: { type: 'string' }, unprocessed: { type: 'array' }, skillUpdated: { type: 'boolean' }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Prepare')
const prepare = await agent(PREPARE, { label: 'bulkmove-prepare', phase: 'Prepare', schema: PREP_SCHEMA })
const apps = (prepare && prepare.apps) || []
log(`prepare: ${apps.length} apps, skill=${prepare && prepare.skillState}, banking=${prepare && prepare.bankingPr ? '#' + prepare.bankingPr.number : 'none'}`)

phase('Move')
const moveResults = []
for (let w = 0; w < apps.length; w += 4) {
  const wave = apps.slice(w, w + 4)
  const rs = await parallel(wave.map(a => () =>
    agent(MOVE.replace('{APPS}', JSON.stringify([a])).replace('{MANIFEST}', JSON.stringify(a)), { label: `bulkmove-${a.name}`, phase: 'Move', schema: MOVE_SCHEMA }),
  ))
  moveResults.push(...rs.filter(Boolean))
}

phase('Review')
let review = null
const prs = moveResults.flatMap(r => (r.prs || [])).filter(p => p.prNumber)
if (prs.length) {
  review = await agent(REVIEW.replace('{PRS}', JSON.stringify(prs)), { label: 'bulkmove-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { prs: [] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'bulkmove-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { prepare, moves: moveResults, review, ship }
