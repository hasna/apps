export const meta = {
  name: 'contracts-alignment-r3',
  description: 'Wave 3 of the contracts standard alignment: clear the 11-app residue from r2 (servers, shield, signatures, slides, tables, testers, instructions, knowledge, the missing-manifest cluster, attachments, workforce/markdown CI cases)',
  phases: [
    { title: 'Fix', detail: 'residue apps per exact named gates (3 lanes)' },
    { title: 'Review', detail: 'Fable review of the new PRs' },
    { title: 'Merge2', detail: 'merge the GO\'d PRs with base-movement gate' },
    { title: 'Report', detail: 'per-app state + residue' },
  ],
}

const TASK = '1bfb26b7-05eb-4cf5-9762-e554afd02de6'
const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'

const CONST = `
You are a lane of the contracts-alignment-r3 workflow (owner-authorized 2026-08-18, task ${TASK}). Wave 2 merged 30 manifest/taxonomy PRs; this wave clears the residue: the apps whose manifests still fail kit 0.11.1 conformance, with their exact named gates. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). Work in task worktrees ~/.hasna/repos/worktrees/apps/ca-r3-<n> from origin/main. Never push to main. PR-first; merges ONLY via gh pr merge <n> --squash --body-file <file whose LAST line is 'Agent: contracts-r3-<your-role>'>.
- IDEMPOTENCY FIRST: if the app already validates clean at HEAD (its manifest passes the 0.11.1 validator) or its PR is merged, record and SKIP. If an open PR already exists for the app, fix THAT PR (rebase + fix on its branch), never open a second.
- MANIFEST TRUTH: declare what the app actually does — storage.backend 'sqlite' | 'postgresql' from the real code, engines including postgresql where the server selects it, surfaces (api/sdk/mcp/cli) declared or truthfully deferred (sdk deferred only when no real ./sdk export and no served /openapi.json), hosting user-hosted, no mode/deploymentModes keys, kitVersion 0.11.1. Validate with the contracts CLI until zero errors.
- NO COMPAT: remove mode vocabulary and legacy secret-ref metadata entirely; never leave a transitional alias. Tests may name the words only to prove rejection.
- Verdicts: merge requires a [REVIEW] GO at the CURRENT head; base-movement gate (merge-tree == head or disjoint delta); bun.lock overlap -> regenerate with 'bun install --lockfile-only' in the worktree and re-verify.
- No secrets: never print/capture/commit credential values; consume ONLY via 'secrets exec <key> --as VAR -- <cmd>'. Staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings in artifacts. Capture path: redirect to files, never pipe large reads. Paste literal output lines.
- Record as you go: comments on ${TASK}, posts to #board. English. Lineage identity 'conversations agents register' named contracts-r3-<your-role>.
`

const FIX = CONST + `
ROLE: residue lane. Your apps: {APPS} (each with the r2 NO_GO gates). For EACH app:
- servers (PR 538): kit 0.11.1 alignment unmerged, P1 findings at head — fix per the findings, validate rc=0, tests.
- shield (PR 550): surface_matrix api + surface_bindings generatedFrom still fail — add/declare the surfaces truthfully (read the app's real serve/mcp surfaces), fix generatedFrom.
- signatures (PR 551): storage.engines must declare both sqlite AND postgresql — read the server's backend selection and declare truthfully.
- slides (PR 552): storage.backend Required + Unrecognized 'mode' key — migrate.
- tables (PR 553): storage.backend Required + Unrecognized 'mode','localDataDir','format' — migrate to the 0.11.1 schema.
- testers (PR 554): passes only at the pinned old validator — migrate the manifest to 0.11.1 and make it pass the CURRENT validator.
- instructions (PR 548): census.ts merge-tree conflict (recorded exception c15cca18) — rebase onto main, resolve the census conflict keeping main's gateway row + the PR's intended instructions row, re-verify.
- knowledge (PR 567): service-class manifest declares no service surface — the app has a real serve surface (api with /health /ready /version + /openapi.json per r2's knowledge lane); declare it truthfully.
- workforce (PR 556): GO but CI publish-guard + test-suites fail and merge-tree differs on bun.lock — regenerate the lockfile, re-verify gates, re-run the base-movement check.
- markdown (PR 534): missing-manifest GO but CI publish-guard + test-suites fail; merge result differs on own files — check whether the manifest caused the gate failures (artifactScan wiring for publish-guard) and fix.
- statusline/styles/tai/terminal/tickets (PR 523, missing-manifest cluster): create the manifests declaring the real surfaces, validate rc=0, tests.
- attachments (PR 508/561/565): manifest fails at pinned 0.8.2 — migrate the manifest to 0.11.1 (the purge PR 508's content + gates PR 561's fixes + modes-r3's unreviewed PR 565 all compose onto one 0.11.1 manifest); if the three PRs overlap, fix ONE coherent PR on the app's branch and reference the others.
For EACH: validate until rc=0, run the app's suite (bounded 10 min, record counts), secrets scan, commit ('Agent: contracts-r3-<app>' trailer LAST), push, update the existing PR (force-with-lease on its own branch) or open a new one.
Return (JSON): { apps: [{app, prNumber: number|null, valid: bool, gatesFixed: [string], remaining: [string], tests: {passed, failed}, evidence: string}] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review {PRS} (each: number). Per PR: (a) the manifest is truthful (spot-check storage backend and surfaces against the code), (b) zero mode/deploymentModes vocabulary in shipped surfaces, (c) no internal-infra strings, (d) tests pass, secrets clean. Post '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: contracts alignment r3, reviewer contracts-r3-review ({I} of {N})'. Block ONLY concrete P0/P1 defects. P2/P3 non-blocking.
Return (JSON): { prs: [{number, verdict: GO|NO_GO, findings: [{severity, title, detail}]}] }
`

