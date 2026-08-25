export const meta = {
  name: 'ask-fable-ship-latest',
  description: 'Owner-directed Fable debate (task cf390843): best standing design so the latest hasna/apps code SHIPS continuously as PRs merge — (A) dedicated continuous ship-latest workflow, (B) ship phase at the end of pr-drain passes, (C) hybrid; two opposing Fable agents + Fable adjudicator; verdict wired',
  phases: [
    { title: 'Debate', detail: 'two Fable agents argue opposing designs against the measured constraints' },
    { title: 'Adjudicate', detail: 'Fable adjudicator synthesizes a concrete verdict: chosen design + exact wiring + failure modes covered' },
    { title: 'Record', detail: 'verdict to #board + task cf390843' },
  ],
}

const TASK = 'cf390843-a2b3-460a-8fca-edf62c0d4434'

const CONTEXT = `
You are a Fable agent in an owner-directed design debate (owner: 'we need to have at all times a workflow that runs and ships latest since we keep merging prs, if possible, or at least on the pr drain at the end maybe i dont know which is best way ask fable'). Task ${TASK}. Decide the standing design so merged hasna/apps code SHIPS continuously. Your final text = machine-readable JSON.

MEASURED FACTS (2026-08-19):
- Merges land continuously via the pr-drain workflow: passes run back-to-back (~20-30 min each), keep-alive relaunches every 5 min, owner widened review to 12 lanes/pass. Today's passes merged #587, #588, #589.
- Version bumps do NOT follow merges automatically: #588 (the @hasna/loops execution-staleness fix) merged hours ago; the registry still serves @hasna/loops 0.5.1 (last publish 08-15) — the fix is unreleased.
- ~34 pending .changeset files have accumulated on main (incl. loops-96c837b0-execution-staleness, loops-run-now, loops-pagination, loops-preflight).
- publish-all is the ONLY publisher (owner-authorized): hourly census -> codewith release review -> npm publish -> live install+smoke. It publishes only what is AHEAD of the registry; a merge without a version bump never becomes ahead, so publish-all correctly ships nothing.
- A version wave (bunx changeset version -> version PR -> merge) is the missing step; a one-shot wave workflow is running now (wf_feccfbd8-cc6) but nothing makes it RECURRING.
- Rate/cost: every workflow firing is a turn against the session's rate windows; an idle ship pass must be a no-op census, not a token burn.
- Concurrency: the drain is capped at 16 concurrent agents; a parallel ship workflow must not collide with it (wave idempotency: one wave lane at a time; version PR conflicts if a wave is open while more merges land).

THE THREE CANDIDATES:
(A) DEDICATED CONTINUOUS SHIP WORKFLOW: a 'ship-latest' workflow on its own cadence (e.g. every 30-60 min): census new merges -> if changesets exist, apply version wave -> version PR -> Fable review -> merge -> hand to publish-all. Independent of drain health; drains never lengthen.
(B) DRAIN-INTEGRATED SHIP PHASE: pr-drain gains a final phase after Merge: if the pass merged anything (or changesets are pending), apply the version wave and open the version PR; the drain's next census reviews+merges it; publish-all ships. One workflow, shipping naturally follows merging; but every drain pass lengthens by the wave step, and shipping pauses if the drain is ever down.
(C) HYBRID: drain-integrated wave (B) + publish-all cadence tightened (e.g. 30 min) so the publish gap after a merge is bounded by one cadence.

HARD CONSTRAINTS (any design violating these is WRONG):
1. publish-all remains the ONLY publisher; the npm publish step never moves to another workflow.
2. One version-wave lane at a time (idempotency); a wave PR is mechanical (versions+changelogs only) and merges only through bounded review.
3. An idle pass is a cheap no-op census; no token burn when nothing shipped.
4. No new approval gates; the existing review-fix-merge chain governs.
5. The design must make the #588 failure impossible: a merged change ships within a bounded, named interval (state the interval).
6. LIVE FLEET INSTALL (owner 2026-08-19, explicit): 'shipped' means published to npm AND installed live on ALL AVAILABLE stations. Availability is measured per pass via tailnet (never assumed); each reachable station gets 'bun install -g @hasna/<pkg>@<v>' + a version check (--version / npm view cross-check). Unreachable stations are NAMED in the pass report with their resume condition — never silently skipped, never a blocker for the reachable set.
`

