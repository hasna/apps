export const meta = {
  name: 'contracts-alignment-r2',
  description: 'Wave 2 of the contracts standard alignment: merge the 9 open wave-1 PRs, migrate 26 manifests to kit 0.11.1, create 14 missing manifests, fix named gate failures in 20 apps, align daemon/queue taxonomy vocabulary in automations/computers/dispatch',
  phases: [
    { title: 'MergeOpen', detail: 'verify + merge the 9 open PRs (455/457/458/459/465/468/469/486/507)' },
    { title: 'Fix', detail: 'manifest migration (3 lanes), missing manifests (2 lanes), named gates (3 lanes), taxonomy (3 lanes)' },
    { title: 'Review', detail: 'Fable review of the new PRs' },
    { title: 'Merge2', detail: 'merge the GO\'d PRs' },
    { title: 'Report', detail: 'per-app state + residue' },
  ],
}

const APPS = '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'
const TASK = '1bfb26b7-05eb-4cf5-9762-e554afd02de6'
const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const OPEN_PRS = [455, 457, 458, 459, 465, 468, 469, 486, 507]
const MANIFEST_INVALID = ['emails', 'feedback', 'files', 'fleet', 'gateway', 'holdings', 'instructions', 'knowledge', 'logs', 'mcps', 'mementos', 'models', 'monitor', 'prompts', 'recordings', 'secrets', 'servers', 'sessions', 'sheets', 'shield', 'signatures', 'slides', 'tables', 'testers', 'todos', 'workforce']
const NO_MANIFEST = ['connectors', 'evals', 'markdown', 'repos', 'skills', 'snapshots', 'statusline', 'styles', 'tai', 'terminal', 'tickets']
const GATE_APPS = ['attachments', 'changelog', 'context', 'docs', 'draw', 'economy', 'events', 'hooks', 'loops', 'orgs', 'pixels', 'projects', 'releases', 'router', 'search', 'tenants', 'ui']
const TAXONOMY_APPS = ['automations', 'computers', 'dispatch']

const CONST = `
You are a lane of the contracts-alignment-r2 workflow (owner-authorized 2026-08-18, task ${TASK}). Wave 1 (wf_685692fe-a4c) merged 15 PRs and left 21 apps conformant; this wave drives the remaining apps to conformance: migrate manifests to kit 0.11.1 (schema @hasna/contracts), create missing manifests, fix named gates, and align daemon/queue status vocabulary to the taxonomy (admitted/leased/running/terminal; lease generation/fencing; terminal receipts). Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first: git -C ${MONOREPO} pull (fast-forward; never discard local work). Work in task worktrees ~/.hasna/repos/worktrees/apps/ca-r2-<n> from origin/main. Never push to main. PR-first; merges ONLY via gh pr merge <n> --squash --body-file <file whose LAST line is 'Agent: contracts-r2-<your-role>'>.
- MANIFEST TRUTH: never invent storage/surface declarations. Read the app's actual code (server DATABASE_URL handling, client API transport, shipped bins) and declare what the app really does. storage.backend is Required: 'sqlite' | 'postgresql' (never 'postgres'). No 'mode' keys, no deploymentModes, no self_hosted/remote/hybrid vocabulary anywhere in shipped surfaces. kitVersion -> 0.11.1. Validate with the contracts CLI (the app's own validate/check verb or the contracts kit) until zero errors.
- IDEMPOTENCY CHECK FIRST: if the app already validates clean at HEAD or its PR is merged, record and SKIP. If an open PR already exists for the app, do NOT open a second — review/merge the existing one instead.
- GATE DISCIPLINE: public manifests must not carry internal-infra strings (ARNs, *.hasna.xyz, account ids, secret values) — secret refs become generic names. Never print/capture/commit credential values; consume ONLY via 'secrets exec <key> --as VAR -- <cmd>'. Staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- Capture path: redirect to files, never pipe large reads. Paste literal output lines. Record as you go: comments on ${TASK}, posts to #board. English. Lineage identity 'conversations agents register' named contracts-r2-<your-role>.
- TDD for code changes (taxonomy lanes): failing tests first for the renamed vocabulary, see them fail, then implement. Distinguish measured vs inferred; state what you did not check.
`

const MERGE_OPEN = CONST + `
ROLE: merge-open lane. Wave-1 residue PRs: {PRS} (numbers). For EACH: gh pr view <n> --json state,headRefOid,mergeable (projected). Merged -> record sha, skip. Closed -> record. Verdict check: search 'conversations search "hasna/apps#<n>" --channel git-prs -j' and the PR's comments for a [REVIEW] GO at the CURRENT head sha; NO GO at head -> comment and leave open (do NOT merge). If GO: base-movement gate (git -C ${MONOREPO} merge-tree --write-tree origin/main <head> == head, or delta disjoint from the PR's own files), then gh pr merge <n> --squash --body-file <file ending 'Agent: contracts-r2-ship'>. If the PR conflicts: comment with the conflict and leave open (rebase happens in a later wave).
Return (JSON): { prs: [{number, merged: bool, mergedSha: string|null, reason: string|null}] }
`

