export const meta = {
  name: 'improve-monorepo',
  description: 'Owner 2026-08-19: ask FABLE and SOL (gpt-5.6-sol xhigh via codewith) what should be improved/fixed overall in the whole hasna/apps monorepo; Fable synthesis bounds + prioritizes the work set; agents do it; Fable adversarial review; ship via merge + publish-all',
  phases: [
    { title: 'Advisory', detail: 'two independent advisors: Fable agent (in-workflow) + Sol (codewith exec xhigh) analyze the whole monorepo' },
    { title: 'Synthesis', detail: 'Fable merges + dedupes against existing rows + prioritizes into a BOUNDED work set (cap 6 items)' },
    { title: 'Implement', detail: 'agents implement the work set, PR-first (one lane per item, max 6)' },
    { title: 'Review', detail: 'Fable adversarial review per PR' },
    { title: 'Ship', detail: 'merge GO PRs; publish-all owns publishes; report' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const TASK = 'cf390843-a2b3-460a-8fca-edf62c0d4434'

const CONST = `
You are a lane of the improve-monorepo workflow (2026-08-19, owner-authorized; task ${TASK}). Mission: ask FABLE and SOL what should be improved and fixed OVERALL in the whole hasna/apps monorepo (${MONOREPO}, ~82 app packages); agents then do the work and it ships with adversarial review. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in task worktrees ~/.hasna/repos/worktrees/apps/improve-<n> from origin/main. PR-first; never push to main. Commits end with 'Agent: improve-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY FIRST: before any mutation, check for an existing lane/row covering the item (search todos + open PRs); dedupe — never duplicate another lane's work.
- THE ADVISORS: (1) the Fable advisory agent reads the monorepo and proposes improvements/fixes with evidence; (2) the Sol advisory is a codewith exec run (gpt-5.6-sol, model_reasoning_effort=xhigh, read-only sandbox, healthy profile — enumerate usage first, never retry into a 429, pick another healthy profile) asked the SAME question. Both must produce CONCRETE, EVIDENCED items (file/package + what + why), not vibes.
- SYNTHESIS (Fable): merge the two advisor sets, dedupe against existing rows/lanes (search first), prioritize by owner-visible impact + fixability, and BOUND the work set to AT MOST 6 items per pass. Items that are already tracked or in-flight are recorded as 'already-tracked', not re-created. The work set becomes one todos row per item (oss-apps project, assigned marcellus, referencing ${TASK}).
- IMPLEMENT: one lane per item (max 6 concurrent): worktree, smallest owned change, TDD where testable, 'bun run check' where the surface has it, secrets scan, commit ('Agent: improve-<your-role>'), push, PR per item.
- REVIEW: Fable adversarial review per PR; at most two remediation cycles; GO at exact head + base-movement gate before merge.
- No secrets: never print/capture/commit credential values; staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings in artifacts. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on ${TASK} and each item row, posts to #board, mementos. English. Lineage 'conversations agents register' named improve-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const ADVISORY = CONST + `
ROLE: advisory lane (Fable, in-workflow). Per the CONST: read the monorepo (the apps/ tree, the CI gates, the repo laws, a sample of app surfaces) and propose the improvements/fixes the whole monorepo needs: architecture-level gaps, cross-cutting defects, tooling gaps, owner-visible polish. Every item: {package|area, what, why, evidence (file/line or measured fact), effort: small|medium|large, impact: high|medium|low}. Cap 15 items.
Return (JSON): { items: [{area, what, why, evidence, effort, impact}] }
`

const SOLADVISORY = CONST + `
ROLE: Sol advisory (codewith exec, gpt-5.6-sol xhigh, read-only sandbox, healthy profile). Ask the SAME question as the Fable advisory: what should be improved/fixed overall in ${MONOREPO} — read the tree, the gates, and app surfaces; return concrete evidenced items in the same shape. Retry once on another healthy profile on timeout; second failure: record 'sol-advisory-unavailable' and return the Fable advisory's items as the set.
Return (JSON): { items: [{area, what, why, evidence, effort, impact}], solRunState: 'ok'|'failed' }
`

const SYNTHESIS = CONST + `
ROLE: synthesis lane (Fable). Per the CONST: merge the two advisory sets ({ADVISORY} + {SOL}), dedupe against existing todos rows and open PRs (search 'todos list --project 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8' + 'gh pr list --repo hasna/apps' for each candidate), prioritize (impact/effort), and select AT MOST 6 items. CREATE one todos row per selected item (oss-apps, assigned marcellus, priority from impact, referencing ${TASK}). Record every non-selected item as 'already-tracked' or 'not-selected' with the reason.
Return (JSON): { selected: [{rowId, area, what, why}], rejected: [{area, reason}], bound: number }
`

const IMPLEMENT = CONST + `
ROLE: implement lanes ({ITEMS} — one lane per item). Per the CONST: implement each selected item's row, PR-first, smallest owned change, TDD where testable, checks, secrets scan, commit ('Agent: improve-<your-role>'), push, PR referencing the row + ${TASK}.
Return (JSON): { prs: [{rowId, prNumber, diffSummary, files: [string], tests: {passed, failed}}] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review each PR ({PRS}): the change matches the item's why, is the smallest owned change, tests green or recorded, secrets clean, PR-first, no scope creep. Post '[REVIEW] <GO|NO_GO> — improve <area> @ <sha> — lens: monorepo improvement, reviewer improve-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { prs: [{number, verdict, findings: [{severity, title, detail}]}] }
`

const SHIP = CONST + `
ROLE: ship. Merge every GO PR (base-movement gate; squash with 'Agent: improve-ship' trailer). Post the pass summary to #board: advisors consulted (Fable + Sol state), items selected, PRs merged, remaining set for the next pass. Comment ${TASK} and each item row.
Return (JSON): { merged: [{rowId, prNumber, sha}], advisors: {fable: bool, sol: string}, taskState: string, residue: [string] }
`

const ADV_SCHEMA = { type: 'object', properties: { items: { type: 'array', items: { type: 'object' } } }, required: ['items'] }
const SYNTH_SCHEMA = { type: 'object', properties: { selected: { type: 'array' }, rejected: { type: 'array' }, bound: { type: 'number' } }, required: ['selected'] }
const IMPL_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REVIEW_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'array' }, advisors: { type: 'object' }, taskState: { type: 'string' }, residue: { type: 'array' } }, required: ['taskState'] }

phase('Advisory')
const [fableAdv, solAdv] = await parallel([
  () => agent(ADVISORY, { label: 'improve-fable-advisory', phase: 'Advisory', schema: ADV_SCHEMA, model: 'fable' }),
  () => agent(SOLADVISORY, { label: 'improve-sol-advisory', phase: 'Advisory', schema: ADV_SCHEMA, model: 'sonnet' }),
])
log(`advisory: fable ${fableAdv && fableAdv.items ? fableAdv.items.length : 0} items, sol ${solAdv && solAdv.items ? solAdv.items.length : 0} items`)

phase('Synthesis')
const synthesis = await agent(
  SYNTHESIS.replace('{ADVISORY}', JSON.stringify((fableAdv && fableAdv.items) || [])).replace('{SOL}', JSON.stringify((solAdv && solAdv.items) || [])),
  { label: 'improve-synthesis', phase: 'Synthesis', schema: SYNTH_SCHEMA, model: 'fable' },
)
log(`synthesis: ${synthesis && synthesis.selected ? synthesis.selected.length : 0} selected`)

phase('Implement')
let implement = null
if (synthesis && synthesis.selected && synthesis.selected.length) {
  implement = await agent(IMPLEMENT.replace('{ITEMS}', JSON.stringify(synthesis.selected)), { label: 'improve-implement', phase: 'Implement', schema: IMPL_SCHEMA })
} else {
  implement = { prs: [] }
}

phase('Review')
let review = null
if (implement && implement.prs && implement.prs.length) {
  review = await agent(REVIEW.replace('{PRS}', JSON.stringify(implement.prs)), { label: 'improve-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { prs: [] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'improve-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { fableAdv, solAdv, synthesis, implement, review, ship }