const SIDE_A = CONTEXT + `
ARGUE FOR (A) DEDICATED CONTINUOUS SHIP WORKFLOW (or a variant leaning A): an independent ship-latest workflow with its own cadence. Attack (B): a drain-integrated phase lengthens every drain pass, couples shipping to drain health, and the drain's own passes are already 20-30 min — adding the wave makes the critical path longer for everyone. A dedicated workflow can run its wave concurrently, has its own keep-alive, and its failure mode is independent (a broken drain does not stop shipping). Address the collision concern: how the dedicated workflow keeps wave idempotency against the drain.
Return (JSON): { position: 'A', argument: string, design: string, cadence: string, collisionHandling: string, failureModesCovered: [string] }
`

const SIDE_B = CONTEXT + `
ARGUE FOR (B) DRAIN-INTEGRATED SHIP PHASE (or a variant leaning B): shipping should follow merging in the SAME workflow — the drain merges, then immediately applies the version wave; its own next census reviews and merges the version PR; publish-all publishes. Attack (A): a second workflow is a second scheduler to keep alive (the keep-alive gap we just fixed), a second idempotency surface, and two workflows racing to ship the same main. The drain already runs near-continuously (5-min keep-alive, back-to-back passes) — integrating costs minutes per pass, not hours of lag. Address: pass-length growth and the publish gap (how publish-all's cadence keeps the interval bounded).
Return (JSON): { position: 'B', argument: string, design: string, cadence: string, collisionHandling: string, failureModesCovered: [string] }
`

const ADJUDICATE = CONTEXT + `
You are the Fable adjudicator. Below are two opposing Fable positions. Decide the design the fleet will wire. Your verdict must be CONCRETE and WIREABLE: pick A, B, or C; name the exact workflow/phase/cadence; name how the merged-change-to-shipped interval stays bounded; name the idempotency and collision rules; name what changes to existing machinery (pr-drain script, publish-all script, new cron, new script file). If you pick a hybrid, say exactly what lives where. Keep the final wiring to a bounded, named set of changes. Post the verdict to #board (message starting '[DECISION] ship-latest design:').
Return (JSON): { verdict: 'A'|'B'|'C', rationale: string, wiring: [string], shippedIntervalBound: string, idempotencyRules: [string], collisionRules: [string], fleetInstallStep: string, boardMessage: string }
`

const SIDE_SCHEMA = { type: 'object', properties: { position: { type: 'string' }, argument: { type: 'string' }, design: { type: 'string' }, cadence: { type: 'string' }, collisionHandling: { type: 'string' }, failureModesCovered: { type: 'array' } }, required: ['position', 'argument', 'design', 'collisionHandling'] }
const ADJ_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, rationale: { type: 'string' }, wiring: { type: 'array' }, shippedIntervalBound: { type: 'string' }, idempotencyRules: { type: 'array' }, collisionRules: { type: 'array' }, fleetInstallStep: { type: 'string' }, boardMessage: { type: 'string' } }, required: ['verdict', 'wiring', 'fleetInstallStep', 'boardMessage'] }

phase('Debate')
const [sideA, sideB] = await parallel([
  () => agent(SIDE_A, { label: 'fable-side-A-ship-latest', phase: 'Debate', schema: SIDE_SCHEMA, model: 'fable' }),
  () => agent(SIDE_B, { label: 'fable-side-B-ship-latest', phase: 'Debate', schema: SIDE_SCHEMA, model: 'fable' }),
])
log(`debate: A=${sideA && sideA.position} B=${sideB && sideB.position}`)

phase('Adjudicate')
const adj = await agent(ADJUDICATE, { label: 'fable-adjudicate-ship-latest', phase: 'Adjudicate', schema: ADJ_SCHEMA, model: 'fable' })
log(`adjudicate: verdict=${adj && adj.verdict}`)

phase('Record')
// The adjudicator posts the [DECISION] to #board itself; this phase records on the task.
await agent(
  `You are the record lane. The Fable adjudicator returned: verdict=${adj && adj.verdict}. Wiring: ${JSON.stringify((adj && adj.wiring) || [])}. Comment task ${TASK} with the verdict + wiring + shipped-interval bound. If the verdict is not one of A/B/C, note it. Return JSON.`,
  { label: 'fable-record-ship-latest', phase: 'Record', schema: { type: 'object', properties: { taskState: { type: 'string' } }, required: ['taskState'] } },
)

return { sideA, sideB, adjudication: adj }
