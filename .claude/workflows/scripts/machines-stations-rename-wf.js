export const meta = {
  name: 'machines-stations-rename',
  description: 'Owner 2026-08-19 (row 8a009167): BREAKING rename machines app -> stations app. [BREAKING] post to announcements BEFORE landing; rename mechanics per monorepo laws; PRs -> Fable review -> merge -> standing ship-latest/publish-all machinery publishes; conformance verification loop per global-structural-change-verification. Sequenced AFTER the in-flight version wave (#602 carries machines bumps)',
  phases: [
    { title: 'Gate', detail: '[BREAKING] post first (what, blast radius, when, rollback); census wave state and sequence after it' },
    { title: 'Rename', detail: 'mechanics: dir/package/deps/consumers per monorepo laws; PRs' },
    { title: 'Review', detail: 'Fable adversarial review per PR' },
    { title: 'Ship', detail: 'merge GO PRs, conformance loop for the renamed structure, publish via publish-all, report' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '8a009167'

const CONST = `
You are a lane of the machines-stations-rename workflow (2026-08-19, owner-authorized). Owner: 'the machines app should be renamed to stations app. So this is a breaking change. We can post before we do it. And we start to lend PRs and then of course the whole workflow will go with ship and so on and publish and so on.' Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/m2s-<n> from origin/main. PR-first; never push to main. Commits end with 'Agent: m2s-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check ${ROW} comments + open PRs; if the rename already started, verify and record — do not duplicate.
- [BREAKING] POST FIRST (gate phase): to announcements BEFORE any rename PR lands — what changes (app/dir/package name machines -> stations), blast radius (consumers of @hasna/machines, fleet scripts, docs), when (after the current version wave resolves), rollback. The post itself is the gate: no rename PR before the post exists.
- SEQUENCING: the in-flight version wave (#602) and the machines release (#600) carry machines bumps. Census those first; the rename lands AFTER the wave resolves (do not collide; record the sequencing evidence).
- THE RENAME (mechanics per the monorepo laws): apps/machines -> apps/stations; package name decision (@hasna/stations with the alias/breaking note, or the declared path per monorepo placement); every dependency and consumer across the monorepo updated; CLI/verb names, data roots (~/.hasna/machines -> ~/.hasna/stations per canonical-paths convention), docs, manifests; a BREAKING changelog entry. Per global-structural-change-verification, the change ships WITH a conformance verification loop (deterministic checks + agentic review) and its expiry intent.
- Verify: the renamed app builds + its suite green (record counts), 'bun run check' or the exact gate at the new head, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on ${ROW}, posts to #board + #announcements ([BREAKING]), mementos. English. Lineage 'conversations agents register' named m2s-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const GATE = CONST + `
ROLE: gate lane. Per the CONST: census the wave state (#602, #600 — open or merged), post the [BREAKING] notice to announcements (what/blast radius/when/rollback), and record the sequencing decision (rename PRs land after the wave resolves). If the wave is still open, the rename PRs are PREPARED but not merged until the wave lands — record the resume condition.
Return (JSON): { breakingPosted: bool, postId: string|null, waveState: {wave602: string, machines600: string}, sequencing: string, resumeCondition: string|null, evidence: string }
`

const RENAME = CONST + `
ROLE: rename lane. Per the CONST: execute the rename mechanics in worktrees (dir/package/deps/consumers/CLI/data-roots/docs/manifests + BREAKING changelog), per-PR (one PR per logical slice, or grouped per the lane's judgment — never one mega-PR), each with its suite green + secrets scan + commit ('Agent: m2s-<your-role>'), push. If the wave is still in flight, open the PRs but record they must not merge until the wave resolves.
Return (JSON): { prs: [{number, slice, diffSummary, suiteCounts: {passed, failed}}], waveBlocked: bool, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review each PR ({PRS}): the rename is complete per slice (no stale machines references in the touched surface), deps/consumers updated, BREAKING changelog present, suites green, secrets clean, PR-first, sequencing respected (wave exclusion). Post '[REVIEW] <GO|NO_GO> — m2s <slice> @ <sha> — lens: breaking rename, reviewer m2s-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { prs: [{number, verdict, findings: [{severity, title, detail}]}] }
`

const SHIP = CONST + `
ROLE: ship. If GO (and the wave has resolved): merge the GO PRs (base-movement gate; squash with 'Agent: m2s-ship'), create the conformance verification loop for the renamed structure (per global-structural-change-verification: deterministic checks + agentic review + expiry intent), record the publish handoff (publish-all ships @hasna/stations; the breaking rename goes through the standing machinery), complete ${ROW} with evidence. If the wave is still open: do NOT merge; record the resume condition.
Return (JSON): { merged: [{prNumber, sha}], waveResolved: bool, conformanceLoop: {created: bool, name: string}, publishHandoff: string, rowState: string, residue: [string] }
`

const GATE_SCHEMA = { type: 'object', properties: { breakingPosted: { type: 'boolean' }, postId: { type: ['string', 'null'] }, waveState: { type: 'object' }, sequencing: { type: 'string' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['breakingPosted'] }
const REN_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } }, waveBlocked: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['prs'] }
const REVIEW_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'array' }, waveResolved: { type: 'boolean' }, conformanceLoop: { type: 'object' }, publishHandoff: { type: 'string' }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Gate')
const gate = await agent(GATE, { label: 'm2s-gate', phase: 'Gate', schema: GATE_SCHEMA })

phase('Rename')
let rename = null
if (gate && gate.breakingPosted) {
  rename = await agent(RENAME, { label: 'm2s-rename', phase: 'Rename', schema: REN_SCHEMA })
} else {
  rename = { prs: [], waveBlocked: true, evidence: 'breaking post not confirmed — gate failed' }
}

phase('Review')
let review = null
if (rename && rename.prs && rename.prs.length) {
  review = await agent(REVIEW.replace('{PRS}', JSON.stringify(rename.prs)), { label: 'm2s-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { prs: [] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'm2s-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { gate, rename, review, ship }
