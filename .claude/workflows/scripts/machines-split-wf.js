export const meta = {
  name: 'machines-split',
  description: 'Resolve the #595 wave circularity (measured 2026-08-19): @hasna/machines 0.2.28 is unpublished while the wave bumps loops/dispatch optionalDeps to it -> un-installable. Split machines out: machines-only release PR -> merge -> publish-all ships machines 0.2.28 -> rebase the wave branch -> verify install; unblocks the 36-app wave incl. loops 0.5.2',
  phases: [
    { title: 'Split', detail: 'from the wave branch state: PR with ONLY the machines 0.2.27->0.2.28 bump' },
    { title: 'Verify', detail: 'machines PR merges; publish-all next pass ships machines 0.2.28 (registry proof)' },
    { title: 'RebaseWave', detail: 'rebase version-wave-1 on new main, verify frozen install passes' },
    { title: 'Report', detail: 'PRs + wave state + #board' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const WAVE = 595

const CONST = `
You are a lane of the machines-split workflow (2026-08-19). MEASURED CIRCULARITY: PR hasna/apps#${WAVE} (the 36-app version wave, branch version-wave-1, head e845037f) bumps apps/loops optionalDependencies @hasna/machines 0.0.49->0.2.28 (exact) and apps/dispatch ^0.0.24->^0.2.28, and apps/machines 0.2.27->0.2.28 — but @hasna/machines@0.2.28 is UNPUBLISHED (npm max 0.2.27), so bun drops both optional edges and CI fails at install (prepare TS2307 @hasna/machines/consumer; deterministic across 3 fresh environments). The wave is un-installable until machines 0.2.28 is published. RESOLUTION: split the machines bump into its OWN PR; merge it; publish-all's next census ships @hasna/machines@0.2.28; then the wave branch rebases on the new main and its install passes. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in task worktrees ~/.hasna/repos/worktrees/apps/machines-split-<n>; work on the PR's OWN branches. PR-first; never push to main. Commits end with 'Agent: machines-split-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check for an open machines-release PR or a machines bump already merged; check #${WAVE} comments for an existing split attempt. Do not duplicate.
- SPLIT: from the wave branch's state, create branch release/machines-0.2.28 carrying ONLY the apps/machines package.json version bump (0.2.27->0.2.28) + its CHANGELOG entry (the changeset machines entry). NO other files, NO loops/dispatch changes. PR title 'release(machines): 0.2.28', referencing ${WAVE} + this workflow. If the wave branch does not contain the machines bump (already split by another lane), verify and record.
- VERIFY: the machines PR gets a Fable review (mechanical) and merges (base gate, 'Agent: machines-split-ship' trailer). Then confirm @hasna/machines@0.2.28 reaches the registry — publish-all is the ONLY publisher; its next hourly census ships it. If the registry does not show 0.2.28 within the pass, record the resume condition (publish-all next pass) — do NOT publish outside publish-all.
- REBASE-WAVE: after machines 0.2.28 is published, rebase version-wave-1 onto the new origin/main (mechanical; the wave PR is still open), push --force-with-lease, and verify 'bun install --frozen-lockfile' passes at the new wave head (the machines circularity must be gone). Record the wave's new head + CI state.
- No secrets: never print/capture/commit credential values; staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the machines PR + #${WAVE}, posts to #board. English. Lineage 'conversations agents register' named machines-split-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const SPLIT = CONST + `
ROLE: split lane. Per the CONST: create the machines-only release PR from the wave branch state. Record the exact diff summary (must be apps/machines package.json + CHANGELOG only).
Return (JSON): { prNumber: number, diffSummary: string, diffScoped: bool, evidence: string }
`

const REVIEW_MERGE = CONST + `
ROLE: review+merge lane. Per the CONST: Fable review the machines PR ({PR}): diff is machines version+changelog ONLY, no loops/dispatch changes, secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — machines-split @ <sha> — lens: release split, reviewer machines-split-review'. GO -> merge (base gate, squash with 'Agent: machines-split-ship'). Then check the registry: 'npm view @hasna/machines version' — if 0.2.28, record registry proof; if not yet (publish-all's next pass owns it), record the resume condition.
Return (JSON): { prNumber: number, verdict: string, merged: bool, mergedSha: string|null, registryVersion: string, machinesPublished: bool, resumeCondition: string|null, evidence: string }
`

const REBASE_WAVE = CONST + `
ROLE: rebase-wave lane. Per the CONST: after machines 0.2.28 is on the registry (or its publish is confirmed imminent): fetch version-wave-1, rebase onto origin/main (mechanical — version-file conflicts resolved by re-running bunx @changesets/cli version on the wave branch, never hand-edit), push --force-with-lease, verify 'bun install --frozen-lockfile' passes at the new head, record the new head + the wave PR state. If the registry does NOT yet have 0.2.28, record the resume condition and DO NOT rebase yet.
Return (JSON): { rebased: bool, newHead: string, frozenInstallPasses: bool, wavePrState: string, resumeCondition: string|null, evidence: string }
`

const REPORT = CONST + `
ROLE: report. Aggregate: machines PR + merged sha + registry state, wave rebase + new head + install state. Post the summary to #board: machines 0.2.28 route unblocked; wave #${WAVE} installable at <head>; ship-latest's next firing merges the wave; publish-all ships 36 apps incl. loops 0.5.2. Residue: any remaining blocker with the resume condition.
Return (JSON): { machinesPr: number, machinesRegistry: string, waveHead: string, waveInstallable: bool, taskState: string, residue: [string] }
`

const SPLIT_SCHEMA = { type: 'object', properties: { prNumber: { type: ['number', 'null'] }, diffSummary: { type: 'string' }, diffScoped: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['diffScoped'] }
const RM_SCHEMA = { type: 'object', properties: { prNumber: { type: ['number', 'null'] }, verdict: { type: 'string' }, merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, registryVersion: { type: 'string' }, machinesPublished: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['merged'] }
const RW_SCHEMA = { type: 'object', properties: { rebased: { type: 'boolean' }, newHead: { type: 'string' }, frozenInstallPasses: { type: 'boolean' }, wavePrState: { type: 'string' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['rebased'] }
const REPORT_SCHEMA = { type: 'object', properties: { machinesPr: { type: 'number' }, machinesRegistry: { type: 'string' }, waveHead: { type: 'string' }, waveInstallable: { type: 'boolean' }, taskState: { type: 'string' }, residue: { type: 'array' } }, required: ['taskState'] }

phase('Split')
const split = await agent(SPLIT, { label: 'machines-split', phase: 'Split', schema: SPLIT_SCHEMA })
log(`split: ${split && split.prNumber ? '#' + split.prNumber : 'none (verify-recorded)'}`)

phase('Verify')
let rm = null
if (split && split.prNumber) {
  rm = await agent(REVIEW_MERGE.replace('{PR}', String(split.prNumber)), { label: 'machines-review-merge', phase: 'Verify', schema: RM_SCHEMA, model: 'fable' })
} else {
  rm = { merged: false, machinesPublished: false, resumeCondition: 'no machines PR opened', evidence: 'skipped' }
}

phase('RebaseWave')
let rw = null
if (rm && rm.machinesPublished) {
  rw = await agent(REBASE_WAVE, { label: 'machines-rebase-wave', phase: 'RebaseWave', schema: RW_SCHEMA })
} else {
  rw = { rebased: false, newHead: 'none', frozenInstallPasses: false, wavePrState: 'unchanged', resumeCondition: 'machines 0.2.28 not yet on registry — publish-all next pass', evidence: 'skipped' }
}

phase('Report')
const report = await agent(REPORT, { label: 'machines-report', phase: 'Report', schema: REPORT_SCHEMA })

return { split, rm, rw, report }
