export const meta = {
  name: 'local-only-capability-removal',
  description: 'Remove local-only capability gaps across hasna/apps: every capability must work on both backends (local SQLite/md AND hosted API+Postgres) unless a strong recorded reason exists — starting with attachments encryption',
  phases: [
    { title: 'Census', detail: 'sweep for local-only capability gates (encryption, sync, features gated on the local backend)' },
    { title: 'Fix', detail: 'port lanes, max 4 concurrent: capability works on both backends, or a recorded strong reason' },
    { title: 'Review', detail: 'Fable review per PR' },
    { title: 'Merge', detail: 'merge GO\'d PRs' },
    { title: 'Report', detail: 'final gaps + strong-reason exceptions' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const TASK = 'b1543bdb'

const CONST = `
You are a lane of the local-only-capability-removal workflow (owner-authorized 2026-08-18). As apps moved to the two-backend contract (local SQLite/md OR hosted API+Postgres), some capabilities were only implemented on the LOCAL backend — e.g. hasna attachments has an encryption process only available locally (apps/attachments/src/core/db.ts:16 storageBackend: 'local' | 's3' — the local backend carries the encryption, the s3/hosted path does not). Owner rule: NOTHING should be local-only or have a 'local only' mode, unless there is a very strong reason — and that reason must be recorded and reviewed, not assumed. This workflow: find every local-only capability gate, port the capability to both backends (the hosted/server path carries it too), or record the strong reason with evidence. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull; never discard local work). Work in task worktrees ~/.hasna/repos/worktrees/apps/localonly-<n> from origin/main. Never push to main. Merges ONLY via gh pr merge <n> --squash --body-file <file whose LAST line is 'Agent: localonly-<your-role>'>.
- IDEMPOTENCY CHECK FIRST: for each target, check whether the capability already works on both backends at origin/main — if yes, skip. Never duplicate merged work.
- No secrets: never print/capture/commit credential values; consume ONLY via 'secrets exec <key> --as VAR -- <cmd>'. No internal-infra strings. Staged secrets scan before every commit/push (rc 0 clean). NEVER print key material, encryption keys, or master keys — encryption work touches key material by design; the keys live in the vault and the code references them by name.
- Capture path: redirect to files, read both + $?; never pipe large reads. Paste literal output lines when reporting.
- Record as you go: comments on the tracking task, posts to #board. English. Lineage identity 'conversations agents register' named localonly-<your-role>.
- Distinguish measured vs inferred; state what you did not check. Plain register.
`

const CENSUS = CONST + `
ROLE: census lane (Sonnet). Build the local-only gap worklist from origin/main:
1. Sweep apps/ (exclude node_modules, dist, .changeset) for capability gates: storageBackend 'local'|'s3' style backend unions, 'if (backend === local' / 'isLocal' branches, capabilities described as local-only in docs ('only available locally', 'local-only'), encryption/decryption paths reachable only from the local store, sync/import/export verbs that refuse on the hosted path, MCP tools that error on the hosted store.
2. For EACH candidate: read the code and classify: (a) LOCAL-ONLY GAP — the capability exists on the local backend but is absent/broken on the hosted path (files:line evidence); (b) STRONG-REASON CANDIDATE — local-only by design with a plausible reason (e.g. the feature is inherently machine-local); (c) ALREADY TWO-BACKEND — no gap (drop).
3. The attachments encryption case is a KNOWN gap (storageBackend local|s3 at apps/attachments/src/core/db.ts:16 with encryption only on the local path) — verify its exact shape: where encryption keys resolve, where encrypt/decrypt is called, what the s3/hosted path does instead.
Return (JSON): { gaps: [{app, capability, class: 'gap'|'strong-reason-candidate', evidence: [string], files: [string]}], totals: {gaps, strongReasonCandidates} }
`

const FIX = CONST + `
ROLE: port lane (Sonnet). Your batch: {BATCH} (each: {app, capability, evidence}). For EACH:
1. IDEMPOTENCY CHECK FIRST (see CONST).
2. Worktree ~/.hasna/repos/worktrees/apps/localonly-<app> from origin/main, branch fix/localonly-<app>.
3. PORT the capability to both backends: the encryption/feature must work identically on the hosted/server path (server-side crypto where the local path used machine keys — keys resolve from the vault by name; client-side when the transport requires it). Remove the backend-union gating where it limited the capability. Regression tests FIRST: write the failing test (the capability on the hosted path), see it fail, then implement.
4. STRONG-REASON handling: if porting is genuinely impossible or wrong, DO NOT port — write the reason with evidence (what breaks, what the blast radius is, why it is machine-local by nature) into the task comment and the PR description; the reviewer rules on it. Do not fake a port.
5. Run the app's suite (bounded 8 min) — record passed/failed. Secrets scan the diff (rc 0) — key material is referenced by vault name, never in code. Commit (conventional, 'Agent: localonly-fix-<app>' trailer LAST), push, open the PR.
Return (JSON): { prs: [{number, app, capability, action: 'ported'|'strong-reason-recorded', tests: {passed, failed}, secretsClean: bool}] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review {PRS} (each: number). Verify per PR: (a) 'ported' — the capability genuinely works on the hosted path (test evidence), the backend union is gone or neutral, no local-only remnant; (b) 'strong-reason-recorded' — the reason is concrete and evidence-backed (a real constraint, not convenience); a convenience excuse is a NO_GO; (c) encryption: key material by vault reference only, no key in code, no key material in the diff; (d) tests green, secrets clean, scope confined. Post '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: local-only removal, reviewer localonly-review'. Block ONLY concrete P0/P1 defects (capability still local-only without a real reason, key material in code, broken hosted path). P2/P3 non-blocking.
Return (JSON): { prs: [{number, verdict: GO|NO_GO, findings: [{severity, title, detail}]}] }
`

const MERGE = CONST + `
ROLE: merge lane (Sonnet). {BATCH} (each: number). For EACH GO'd PR: head == reviewed sha; merge-tree equality at CURRENT origin/main (re-measure; if main moved, verify the delta is disjoint and proceed); gh pr merge <n> --squash --body-file <file ending 'Agent: localonly-ship'>; record merged sha. NO_GO: comment findings, leave open.
Return (JSON): { prs: [{number, merged: bool, mergedSha: string|null, reason: string|null}] }
`

const REPORT = CONST + `
ROLE: report. Aggregate: per-app state (ported / strong-reason-recorded / open), the final gap list (anything still local-only at origin/main), the accepted strong-reason exceptions with their evidence pointers. Comment on the tracking task, post to #board.
Return (JSON): { prs: [{number, state, mergedSha}], remainingGaps: [string], strongReasonExceptions: [string], followUps: [string] }
`

const CENSUS_SCHEMA = { type: 'object', properties: { gaps: { type: 'array', items: { type: 'object' } }, totals: { type: 'object' } }, required: ['gaps'] }
const FIX_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REVIEW_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const MERGE_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REPORT_SCHEMA = { type: 'object', properties: { prs: { type: 'array' }, remainingGaps: { type: 'array' }, strongReasonExceptions: { type: 'array' }, followUps: { type: 'array' } }, required: ['prs'] }

phase('Census')
const census = await agent(CENSUS, { label: 'localonly-census', phase: 'Census', schema: CENSUS_SCHEMA, model: 'sonnet' })
const gaps = (census && census.gaps) || []
log(`census: ${gaps.length} gaps`)

phase('Fix')
const fixResults = await parallel(gaps.slice(20).map((g, i) => () =>
  agent(FIX.replace('{BATCH}', JSON.stringify([{ app: g.app, capability: g.capability, evidence: g.evidence }])), { label: `localonly-fix-${g.app}`, phase: 'Fix', schema: FIX_SCHEMA, model: 'sonnet' }),
))
const fixed = fixResults.filter(Boolean).flatMap(r => r.prs || [])
log(`fix: ${fixed.length} PRs`)

phase('Review')
const reviewBatches = []
for (let i = 0; i < fixed.length; i += 4) reviewBatches.push(fixed.slice(i, i + 4))
const reviewResults = await parallel(reviewBatches.map((rb, i) => () =>
  agent(REVIEW.replace('{PRS}', JSON.stringify(rb)), { label: `localonly-review-${i + 1}`, phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' }),
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
    return agent(MERGE.replace('{BATCH}', JSON.stringify(go)), { label: `localonly-merge-${i + 1}`, phase: 'Merge', schema: MERGE_SCHEMA, model: 'sonnet' })
  }))
}

phase('Report')
const report = await agent(REPORT, { label: 'localonly-report', phase: 'Report', schema: REPORT_SCHEMA, model: 'sonnet' })

return { census, fixes: fixResults.filter(Boolean), reviews: reviewResults.filter(Boolean), merges: mergeResults.filter(Boolean), report }
