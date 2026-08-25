export const meta = {
  name: 'tests-coverage-sol',
  description: 'Owner 2026-08-19: ask Sol (codewith gpt-5.6-sol xhigh) what tests are missing across the hasna/apps monorepo and how to write them strong; per-repo analysis lanes, agents write the tests per Sol guidance, Fable review, ship. Runs repo-by-repo (bounded per pass)',
  phases: [
    { title: 'Coverage', detail: 'per-repo analysis lanes (waves of 4): measure test coverage, identify missing tests per app' },
    { title: 'SolAdvice', detail: 'one codewith gpt-5.6-sol xhigh run: receives per-repo findings + repo shape, dictates strong-test guidance per repo' },
    { title: 'Write', detail: 'agents implement the missing tests per Sol guidance, PR-first, fail-then-pass proven' },
    { title: 'Review', detail: 'Fable adversarial review per PR (tests are strong: they fail before the fix and assert real behavior)' },
    { title: 'Ship', detail: 'merge GO PRs, report per-repo coverage delta' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'

const CONST = `
You are a lane of the tests-coverage-sol workflow (2026-08-19, owner-authorized). Mission: find the MISSING tests across the hasna/apps monorepo and add them, repo by repo — each repo analyzed individually, Sol (gpt-5.6-sol at xhigh via codewith) dictating how the tests must be written to be STRONG, agents writing them. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in task worktrees ~/.hasna/repos/worktrees/apps/coverage-<n> from origin/main. PR-first; never push to main. Commits end with 'Agent: coverage-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check open PRs touching the app's test files; do not duplicate an existing test-writing lane.
- THE DELIVERABLE IS TESTS: per-repo lanes ADD missing tests (regression tests that would catch the app's real defect classes, per the repo's test runner — bun test where the package uses it). Every new test must be PROVEN strong: it FAILS against the current code when it targets a real gap (record the red run), or for coverage-gap-only additions it asserts real behavior with a positive AND negative case (two-sided). No tautological tests ('expect(true)'), no snapshot-only padding, no skipped tests.
- The Sol advisory is authoritative for HOW to write them: the SolAdvice phase output (per-repo guidance: what to cover, fixture shape, assertion style, edge cases) is included in each Write lane's brief verbatim.
- Repo scope per pass: cap 12 apps per pass (the 12 with the thinnest test surfaces first, measured), waves of 4 analysis lanes; record the bound and the unprocessed set.
- No secrets: never print/capture/commit credential values; staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the PRs, posts to #board, mementos. English. Lineage 'conversations agents register' named coverage-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const COVERAGE = CONST + `
ROLE: coverage analysis lanes ({APPS} — one app per lane). Per the CONST: measure the app's test surface — test files vs source modules (list both, count), test runner + how to run it, and NAME the missing-test gaps (source modules/behaviors with no test, existing tests that are weak: no assertions on the critical path, no negative cases). Do NOT write anything; return the analysis for Sol.
Return (JSON): { app, testFiles: [string], sourceModules: [string], gaps: [{module, missingWhat, currentCoverage}], runner: string }
`

const SOLADVICE = CONST + `
ROLE: Sol advisory (codewith exec, gpt-5.6-sol, model_reasoning_effort=xhigh, read-only sandbox, healthy profile per the capacity rule — enumerate with 'codewith usage --auth-profile' if unsure; never retry into a 429, pick another healthy profile). Brief: the per-app coverage analyses ({ANALYSES}) + the repo structure (list the app dirs). Write the STRONG-TEST GUIDANCE per app: which tests to write for which gap, the fixture shape, the assertion style (what the test must assert to actually catch the defect class), the edge cases to include. Output as a per-app guidance document. If the codewith run fails (timeout/model error), retry ONCE on another healthy profile; second failure = record 'sol-advisory-unavailable' and the Write lanes use the analysis's gap list with the fleet's TDD standard (fail-then-pass + two-sided).
Return (JSON): { guidance: [{app, instructions}], solRunState: 'ok'|'failed', evidence: string }
`

const WRITE = CONST + `
ROLE: write lanes ({APPS} — one app per lane). Per the CONST + the Sol guidance ({GUIDANCE} for your app): implement the missing tests exactly per the guidance, in a task worktree, run them (record the red run for each gap-targeting test BEFORE the test is complete — for pure coverage additions the two-sided case is the proof), suite green at the end, secrets scan, commit ('Agent: coverage-<your-role>'), push, PR referencing the app + this workflow.
Return (JSON): { app, prNumber, testsAdded: [string], redRunProven: bool, twoSidedProven: bool, suiteCounts: {passed, failed}, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review each PR ({PRS}): (a) every added test is STRONG — it targets a real gap named in the analysis, fails-then-passes (or two-sided for coverage additions), no tautologies, no skips, (b) tests follow the Sol guidance (or the deviation is justified), (c) the suite passes at head, (d) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — coverage <app> @ <sha> — lens: test strength, reviewer coverage-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { prs: [{number, verdict, findings: [{severity, title, detail}]}] }
`

const SHIP = CONST + `
ROLE: ship. Merge every GO PR (base-movement gate; squash with 'Agent: coverage-ship' trailer). Report the per-app coverage delta (tests added, red-run evidence). Post the summary to #board (apps covered, tests added, next-pass set).
Return (JSON): { merged: [{app, prNumber, sha}], coverageDelta: [{app, testsAdded}], unprocessed: [string], taskState: string, residue: [string] }
`

const COV_SCHEMA = { type: 'object', properties: { app: { type: 'string' }, testFiles: { type: 'array' }, sourceModules: { type: 'array' }, gaps: { type: 'array' }, runner: { type: 'string' } }, required: ['app', 'gaps'] }
const SOL_SCHEMA = { type: 'object', properties: { guidance: { type: 'array' }, solRunState: { type: 'string' }, evidence: { type: 'string' } }, required: ['guidance', 'solRunState'] }
const WRITE_SCHEMA = { type: 'object', properties: { app: { type: 'string' }, prNumber: { type: ['number', 'null'] }, testsAdded: { type: 'array' }, redRunProven: { type: 'boolean' }, twoSidedProven: { type: 'boolean' }, suiteCounts: { type: 'object' }, evidence: { type: 'string' } }, required: ['app', 'redRunProven'] }
const REVIEW_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'array' }, coverageDelta: { type: 'array' }, unprocessed: { type: 'array' }, taskState: { type: 'string' }, residue: { type: 'array' } }, required: ['taskState'] }

// Census of the thinnest test surfaces happens inside the first wave's dispatch; the workflow receives a bounded app list.
const APPS = ['actions', 'banking', 'billing', 'changelog', 'controls', 'dispatch', 'draw', 'evals', 'feedback', 'fleet', 'holdings', 'orgs']

phase('Coverage')
const covResults = []
for (let w = 0; w < APPS.length; w += 4) {
  const wave = APPS.slice(w, w + 4)
  const results = await parallel(wave.map(app => () =>
    agent(COVERAGE.replace('{APPS}', JSON.stringify([app])), { label: `coverage-${app}`, phase: 'Coverage', schema: COV_SCHEMA }),
  ))
  covResults.push(...results.filter(Boolean))
}
log(`coverage: ${covResults.length} apps analyzed`)

phase('SolAdvice')
const sol = await agent(SOLADVICE.replace('{ANALYSES}', JSON.stringify(covResults)), { label: 'sol-tests-advice', phase: 'SolAdvice', schema: SOL_SCHEMA, model: 'sonnet' })
log(`sol: ${sol && sol.solRunState}`)

phase('Write')
const writeResults = []
if (sol && sol.guidance && sol.guidance.length) {
  const writes = []
  for (const g of sol.guidance) {
    writes.push(() => agent(WRITE.replace('{APPS}', JSON.stringify([g.app])).replace('{GUIDANCE}', JSON.stringify([g])), { label: `write-tests-${g.app}`, phase: 'Write', schema: WRITE_SCHEMA }))
  }
  const waves = []
  for (let i = 0; i < writes.length; i += 4) waves.push(writes.slice(i, i + 4))
  for (const wv of waves) {
    const rs = await parallel(wv)
    writeResults.push(...rs.filter(Boolean))
  }
}

phase('Review')
let review = null
const prs = writeResults.filter(r => r && r.prNumber).map(r => ({ number: r.prNumber, app: r.app }))
if (prs.length) {
  review = await agent(REVIEW.replace('{PRS}', JSON.stringify(prs)), { label: 'coverage-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { prs: [] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'coverage-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { coverage: covResults, sol, writes: writeResults, review, ship }