const FIX_MANIFEST = CONST + `
ROLE: manifest migration lane. Your apps: {APPS}. For EACH app: read apps/<app>/hasna.contract.json and run the app's contracts validation (the contracts CLI validate or the app's check verb — redirect to a file, read the exact errors). Fix the manifest per the schema: storage.backend Required and truthful ('sqlite' | 'postgresql' — read the server's actual backend selection), engines 'postgresql' (not 'postgres'), remove mode/deploymentModes/self_hosted keys entirely, kitVersion -> 0.11.1, bins declared to match package.json bins, surface declarations matching the app's real surfaces. Re-validate until zero errors, then run the app's tests (bounded 10 min, record counts), secrets scan, commit ('Agent: contracts-r2-manifest' trailer LAST), push, open the PR naming the fixes.
Return (JSON): { apps: [{app, prNumber: number|null, valid: bool, tests: {passed, failed}, evidence: string}] }
`

const FIX_NO_MANIFEST = CONST + `
ROLE: missing-manifest lane. Your apps: {APPS}. For EACH app: read the app's package.json (bins, name, deps) and its actual surfaces (src/index.ts, cli bins, mcp, serve, sdk) and CREATE apps/<app>/hasna.contract.json declaring the truth: schemaVersion, kitVersion 0.11.1, package name, surfaces the app really ships (declare or waive), storage backend from the actual code, metadata per the kit's required fields (release.artifactScan.script where the gate demands it). Validate with the contracts CLI until zero errors; if a required field cannot be truthfully filled, record the exact gap on the task and leave the app for a follow-up (do not invent). Tests bounded 8 min, secrets scan, commit ('Agent: contracts-r2-manifest' trailer LAST), push, open the PR.
Return (JSON): { apps: [{app, prNumber: number|null, valid: bool, gap: string|null, evidence: string}] }
`

const FIX_GATES = CONST + `
ROLE: named-gate lane. Your apps: {APPS} (each with the census's named gates). For EACH app: re-run the app's contracts validation and fix EXACTLY the named gates: bins_match_package (declare undeclared bins), surface_matrix (add or waive surface declarations), service_api_topology, storage_capabilities (pgTestGate where live postgres is proven), public_manifest_safety (replace internal-infra secret refs with generic names), published_artifact_gate (metadata.release.artifactScan.script — point at a real existing scan script or add the narrow one), credential_seam_compliance (replace vendored copies of the contracts client seam with imports from @hasna/contracts/client — NEVER rewrite the seam's logic, only the source), no_cloud_guard (fix the test ref). Validate until zero errors, tests (bounded 10 min), secrets scan, commit ('Agent: contracts-r2-gates' trailer LAST), push, open the PR. Where a gate cannot be truthfully fixed (e.g. the app genuinely has no artifact scan), record the exact reason and leave the app for a follow-up.
Return (JSON): { apps: [{app, prNumber: number|null, gatesFixed: [string], remainingGates: [string], tests: {passed, failed}, evidence: string}] }
`

const FIX_TAXONOMY = CONST + `
ROLE: taxonomy lane. Your apps: {APPS} (each with census taxonomyGaps: status vocabulary deviates from admitted/leased/running/terminal; lease/fence/attempt/receipt semantics exist but under non-taxonomy names). For EACH app: TDD-first — write failing tests asserting the taxonomy vocabulary on the public surfaces (status enums, lease generation, fencing token, attempt identity, terminal receipts), see them fail, then rename/align the vocabulary IN CODE (no compat aliases — full refactoring; the semantics already exist, only the names change), including daemon observation surfaces (queue depth, lease health per entry). Run the app's full suite (bounded 12 min), secrets scan, commit ('Agent: contracts-r2-taxonomy' trailer LAST), push, open the PR. If the app's status vocabulary is a persisted DB enum, add the migration (never delete data).
Return (JSON): { apps: [{app, prNumber: number|null, renamedStates: [string], tests: {passed, failed}, evidence: string}] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review {PRS} (each: number). Per PR: (a) the manifest is truthful (declarations match the app's real code — spot-check storage backend and surfaces), (b) zero mode/deploymentModes/self_hosted vocabulary in shipped surfaces, (c) no internal-infra strings, (d) tests pass, secrets clean, (e) taxonomy lanes renamed without compat aliases and migrated persisted enums safely. Post '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: contracts alignment r2, reviewer contracts-r2-review ({I} of {N})'. Block ONLY concrete P0/P1 defects (false manifest declarations, mode vocabulary surviving, internal-infra leaks, broken builds, data-loss migrations). P2/P3 non-blocking.
Return (JSON): { prs: [{number, verdict: GO|NO_GO, findings: [{severity, title, detail}]}] }
`

