export const meta = {
  name: 'accounts-internal-move',
  description: 'Owner 2026-08-19 (row bdb1c431, "the big one"): move the accounts app from the open-source set to an INTERNAL app. Phase 1: FABLE investigates what the move means (monorepo placement, package scope, registry/publish eligibility, consumers) and writes the SKILL; phase 2: agents execute the move VIA THE SKILL; Fable review; ship; the skill stays for future internal moves',
  phases: [
    { title: 'Investigate', detail: 'Fable: what moving accounts to internal means — placement, scope, registry, consumers; build the move skill' },
    { title: 'Execute', detail: 'agents move accounts via the skill, PR-first' },
    { title: 'Review', detail: 'Fable adversarial review of the move + the skill' },
    { title: 'Ship', detail: 'merge, publish via standing machinery, report; skill usable by future moves' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = 'bdb1c431'

const CONST = `
You are a lane of the accounts-internal-move workflow (2026-08-19, owner-authorized). Owner: 'we need to have a workflow that moves [accounts] to being an internal app from the open source. We gotta pause this breaking change. But we need to have a workflow that moves it to being an internal app. And we also need a few agents like a workflow to investigate what does it mean to move to an internal app and build the skill around it. And then the agents can use the skill or skills as well — this is a big one.' Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/accmove-<n> from origin/main. PR-first; never push to main. Commits end with 'Agent: accmove-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check ${ROW} comments + open PRs; if the move already started, verify and record — do not duplicate.
- THE AUTHORITIES for the investigation: global-monorepo-placement (hasna-internal/platform for private control-plane apps; hasna-internal/internal-apps for mixed-scope producers; the internal-apps registry.json is the publishing authority — immutable reviewed tuples), global-monorepo-app-layout (one domain implementation, manifest-only registration, one-way deps), global-agent-release-and-project-prefix-policy, the npm scopes (@hasna vs @hasna-internal), and consumer impact (who imports @hasna/accounts).
- THE DELIVERABLES: (1) the Fable investigation: what the move means concretely — destination repo + placement, package scope decision, registry/publish eligibility, every consumer surface that must change, the breaking-announce sequencing; (2) THE SKILL (named per the skills convention, one SKILL.md, user_invocable for the agents) capturing the repeatable procedure 'move a hasna app from open-source to internal' — so future moves reuse it; (3) the EXECUTED move VIA THE SKILL, PR-first, announced [BREAKING] before landing; (4) the move ships through the standing machinery (publish-all for publishes).
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on ${ROW}, posts to #board + #announcements ([BREAKING]), mementos. English. Lineage 'conversations agents register' named accmove-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Fable). Per the CONST: read the placement/app-layout/registry authorities + the accounts app's current state (repo, package scope, consumers across the monorepo and the fleet). Decide: the destination (which internal repo + app group), the package scope outcome (@hasna/accounts staying public-scope vs @hasna-internal/accounts — with the registry tuple implications), the publish eligibility, and the ordered move steps with their verify commands. THEN write THE SKILL (one SKILL.md at the canonical skill home for this seat's runtime, name 'app-open-to-internal-move', user_invocable true) encoding the repeatable procedure. The skill is a deliverable of this phase, not a suggestion.
Return (JSON): { destination: string, packageScopeDecision: string, registryTuple: string, consumers: [string], moveSteps: [{step, action, verifyCommand}], breakingSequencing: string, skillPath: string, skillName: string, evidence: string }
`

const EXECUTE = CONST + `
ROLE: execute lane. Per the CONST + the investigation ({INVESTIGATION}): execute the move VIA THE SKILL the investigation authored (invoke it as the procedure), PR-first, [BREAKING] announced before landing, every consumer updated, suites green, secrets scan, commit ('Agent: accmove-<your-role>'), push. If a step hits a real gate (registry/ownership/scope), record the exact gate + resume condition and stop there.
Return (JSON): { prs: [{number, slice, diffSummary, suiteCounts: {passed, failed}}], gatesHit: [string], evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the move PRs ({PRS}) + the skill: the placement/scope decision matches the authorities, consumers complete, the skill is a faithful encoding of the executed procedure (or the procedure deviates from the skill — record which), [BREAKING] sequencing respected, suites green, secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — accmove <slice> @ <sha> — lens: internal-app move + skill fidelity, reviewer accmove-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { prs: [{number, verdict, findings: [{severity, title, detail}]}], skillVerdict: string }
`

const SHIP = CONST + `
ROLE: ship. If GO: merge the GO PRs (base-movement gate; squash with 'Agent: accmove-ship'), record the publish handoff (the moved package publishes through publish-all / the internal registry per the decision), verify the skill is installed at its home and usable (name the invocation), complete ${ROW} with evidence. If NO_GO or a gate: comment findings + resume condition, leave in_progress.
Return (JSON): { merged: [{prNumber, sha}], publishHandoff: string, skillInstalled: bool, rowState: string, residue: [string] }
`

const INV_SCHEMA = { type: 'object', properties: { destination: { type: 'string' }, packageScopeDecision: { type: 'string' }, registryTuple: { type: 'string' }, consumers: { type: 'array' }, moveSteps: { type: 'array' }, breakingSequencing: { type: 'string' }, skillPath: { type: 'string' }, skillName: { type: 'string' }, evidence: { type: 'string' } }, required: ['destination', 'moveSteps', 'skillName'] }
const EXE_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } }, gatesHit: { type: 'array' }, evidence: { type: 'string' } }, required: ['prs'] }
const REVIEW_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } }, skillVerdict: { type: 'string' } }, required: ['prs'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'array' }, publishHandoff: { type: 'string' }, skillInstalled: { type: 'boolean' }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'accmove-investigate', phase: 'Investigate', schema: INV_SCHEMA, model: 'fable' })
log(`investigate: ${investigate && investigate.skillName ? 'skill ' + investigate.skillName : 'NO SKILL'}`)

phase('Execute')
let execute = null
if (investigate && investigate.moveSteps) {
  execute = await agent(EXECUTE.replace('{INVESTIGATION}', JSON.stringify(investigate)), { label: 'accmove-execute', phase: 'Execute', schema: EXE_SCHEMA })
} else {
  execute = { prs: [], gatesHit: ['investigation did not complete'] }
}

phase('Review')
let review = null
if (execute && execute.prs && execute.prs.length) {
  review = await agent(REVIEW.replace('{PRS}', JSON.stringify(execute.prs)), { label: 'accmove-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { prs: [], skillVerdict: 'no PRs to review' }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'accmove-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { investigate, execute, review, ship }
