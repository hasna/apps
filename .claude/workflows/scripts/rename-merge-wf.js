export const meta = {
  name: 'rename-merge',
  description: 'Merge-completion for the machines->stations rename PRs hasna/apps#636 (rename) + #637 (consumers): prepared and reviewed-GO by the rename lane (wf_a5fb1260-bff), parked on the gate "#636/#637 merge after #600+#602 mergedAt". #600 MERGED; the #602 gate is now PERMANENTLY UNSATISFIABLE (wave lineage stopped 2026-08-20 — #602 closed as the stopped-lineage record). The gate is invalidated: this lane merges the rename on its own merits — rebase both onto current origin/main, CI 5/5 each, scoped Fable re-review of the rebase deltas, base gates, merge both, [BREAKING] already posted (713812)',
  phases: [
    { title: 'Rebase', detail: 'rebase #636 + #637 onto current origin/main' },
    { title: 'Verify', detail: 'CI 5/5 on both at their new heads' },
    { title: 'Review', detail: 'Fable scoped re-review of the rebase deltas' },
    { title: 'Ship', detail: 'base gates, merge both, rename complete' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '8a009167'

const CONST = `
You are a lane of the rename-merge workflow (2026-08-20). The machines->stations rename: PR hasna/apps#636 (rename of the machines app to stations) and #637 (consumers) were prepared and reviewed by the rename lane (machines-stations rename, wf_a5fb1260-bff; [BREAKING] posted 713812), parked with the gate "merge after #600+#602 mergedAt". #600 MERGED (d2045635, machines 0.2.28). #602 (version wave) is now CLOSED as the stopped-lineage record (bounded-review policy, 2026-08-20) — the gate is permanently unsatisfiable and therefore INVALIDATED. This lane merges the rename on its own merits: rebase both PRs onto current origin/main, CI 5/5 each, scoped Fable re-review of the rebase deltas, base-movement gates, merge both, complete row ${ROW}. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work; shared checkout dirty from other lanes — fetch refs and work from a worktree if the pull refuses). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/rename-m-<n>; work on each PR's OWN branch (gh pr view <n> --json headRefName, never guess). PR-first; never push to main. Commits end with 'Agent: rename-m-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check PRs #636/#637 — if either already merged or its head moved, verify and record; do not duplicate.
- REBASE ONLY: rebase each onto current origin/main. The rename content (machines -> stations app identity) must be intact after the rebase; name any merge resolution and why. #637 (consumers) may touch many files — resolve keeping the rename's consumer updates.
- Verify: 'bun install --frozen-lockfile' rc=0, affected suites green (record counts), secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on PRs #636/#637 and row ${ROW}, posts to #board. English. Lineage 'conversations agents register' named rename-m-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const REBASE = CONST + `
ROLE: rebase lane. Per the CONST: rebase BOTH PRs (#636 then #637) onto current origin/main; rename content intact per PR (record the diff-vs-reviewed delta for each); frozen install rc=0, affected suites green (record counts), secrets scan, commit ('Agent: rename-m-<your-role>') per PR, push --force-with-lease both.
Return (JSON): { heads: {pr636: string, pr637: string}, diffSummaries: [{pr, diff}], renameIntact: bool, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks 636' and 'gh pr checks 637', re-run failed jobs (gh run rerun), poll bounded (max 25 min), require ALL FIVE checks GREEN on BOTH at their new heads (record the per-check tables). The known environmental playwright stall, if the ONLY failure, re-run once and record.
Return (JSON): { checks: {pr636: [{name, status, conclusion}], pr637: [{name, status, conclusion}]}, ciGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) — scoped re-review of the rebase deltas. Review: (a) each new head = origin/main + the unchanged rename content, (b) rename consistency between #636 and #637 (same name, no stragglers), (c) 5/5 CI green on both, (d) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — rename-m @ <sha636>,<sha637> — lens: rename rebase delta, reviewer rename-m-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge #637 FIRST then #636 (consumers before the rename so no broken refs; base-movement gate each — merge-tree against origin/main; gh pr merge --squash --body-file ending 'Agent: rename-m-ship' each), record merged shas, complete row ${ROW} with the evidence and the [BREAKING] reference (713812 posted pre-landing). If NO_GO: comment findings + resume condition, leave open.
Return (JSON): { merged636: bool, merged637: bool, mergedShas: {pr636: string|null, pr637: string|null}, rowState: string, residue: [string] }
`

const REBASE_SCHEMA = { type: 'object', properties: { heads: { type: 'object' }, diffSummaries: { type: 'array' }, renameIntact: { type: 'boolean' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['heads', 'diffSummaries'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'object' }, ciGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged636: { type: 'boolean' }, merged637: { type: 'boolean' }, mergedShas: { type: 'object' }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged636', 'merged637'] }

phase('Rebase')
const rebase = await agent(REBASE, { label: 'rename-m-rebase', phase: 'Rebase', schema: REBASE_SCHEMA })

phase('Verify')
let verify = null
if (rebase && rebase.heads) {
  verify = await agent(VERIFY, { label: 'rename-m-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'rebase did not complete', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW, { label: 'rename-m-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'rebase/verify did not complete', detail: JSON.stringify({ rebase, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'rename-m-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { rebase, verify, review, ship }