const MERGE2 = CONST + `
ROLE: merge lane. {BATCH} (each: number). For EACH GO'd PR: head == reviewed sha; base-movement gate at CURRENT origin/main (re-measure; bun.lock overlap -> regenerate then re-verify); gh pr merge <n> --squash --body-file <file ending 'Agent: contracts-r3-ship'>; record merged sha. NO_GO: comment findings, leave open.
Return (JSON): { prs: [{number, merged: bool, mergedSha: string|null, reason: string|null}] }
`

const REPORT = CONST + `
ROLE: report. Aggregate per-app state (merged/reviewed/blocked with reason), residue. Comment ${TASK}, post to #board.
Return (JSON): { apps: [{app, state, prNumber, mergedSha}], residue: [string] }
`

const APP_SCHEMA = { type: 'object', properties: { apps: { type: 'array', items: { type: 'object' } } }, required: ['apps'] }
const PR_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REPORT_SCHEMA = { type: 'object', properties: { apps: { type: 'array' }, residue: { type: 'array' } }, required: ['apps'] }

phase('Fix')
const RESIDUE = [
  { app: 'servers', gate: 'PR 538 P1 findings at head' },
  { app: 'shield', gate: 'surface_matrix api + surface_bindings generatedFrom' },
  { app: 'signatures', gate: 'engines must declare sqlite AND postgresql' },
  { app: 'slides', gate: 'storage.backend Required + mode key' },
  { app: 'tables', gate: 'storage.backend Required + mode/localDataDir/format' },
  { app: 'testers', gate: 'passes only at pinned old validator' },
  { app: 'instructions', gate: 'census.ts merge-tree conflict (c15cca18)' },
  { app: 'knowledge', gate: 'no service surface declared' },
  { app: 'workforce', gate: 'CI publish-guard/test-suites + bun.lock delta' },
  { app: 'markdown', gate: 'CI publish-guard/test-suites after missing-manifest GO' },
  { app: 'statusline', gate: 'missing manifest (cluster)' },
  { app: 'styles', gate: 'missing manifest (cluster)' },
  { app: 'tai', gate: 'missing manifest (cluster)' },
  { app: 'terminal', gate: 'missing manifest (cluster)' },
  { app: 'tickets', gate: 'missing manifest (cluster)' },
  { app: 'attachments', gate: 'manifest at pinned 0.8.2; 3 PRs compose' },
]
const batches = []
for (let i = 0; i < RESIDUE.length; i += 6) batches.push(RESIDUE.slice(i, i + 6))
const fixResults = await parallel(batches.map((b, i) => () =>
  agent(FIX.replace('{APPS}', JSON.stringify(b)), { label: `contracts-r3-fix-${i + 1}`, phase: 'Fix', schema: APP_SCHEMA }),
))
const fixedApps = fixResults.filter(Boolean).flatMap(r => (r.apps || []).filter(a => a.prNumber))
const newPrs = fixedApps.map(a => ({ number: a.prNumber }))
log(`fix: ${fixedApps.length} apps, ${newPrs.length} PRs`)

phase('Review')
let reviewResults = []
const reviewBatches = []
for (let i = 0; i < newPrs.length; i += 4) reviewBatches.push(newPrs.slice(i, i + 4))
if (reviewBatches.length) {
  reviewResults = await parallel(reviewBatches.map((rb, i) => () =>
    agent(REVIEW.replace('{PRS}', JSON.stringify(rb)).replace('{I}', String(i + 1)).replace('{N}', String(reviewBatches.length)), {
      label: `contracts-r3-review-${i + 1}`, phase: 'Review', schema: PR_SCHEMA, model: 'fable',
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
    return agent(MERGE2.replace('{BATCH}', JSON.stringify(go)), { label: `contracts-r3-merge2-${i + 1}`, phase: 'Merge2', schema: PR_SCHEMA })
  }))
}

phase('Report')
const report = await agent(REPORT, { label: 'contracts-r3-report', phase: 'Report', schema: REPORT_SCHEMA })

return { fixes: fixResults.filter(Boolean), reviews: reviewResults.filter(Boolean), merges: merge2Results.filter(Boolean), report }
