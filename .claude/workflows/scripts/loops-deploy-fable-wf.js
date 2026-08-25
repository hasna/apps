export const meta = {
  name: 'loops-deploy-fable',
  description: 'Owner 2026-08-19: ask FABLE how to elegantly deploy the loops harness across the fleet, then implement the verdict. Inputs: measured outage root cause (scheduler-only control plane, no runner deployed; machineId premise refuted; #588 merged). Phases: Fable advisory -> bounded synthesis (rows) -> implement (control plane + per-station runners) -> Fable review -> ship with a real loop firing live',
  phases: [
    { title: 'Advisory', detail: 'Fable agent: elegant deployment architecture for the loops harness (control plane, runners, update/rollback, live verify)' },
    { title: 'Synthesis', detail: 'Fable bounds the verdict to an implementable plan, dedupes against bb5f58ab + existing rows, creates rows' },
    { title: 'Implement', detail: 'agents deploy per the plan, PR-first for code changes, stations via the supported install path' },
    { title: 'Review', detail: 'Fable adversarial review of the deployed state + any PRs' },
    { title: 'Ship', detail: 'live test: a real loop fires on a deployed runner; report' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '84741f61-aef1-4c47-a4bb-acf3f867eb1e'
const OUTAGE = 'bb5f58ab-7596-4d83-8311-9fc7b29e98ee'

const CONST = `
You are a lane of the loops-deploy-fable workflow (2026-08-19, owner-authorized). Owner ask: 'we also need deployment on loops? we need to ask fable on how we can elegantly do this for our harness'. Mission: FABLE decides the elegant deployment approach for the loops harness across the fleet; agents then implement the verdict; it ships with a live test. Final text = machine-readable JSON.

CONTEXT (measured 2026-08-18/19, the fleet loops outage): the loops app is a scheduler-only control plane — NO runner is deployed fleet-wide; the machineId premise was refuted; 25 FROZEN + 19 DEAD-CADENCE + 15 UNPROVEN of 66 active loops (detectors 711800/711801). Fix PR hasna/apps#588 merged (machine-pinned loops loud). Redeploy + runner on station02 tracked on ${OUTAGE} (in_progress, driver themistius). The daemon taxonomy binds: package-owned daemon, control plane (accepts commands), execution plane (leased bounded workers), observation plane (queue state, lease health, terminal receipts); a successful control-plane write is not execution; MERGED != PUBLISHED != INSTALLED != RUNNING.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in task worktrees ~/.hasna/repos/worktrees/apps/loopsdep-<n> from origin/main. PR-first; never push to main. Commits end with 'Agent: loopsdep-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: read ${ROW} and ${OUTAGE} comments + open PRs touching apps/loops; if the deployment is already being built or the advisory already ran, verify and record — do not duplicate. NEVER fight the ${OUTAGE} lane; compose with it (it owns the outage triage; this owns the deployment design + rollout).
- THE ADVISORY IS FABLE (model fable): the owner asked Fable explicitly. It must produce a CONCRETE, EVIDENCED deployment design — not vibes: the control-plane deployment unit, the runner deployment unit (per station), the update path, the rollback path, and the LIVE VERIFICATION for each (a real loop firing on a deployed runner).
- No secrets: never print/capture/commit credential values; staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on ${ROW} and ${OUTAGE}, posts to #board, mementos. English. Lineage 'conversations agents register' named loopsdep-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const ADVISORY = CONST + `
ROLE: advisory lane (Fable). Per the CONST: read the loops app (apps/loops — the scheduler, the daemon model, the runner surfaces, the CLI install path), the fleet station layout (reachable machines), and the outage evidence. Then decide the ELEGANT deployment architecture: how the loops control plane is deployed and kept updated, how the runner is deployed per station (install path, service model, auth), how updates roll out without double-running, how rollback works, and what the LIVE VERIFICATION is for each layer (the exact command that proves a real loop fires on a deployed runner). Output: the design + the rollout plan (ordered steps, each with its verify command), bounded (cap 10 steps).
Return (JSON): { design: string, rollout: [{step, action, verifyCommand}], liveVerify: string, updatePath: string, rollbackPath: string, assumptions: [string] }
`

const SYNTHESIS = CONST + `
ROLE: synthesis lane (Fable). Per the CONST: bound the advisory ({ADVISORY}) into an implementable plan. Dedupe: search todos for existing deployment/runner rows beyond ${OUTAGE}; items already tracked are recorded 'already-tracked' with the pointer, not re-created. CREATE one todos row per implementable item (oss-apps project, priority high, referencing ${ROW}). Cap: 5 items.
Return (JSON): { selected: [{rowId, item, verifyCommand}], alreadyTracked: [{item, pointer}], bound: number }
`

const IMPLEMENT = CONST + `
ROLE: implement lanes ({ITEMS} — one lane per item). Per the CONST: implement each item per the Fable design (code changes PR-first with TDD where testable; station deployment through the supported install path — never hand-scatter files; record the exact deploy command + output). Compose with ${OUTAGE}: do not re-do outage triage.
Return (JSON): { items: [{rowId, done: bool, deployed: [string], prNumber: number|null, diffSummary: string, verifyOutput: string}] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the deployed state + any PRs ({ITEMS}): the deployment matches the Fable design, every layer has its live-verify command and it was RUN (not asserted), update/rollback paths exist, secrets clean, PR-first, no double-running risk, ${OUTAGE} lane untouched. Post '[REVIEW] <GO|NO_GO> — loops-deploy @ <sha> — lens: deployment design conformance, reviewer loopsdep-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO: run the LIVE TEST — the exact command from the design that proves a real loop fires on a deployed runner (record its literal output; the loop id, the run record, the fired timestamp). Then complete ${ROW} with the verdict + deployment evidence + live-test output, comment ${OUTAGE} with the deployment handoff, post the summary to #board. If NO_GO: comment findings + resume condition, leave ${ROW} in_progress.
Return (JSON): { liveTestPassed: bool, loopFired: {loopId, runRecord, at}, rowState: string, outageHandoff: string, residue: [string] }
`

const ADV_SCHEMA = { type: 'object', properties: { design: { type: 'string' }, rollout: { type: 'array', items: { type: 'object' } }, liveVerify: { type: 'string' }, updatePath: { type: 'string' }, rollbackPath: { type: 'string' }, assumptions: { type: 'array' } }, required: ['design', 'rollout', 'liveVerify'] }
const SYNTH_SCHEMA = { type: 'object', properties: { selected: { type: 'array' }, alreadyTracked: { type: 'array' }, bound: { type: 'number' } }, required: ['selected'] }
const IMPL_SCHEMA = { type: 'object', properties: { items: { type: 'array', items: { type: 'object' } } }, required: ['items'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { liveTestPassed: { type: 'boolean' }, loopFired: { type: 'object' }, rowState: { type: 'string' }, outageHandoff: { type: 'string' }, residue: { type: 'array' } }, required: ['liveTestPassed'] }

phase('Advisory')
const advisory = await agent(ADVISORY, { label: 'loopsdep-fable-advisory', phase: 'Advisory', schema: ADV_SCHEMA, model: 'fable' })
log(`advisory: ${advisory && advisory.rollout ? advisory.rollout.length : 0} rollout steps`)

phase('Synthesis')
const synthesis = await agent(
  SYNTHESIS.replace('{ADVISORY}', JSON.stringify(advisory)),
  { label: 'loopsdep-synthesis', phase: 'Synthesis', schema: SYNTH_SCHEMA, model: 'fable' },
)
log(`synthesis: ${synthesis && synthesis.selected ? synthesis.selected.length : 0} items`)

phase('Implement')
let implement = null
if (synthesis && synthesis.selected && synthesis.selected.length) {
  implement = await agent(IMPLEMENT.replace('{ITEMS}', JSON.stringify(synthesis.selected)), { label: 'loopsdep-implement', phase: 'Implement', schema: IMPL_SCHEMA })
} else {
  implement = { items: [] }
}

phase('Review')
let review = null
review = await agent(REVIEW.replace('{ITEMS}', JSON.stringify((implement && implement.items) || [])), { label: 'loopsdep-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })

phase('Ship')
const ship = await agent(SHIP, { label: 'loopsdep-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { advisory, synthesis, implement, review, ship }