const MERGE2 = CONST + `
ROLE: merge lane. {BATCH} (each: number). For EACH GO'd PR: head == reviewed sha; merge-tree equality at CURRENT origin/main (re-measure; if main moved, verify the delta is disjoint and proceed); gh pr merge <n> --squash --body-file <file ending 'Agent: contracts-r2-ship'>; record merged sha. NO_GO: comment findings, leave open.
Return (JSON): { prs: [{number, merged: bool, mergedSha: string|null, reason: string|null}] }
`

const REPORT = CONST + `
ROLE: report. Aggregate: merged open PRs, per-class fix outcomes, residue (apps still non-conformant with exact gates). Comment ${TASK}, post to #board.
Return (JSON): { mergedOpen: [{number, mergedSha}], fixes: [{app, state, prNumber}], residue: [string] }
`

const PR_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const APP_SCHEMA = { type: 'object', properties: { apps: { type: 'array', items: { type: 'object' } } }, required: ['apps'] }
const REPORT_SCHEMA = { type: 'object', properties: { mergedOpen: { type: 'array' }, fixes: { type: 'array' }, residue: { type: 'array' } }, required: ['mergedOpen', 'fixes'] }

function chunks(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

phase('MergeOpen')
const mergeOpen = await agent(MERGE_OPEN.replace('{PRS}', JSON.stringify(OPEN_PRS)), { label: 'contracts-r2-mergeopen', phase: 'MergeOpen', schema: PR_SCHEMA })
log(`merge-open: ${mergeOpen && mergeOpen.prs ? mergeOpen.prs.filter(p => p.merged).length : 0} merged`)

phase('Fix')
const fixResults = []
const lanes = [
  ...chunks(MANIFEST_INVALID, 9).map((b, i) => ({ prompt: FIX_MANIFEST.replace('{APPS}', JSON.stringify(b)), label: `contracts-r2-manifest-${i + 1}`, schema: APP_SCHEMA })),
  ...chunks(NO_MANIFEST, 6).map((b, i) => ({ prompt: FIX_NO_MANIFEST.replace('{APPS}', JSON.stringify(b)), label: `contracts-r2-nomanifest-${i + 1}`, schema: APP_SCHEMA })),
  ...chunks(GATE_APPS, 6).map((b, i) => ({ prompt: FIX_GATES.replace('{APPS}', JSON.stringify(b)), label: `contracts-r2-gates-${i + 1}`, schema: APP_SCHEMA })),
  ...chunks(TAXONOMY_APPS, 1).map((b, i) => ({ prompt: FIX_TAXONOMY.replace('{APPS}', JSON.stringify(b)), label: `contracts-r2-taxonomy-${i + 1}`, schema: APP_SCHEMA })),
]
const fixResultsAll = await parallel(lanes.map(l => () => agent(l.prompt, { label: l.label, phase: 'Fix', schema: l.schema })))
const fixedApps = fixResultsAll.filter(Boolean).flatMap(r => (r.apps || []).filter(a => a.prNumber))
const newPrs = fixedApps.map(a => ({ number: a.prNumber }))
log(`fix: ${fixResultsAll.filter(Boolean).length} lanes, ${newPrs.length} new PRs`)

phase('Review')
let reviewResults = []
const reviewBatches = []
for (let i = 0; i < newPrs.length; i += 4) reviewBatches.push(newPrs.slice(i, i + 4))
if (reviewBatches.length) {
  reviewResults = await parallel(reviewBatches.map((rb, i) => () =>
    agent(REVIEW.replace('{PRS}', JSON.stringify(rb)).replace('{I}', String(i + 1)).replace('{N}', String(reviewBatches.length)), {
      label: `contracts-r2-review-${i + 1}`, phase: 'Review', schema: PR_SCHEMA, model: 'fable',
    }),
  ))
}

phase('Merge2')
let merge2Results = []
if (reviewResults.length) {
  const verdictMap = {}
  for (const rv of reviewResults.filter(Boolean)) {
    for (const p of (rv.prs || [])) verdictMap[p.number] = p.verdict
  }
  merge2Results = await parallel(reviewBatches.map((rb, i) => () => {
    const go = rb.map(p => p.number).filter(n => verdictMap[n] === 'GO')
    return agent(MERGE2.replace('{BATCH}', JSON.stringify(go)), { label: `contracts-r2-merge2-${i + 1}`, phase: 'Merge2', schema: PR_SCHEMA })
  }))
}

phase('Report')
const report = await agent(REPORT, { label: 'contracts-r2-report', phase: 'Report', schema: REPORT_SCHEMA })

return { mergeOpen, fixes: fixResultsAll.filter(Boolean), reviews: reviewResults.filter(Boolean), merges: merge2Results.filter(Boolean), report }
