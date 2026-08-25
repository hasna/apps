export const meta = {
  name: 'modes-full-removal',
  description: 'Full removal of the local/self-hosted/cloud deployment-mode concept across hasna/apps — no backwards compat, full refactoring (owner directive 2026-07-29, now enforced completely)',
  phases: [
    { title: 'Census', detail: 'classify the 447-file mode residue: generated storage-kit mode.ts, hand-rolled enums, contract manifests, STORAGE_MODE aliases' },
    { title: 'Fix', detail: 'per-app removal lanes, max 4 concurrent: two-backend selection only, no aliases, no mode vocabulary' },
    { title: 'Review', detail: 'Fable review per PR (mode-free enforcement, no compat shims)' },
    { title: 'Merge', detail: 'merge GO\'d PRs with attribution' },
    { title: 'Report', detail: 'final residue count + follow-ups' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const TASK = 'a48e420b'

const CONST = `
You are a lane of the modes-full-removal workflow (owner-authorized 2026-08-18). The owner removed the local/self-hosted/cloud deployment-mode concept on 2026-07-29 ("There are NO deployment modes... no mode enums, no mode branching in code, no deploymentMode(s) in contract manifests"). Residue remains across the monorepo (measured: 447 files matching mode-enum patterns). This workflow REMOVES the concept COMPLETELY — no backwards compatibility, no deprecated aliases, full refactoring. The ONLY remaining selection mechanism is the two-backend contract: client = local SQLite/md OR hosted HTTP API (HASNA_<NAME>_API_URL + key, fail-closed); server = HASNA_<NAME>_DATABASE_URL → PostgreSQL else SQLite. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull; never discard local work). Work in task worktrees ~/.hasna/repos/worktrees/apps/modes-<n> from origin/main. Never push to main. Merges ONLY via gh pr merge <n> --squash --body-file <file whose LAST line is 'Agent: modes-<your-role>'>.
- IDEMPOTENCY CHECK FIRST: for each target, check whether the mode vocabulary is already gone at origin/main (grep the file) — if clean, skip. Never duplicate merged work.
- NO BACKWARDS COMPAT: no deprecated aliases, no legacy mapping of self_hosted/remote/hybrid to cloud, no isCloudMode compatibility branches. The mode vocabulary must be REMOVED, not mapped.
- No secrets: never print/capture/commit credential values; consume ONLY via 'secrets exec <key> --as VAR -- <cmd>'. No internal-infra strings. Staged secrets scan before every commit/push (rc 0 clean).
- Capture path: redirect to files, read both + $?; never pipe large reads. Paste literal output lines when reporting.
- Record as you go: comments on the tracking task (modes removal), posts to #board. English. Lineage identity 'conversations agents register' named modes-<your-role>.
- Distinguish measured vs inferred; state what you did not check. Plain register.
`

const CENSUS = CONST + `
ROLE: census lane (Sonnet). Build the classified worklist from origin/main:
1. Enumerate every file matching: deploymentMode|deployment_modes|isCloudMode|self_hosted|selfHosted|'remote'|'hybrid'|STORAGE_MODE (as a mode selector, not the storage-kit env var name itself) across apps/ (exclude node_modules, dist, .changeset, CHANGELOG).
2. Classify each into: (a) GENERATED storage-kit mode.ts (the generated home — note the app); (b) HAND-ROLLED mode enum/branch in source (file:line); (c) CONTRACT manifest carrying deploymentMode (hasna.contract.json / serviceSurfaces — the transitional contracts schema still requires the field; classify which manifests carry it); (d) STORAGE_MODE transitional alias handling in client transport (self_hosted/remote/hybrid mapped to cloud); (e) DOCUMENTATION (README/docs carrying the mode vocabulary).
3. Per app, produce the worklist: [{app, class, files: [path:line], action: remove|refactor|regenerate|document}] with a COUNT per class.
Return (JSON): { apps: [{app, classes: {generated: [string], handrolled: [string], manifests: [string], aliases: [string], docs: [string]}}], totals: {generated, handrolled, manifests, aliases, docs} }
`

const FIX = CONST + `
ROLE: removal lane (Sonnet). Your batch: {BATCH} (each: {app, class, files}). For EACH item:
1. IDEMPOTENCY CHECK FIRST (see CONST).
2. Worktree ~/.hasna/repos/worktrees/apps/modes-<app> from origin/main, branch fix/modes-<app>.
3. REMOVE the mode concept per the class:
   - handrolled: delete the mode enum/union, the branching (if (mode === ...) / isCloudMode), and any mode vocabulary; the code selects backend by the env contract (DATABASE_URL present → postgres, else sqlite; API_URL + key present → hosted client, else local) with fail-closed misconfiguration checks. NO aliases, NO legacy mapping.
   - generated storage-kit mode.ts: remove the mode module from the generated kit (and the generator source if it lives in the repo's tooling) — the kit selects by env.
   - manifests: remove deploymentMode from hasna.contract.json manifests (if the installed contracts schema still REQUIRES the field on serviceSurfaces, keep the manifest valid by removing the field and documenting the transitional requirement on the task — do NOT hand-strip valid fields silently; record the exact schema gate).
   - aliases: delete the self_hosted/remote/hybrid alias mapping lines.
   - docs: rewrite the README/docs sections carrying the mode vocabulary.
4. Tests: update the affected tests (mode-enum tests are removed or rewritten to the env-selection contract); run the app's suite (bounded 8 min) — record passed/failed. Regression tests first where behavior changes.
5. Pre-checks: secrets scan the diff (redirect + 'secrets scan input' rc 0), grep the app dir for the mode vocabulary — zero occurrences (positive control: the grep finds it in a known-carrying file). Commit (conventional, 'Agent: modes-fix-<app>' trailer LAST), push, open the PR.
Return (JSON): { prs: [{number, app, classes: [string], modeVocabRemaining: number, tests: {passed, failed}, secretsClean: bool}] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review {PRS} (each: number). Verify per PR: (a) the mode vocabulary is GONE from the app (grep the app dir — zero occurrences of deploymentMode|isCloudMode|self_hosted|selfHosted as mode semantics; 'remote'/'hybrid' only as ordinary English where unavoidable); (b) NO compat shims/aliases left (this is the hard requirement — no backwards compatibility); (c) the env-selection contract is correct (DATABASE_URL/API_URL presence, fail-closed); (d) tests green, secrets clean, scope confined to the app. Post '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: mode-concept removal, reviewer modes-review'. Block ONLY concrete P0/P1 defects (mode vocabulary remaining, compat shims, broken selection contract). P2/P3 non-blocking.
Return (JSON): { prs: [{number, verdict: GO|NO_GO, findings: [{severity, title, detail}]}] }
`

const MERGE = CONST + `
ROLE: merge lane (Sonnet). {BATCH} (each: number). For EACH GO'd PR: head == reviewed sha (gh pr view --json headRefOid); merge-tree equality at CURRENT origin/main (TREE=$(git -C ${MONOREPO} merge-tree --write-tree origin/main <head>); git diff --quiet <head> "$TREE"; if main moved, verify the delta is disjoint from the app and proceed); gh pr merge <n> --squash --body-file <file ending 'Agent: modes-ship'>; record merged sha. NO_GO: comment findings, leave open.
Return (JSON): { prs: [{number, merged: bool, mergedSha: string|null, reason: string|null}] }
`

const REPORT = CONST + `
ROLE: report. Aggregate: per-app state, the FINAL residue count (fresh grep of origin/main for the mode vocabulary — the acceptance number), follow-ups (any manifest/schema transitional items). Comment on the tracking task, post to #board.
Return (JSON): { prs: [{number, state, mergedSha}], finalResidueCount: number, followUps: [string] }
`

const CENSUS_SCHEMA = { type: 'object', properties: { apps: { type: 'array', items: { type: 'object' } }, totals: { type: 'object' } }, required: ['apps'] }
const FIX_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REVIEW_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const MERGE_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REPORT_SCHEMA = { type: 'object', properties: { prs: { type: 'array' }, finalResidueCount: { type: 'integer' }, followUps: { type: 'array' } }, required: ['finalResidueCount'] }

phase('Census')
const census = await agent(CENSUS, { label: 'modes-census', phase: 'Census', schema: CENSUS_SCHEMA, model: 'sonnet' })
const worklist = (census && census.apps) || []
log(`census: ${worklist.length} apps`)

phase('Fix')
const fixResults = await parallel(worklist.slice(0, 20).map((item, i) => () =>
  agent(FIX.replace('{BATCH}', JSON.stringify([{ app: item.app, class: 'mixed', files: [] }])), { label: `modes-fix-${item.app}`, phase: 'Fix', schema: FIX_SCHEMA, model: 'sonnet' }),
))
const fixed = fixResults.filter(Boolean).flatMap(r => r.prs || [])
log(`fix: ${fixed.length} PRs`)

phase('Review')
const reviewBatches = []
for (let i = 0; i < fixed.length; i += 4) reviewBatches.push(fixed.slice(i, i + 4))
const reviewResults = await parallel(reviewBatches.map((rb, i) => () =>
  agent(REVIEW.replace('{PRS}', JSON.stringify(rb)), { label: `modes-review-${i + 1}`, phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' }),
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
    return agent(MERGE.replace('{BATCH}', JSON.stringify(go)), { label: `modes-merge-${i + 1}`, phase: 'Merge', schema: MERGE_SCHEMA, model: 'sonnet' })
  }))
}

phase('Report')
const report = await agent(REPORT, { label: 'modes-report', phase: 'Report', schema: REPORT_SCHEMA, model: 'sonnet' })

return { census, fixes: fixResults.filter(Boolean), reviews: reviewResults.filter(Boolean), merges: mergeResults.filter(Boolean), report }
