export const meta = {
  name: 'contracts-alignment',
  description: 'Align fleet repos to the contracts standard (@hasna/contracts, apps/contracts): census hasna.contract.json conformance + daemon/queue semantics per the daemon-worker taxonomy, land per-repo PRs, review, merge',
  phases: [
    { title: 'Census', detail: 'classify every app/repo: contract manifest presence/validity, daemon semantics, conformance gaps' },
    { title: 'Fix', detail: 'per-repo alignment PRs (max 4 concurrent)' },
    { title: 'Review', detail: 'Fable review per PR' },
    { title: 'Merge', detail: 'merge GO\'d PRs' },
    { title: 'Report', detail: 'final conformance state + follow-ups' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const TASK = '1bfb26b7'

const CONST = `
You are a lane of the contracts-alignment workflow (owner-authorized 2026-08-18). The contracts standard lives in apps/contracts (@hasna/contracts) — the canonical manifest/schema authority (NOT apps/apps/contracts; the monorepo layout is apps/contracts). The owner wants every repo/app properly aligned to "the new way we align to contracts": a valid hasna.contract.json manifest and, for apps with daemons/queues, the daemon-worker lifecycle semantics from the fleet taxonomy (control/execution/observation planes; admission/lease/fencing; terminal receipts; no control-plane write as execution evidence). This workflow: census conformance across apps/, land per-repo PRs closing the gaps, review, merge. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull; never discard local work). Work in task worktrees ~/.hasna/repos/worktrees/apps/contracts-align-<n> from origin/main. Never push to main. Merges ONLY via gh pr merge <n> --squash --body-file <file whose LAST line is 'Agent: contracts-align'>.
- IDEMPOTENCY CHECK FIRST: skip any app already conformant at origin/main; skip any PR already merged.
- No secrets; no internal-infra strings. Staged secrets scan before every commit/push. Capture path: redirect to files, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the tracking task, posts to #board. English. Lineage identity 'conversations agents register' named contracts-align-<your-role>.
`

const CENSUS = CONST + `
ROLE: census lane (Sonnet). From origin/main:
1. Read apps/contracts source (the canonical schema: what hasna.contract.json must contain today — storage engines, envPrefix, serviceSurfaces, daemon/queue declarations if the schema has them; and the schema version in use).
2. For EVERY app under apps/ (exclude node_modules/dist): classify (a) CONFORMANT — hasna.contract.json validates against the current schema and daemon-bearing apps carry the daemon semantics; (b) GAP-MANIFEST — manifest missing, stale, or schema-invalid; (c) GAP-DAEMON — manifest fine but daemon/queue behavior lacks the lifecycle semantics (control/execution/observation, lease/fencing/receipt); (d) N/A — app with no daemon and a valid manifest.
3. TAXONOMY CHECK (mandatory — the owner's requirement: 'check and update and align everything perfectly'): classify each daemon/queue-bearing app against the daemon-worker taxonomy's exact vocabulary and semantics — the three planes (control: accepts commands/enqueue; execution: admitted item leased to a bounded worker; observation: reports queue state/lease health/receipts), the queue/attempt contract (stable identity, immutable payload, explicit admitted/leased/running/terminal states, bounded retries with distinguishable attempts preserving original identity, terminal receipts per attempt linked to entry+lease generation), leases (exclusive renewable, generation/fencing token, heartbeat, expiry, stale-worker rejection, renewal never erases generation history), acknowledgement (only after the durable effect exists and the receipt is committed — a control-plane write, process start, or rc=0 is never execution evidence), and the exact taxonomy VOCABULARY (admitted/leased/running/terminal, attempt, lease generation, fencing, receipt — not invented synonyms). List every vocabulary/semantic deviation with file:line evidence as class GAP-TAXONOMY.
4. Per app, list the exact conformance gaps with file:line evidence.
Return (JSON): { apps: [{app, class, gaps: [string], files: [string], taxonomyGaps: [string]}], totals: {conformant, gapManifest, gapDaemon, gapTaxonomy, na} }
`

const FIX = CONST + `
ROLE: alignment lane (Sonnet). Your batch: {BATCH} (each: {app, class, gaps}). For EACH app:
1. IDEMPOTENCY CHECK FIRST (see CONST).
2. Worktree ~/.hasna/repos/worktrees/apps/contracts-align-<app> from origin/main, branch fix/contracts-align-<app>.
3. Align per the class: (gap-manifest) create/repair hasna.contract.json against the CURRENT apps/contracts schema — read the schema first, validate with the contracts package's validator if one exists (check apps/contracts for a validate verb/API); (gap-daemon) add the daemon lifecycle semantics — control/execution/observation separation, lease/fencing/heartbeat on the queue, terminal receipts — following the EXACT shape the contracts app declares (the daemon-worker taxonomy: admission → lease → run → receipt; never a control-plane write as execution evidence).
4. TAXONOMY ALIGNMENT (mandatory): for gap-taxonomy apps, update the daemon/queue implementation to the taxonomy's exact vocabulary and semantics — the three planes, the attempt/queue contract, lease generation/fencing, receipt-before-acknowledgement — renaming invented synonyms to the taxonomy terms, and fixing semantics where a control-plane write or process start is treated as execution evidence. Regression tests FIRST for each corrected semantic.5. Regression tests FIRST for the daemon semantics. Run the app's suite (bounded 8 min) + the contracts validator if available. Secrets scan (rc 0). Commit ('Agent: contracts-align-<app>' trailer LAST), push, open the PR.
5. Verify merge-tree equality at CURRENT origin/main.
Return (JSON): { prs: [{number, app, class, validated: bool, tests: {passed, failed}, secretsClean: bool, mergeTreeEqual: bool}] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review {PRS} (each: number). Verify per PR: (a) the manifest validates against the CURRENT apps/contracts schema (run the validator; quote its output); (b) daemon semantics AND vocabulary match the daemon-worker taxonomy EXACTLY (the three planes; the attempt/queue contract with admitted/leased/running/terminal states; lease generation/fencing/heartbeat; receipt-before-acknowledgement; the exact taxonomy terms — no invented synonyms); (c) tests green, secrets clean, scope confined. Post '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: contracts alignment, reviewer contracts-align-review'. Block ONLY concrete P0/P1 defects. P2/P3 non-blocking.
Return (JSON): { prs: [{number, verdict: GO|NO_GO, findings: [{severity, title, detail}]}] }
`

const MERGE = CONST + `
ROLE: merge lane (Sonnet). {BATCH} (each: number). For EACH GO'd PR: head == reviewed sha; merge-tree equality at CURRENT origin/main (re-measure; if main moved, verify the delta is disjoint and proceed); gh pr merge <n> --squash --body-file <file ending 'Agent: contracts-align'>; record merged sha. NO_GO: comment findings, leave open.
Return (JSON): { prs: [{number, merged: bool, mergedSha: string|null, reason: string|null}] }
`

const REPORT = CONST + `
ROLE: report. Aggregate: per-app state (aligned/held), the final conformance count at origin/main, follow-ups (apps left unaligned with reasons). Comment on the tracking task, post to #board.
Return (JSON): { prs: [{number, state, mergedSha}], finalConformant: number, remaining: [string] }
`

const CENSUS_SCHEMA = { type: 'object', properties: { apps: { type: 'array', items: { type: 'object' } }, totals: { type: 'object' } }, required: ['apps'] }
const FIX_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REVIEW_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const MERGE_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REPORT_SCHEMA = { type: 'object', properties: { prs: { type: 'array' }, finalConformant: { type: 'integer' }, remaining: { type: 'array' } }, required: ['finalConformant'] }

phase('Census')
const census = await agent(CENSUS, { label: 'contracts-census', phase: 'Census', schema: CENSUS_SCHEMA, model: 'sonnet' })
const worklist = (census && census.apps || []).filter(a => a.class !== 'conformant' && a.class !== 'na')
log(`census: ${worklist.length} apps need alignment`)

phase('Fix')
const fixResults = await parallel(worklist.slice(0, 24).map((item, i) => () =>
  agent(FIX.replace('{BATCH}', JSON.stringify([{ app: item.app, class: item.class, gaps: item.gaps }])), { label: `ca-fix-${item.app}`, phase: 'Fix', schema: FIX_SCHEMA, model: 'sonnet' }),
))
const fixed = fixResults.filter(Boolean).flatMap(r => r.prs || [])
log(`fix: ${fixed.length} PRs`)

phase('Review')
const reviewBatches = []
for (let i = 0; i < fixed.length; i += 4) reviewBatches.push(fixed.slice(i, i + 4))
const reviewResults = await parallel(reviewBatches.map((rb, i) => () =>
  agent(REVIEW.replace('{PRS}', JSON.stringify(rb)), { label: `ca-review-${i + 1}`, phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' }),
))
log(`reviews: ${reviewResults.filter(Boolean).length} lanes`)

phase('Merge')
let mergeResults = []
if (reviewResults.length) {
  const verdictMap = {}
  for (const rv of reviewResults.filter(Boolean)) {
    for (const p of (rv.prs || [])) verdictMap[p.number] = p.verdict
  }
  mergeResults = await parallel(reviewBatches.map((rb, i) => () => {
    const go = rb.map(p => p.number).filter(n => verdictMap[n] === 'GO')
    return agent(MERGE.replace('{BATCH}', JSON.stringify(go)), { label: `ca-merge-${i + 1}`, phase: 'Merge', schema: MERGE_SCHEMA, model: 'sonnet' })
  }))
}

phase('Report')
const report = await agent(REPORT, { label: 'contracts-report', phase: 'Report', schema: REPORT_SCHEMA, model: 'sonnet' })

return { census, fixes: fixResults.filter(Boolean), reviews: reviewResults.filter(Boolean), merges: mergeResults.filter(Boolean), report }
