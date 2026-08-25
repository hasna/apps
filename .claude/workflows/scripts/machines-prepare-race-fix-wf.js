export const meta = {
  name: 'machines-prepare-race',
  description: 'Fix lane for row 3b2a7f1e (BUG: hasna/apps root CI — @hasna/machines prepare races @hasna/contracts rebuild, TS7016 missing dist types, all 5 jobs red fleet-wide). Lane: IDEMPOTENCY CHECK FIRST -> reproduce at CURRENT main -> root fix (task-graph/dependency ordering so machines prepare runs after contracts dist is emitted, or prepare stops depending on contracts dist) -> CI 5/5 green + fresh install rc=0 -> one Fable review -> base gate + merge -> complete row with evidence.',
  phases: [
    { title: 'Investigate', detail: 'idempotency check; reproduce the TS7016 race at CURRENT main (CI per-check red table + local repro); name the exact missing dependency edge' },
    { title: 'Fix', detail: 'smallest owned root fix (turbo pipeline/task-graph edge or prepare deps) + regression that proves ordering' },
    { title: 'Verify', detail: 'CI 5/5 green at head, fresh frozen install rc=0, diff gate (root CI config + machines prepare + contracts build wiring only)' },
    { title: 'Review', detail: 'one Fable adversarial reviewer' },
    { title: 'Land', detail: 'base gate + squash merge + complete row 3b2a7f1e with evidence' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '3b2a7f1e-2b3c-4222-a223-2e4796233c8f'

const CONST = `
You are the machines-prepare-race lane (row ${ROW}; owner-authorized via the task-drain queue). Final text = machine-readable JSON.

Context (filed 2026-08-21, HIGH): hasna/apps root CI is red 5/5 fleet-wide — @hasna/machines prepare exits with TS7016 ('Cannot find module' declaration errors) against apps/contracts dist because machines' prepare RACES the contracts rebuild: the task graph lets machines prepare start before contracts build has emitted dist/*.d.ts. The earlier main-install class (contracts emitted NO declarations; fixed at aa0941490) is DIFFERENT from this defect (an ORDERING race, not missing emission) — this is a materially new candidate with its own review budget.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: confirm row ${ROW} is still pending and unowned (no in_progress fixer row); check for an existing open PR fixing this race (gh pr list --repo hasna/apps --search 'machines prepare in:title,body' — PR 730 is a DIFFERENT surface (Docker deps stage), PR 718 is a TERMINATED lineage — do not confuse or touch either). Sync the checkout (git -C ${MONOREPO} fetch origin main -q; never discard local work). Reproduce at CURRENT origin/main: run the failing CI job locally (or the exact prepare+build sequence) — literal rc + the TS7016 output. If CI at current main is already 5/5 green, record the evidence and STOP (the lane is complete by recovery).
- ${MONOREPO} is READ/context only. File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/machines-prepare-race cut from CURRENT origin/main. NEW BRANCH fix/machines-prepare-race. PR-first; never push to main. Commits end with 'Agent: machines-prepare-race-<role>' (the ONLY attribution line; never Co-Authored-By). Commit identity MUST be the canonical fleet identity (name 'Andrei Hasna', email andrei@hasna.com).
- FIX AT THE ROOT, NARROWLY: the race is a missing task-graph dependency — machines prepare MUST NOT start before contracts build has emitted dist (declare the edge in the root pipeline/turbo config or make prepare resolve against a built dependency deterministically). Do NOT weaken the TS7016 strictness, do NOT retarget exports maps away from dist, do NOT add sleeps or retries. Add a regression that proves the ordering (a task-graph assertion or a deterministic build+prepare sequence that fails before the fix and passes after). Add a .changeset/machines-prepare-race.md patch changeset if a package script changes. HARD SCOPE GATE: the PR diff MUST be limited to the root CI/task-graph config + apps/machines prepare + apps/contracts build wiring (+ the regression test + changeset) — any unrelated app file is a self-inflicted NO_GO.
- VERIFY: CI per-check table 5/5 GREEN at the head sha (gh api actions/runs?head_sha=<sha> + per-job conclusions, bounded polling — RULING D NOT acceptable for this lane); fresh-checkout 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules, literal); the regression test red-before/green-after proven; diff gate (git diff origin/main...HEAD --stat within scope); secrets scan clean (redirect + 'secrets scan input', rc 0 clean).
- REVIEW (one Fable adversarial reviewer): (a) the race is fixed at the root (task-graph edge proven, not a sleep/retry), (b) CI 5/5 green at the head MEASURED (per-check table), (c) fresh frozen install rc=0, (d) regression red-before/green-after, (e) diff gate within scope, (f) mergeability vs CURRENT origin/main (merge-tree clean). Post '[REVIEW] <GO|NO_GO> — machines-prepare-race @ <sha> — lens: root CI task-graph repair, reviewer machines-prepare-race-review' to #board. Block ONLY concrete P0/P1 defects; two remediation cycles max.
- LAND: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: machines-prepare-race-land', record the merged sha, LIVE-VERIFY: CI at the merged main tip green (bounded poll) and fresh frozen install rc=0, complete row ${ROW} with the evidence (merged sha, CI table, install rc, review verdict). If NO_GO: comment findings + resume condition on the PR and the row, leave open, row stays pending.
- CYCLE-1 REMEDIATION (bounded-review policy): the initial review returned NO_GO with three named blockers: (P0) CI at head 9383089 red 5/5 — the per-check table shows every failure is an OTHER-lane class (build+test: turbo cycle @hasna/secrets<->@hasna/contracts, owned by row d2776e8f; verify generated: knowledge bin/dist drift, row c5097108; gates: 8 members REFUSE @hasna/contracts 0.13.0-unpublished, row d175d558; publish guard: contracts/mode surface, row 0731ef62; test-suites: versioning allowlist drift, row b335a922); (P1) --ignore-scripts skips member postinstall (mkdir -p $HOME/.hasna/machines et al.) and member suites were never CI-measured under the scriptless install — the 'not gate-load-bearing' claim must be proven by a named green member-suite run at the new head; (P1) base movement — merge tree differs from head tree vs CURRENT origin/main (main advanced: knowledge wave #750), rebase required. REMEDIATE exactly these three: rebase PR #743 onto CURRENT origin/main (tree-equality gate), run the member suite set under the scriptless install at the new head as the named measurement proving postinstall is not gate-load-bearing (literal per-member passed/failed counts; if a postinstall-dependent suite genuinely fails, the fix must add the postinstall into prepare:ordered — never weaken), push. Then VERIFY-2 polls CI at the new head: the Install job MUST be green (the lane's own gate); the other four jobs are classified against the named other-lane residuals (byte-identical failures to origin/main are named residual, not this-lane defects — record the per-check table with the classification). REVIEW-2 is the SAME reviewer lens re-reviewing ONLY the three named defects and their direct regressions — no new whole-system review, no relitigating unchanged evidence.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on the PR and row ${ROW}, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Reproduce the race at CURRENT origin/main: CI per-check red table (gh api actions/runs?head_sha=<main tip> — 5/5 red? which jobs fail with TS7016?) + local repro of machines prepare vs contracts build ordering. Name the exact missing dependency edge and the file(s) to change. Return (JSON): { mainTip, ciRed: [{name, conclusion}], reproRc, reproOutput, missingEdge, filesToChange: [string], notChecked: [string] }
`

const FIX = CONST + `
ROLE: fix lane (Opus). At the head after investigate: apply the smallest owned root fix (task-graph edge or prepare deps) + ordering regression + changeset where applicable; HARD SCOPE GATE (see CONST); canonical commit identity; commit; push; open the PR referencing row ${ROW}. Return (JSON): { newHead, rootCauseFixed, diffStatSummary, prNumber, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head: CI per-check table 5/5 GREEN (gh api actions/runs?head_sha=<sha> + per-job conclusions, bounded polling; RULING D NOT acceptable); fresh-checkout frozen install rc=0 (literal); regression red-before/green-after proven; diff gate (root CI config + machines prepare + contracts build wiring + regression + changeset only); secrets scan clean. Return (JSON): { ciGreen, checks: [{name, conclusion}], installRc, installOutput, regressionProven, diffGatePass, secretsClean, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). One review at the new head: (a) race fixed at the root (task-graph edge, not a sleep/retry/weakened strictness), (b) CI 5/5 green MEASURED (per-check table), (c) fresh frozen install rc=0, (d) regression red-before/green-after, (e) diff gate within scope, (f) mergeability vs CURRENT origin/main (merge-tree clean), (g) secrets clean. Post '[REVIEW] <GO|NO_GO> — machines-prepare-race @ <sha> — lens: root CI task-graph repair, reviewer machines-prepare-race-review' to #board. Block ONLY concrete P0/P1 defects. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const REMEDIATE = CONST + `
ROLE: cycle-1 remediate lane (Opus). Fix EXACTLY the three named NO_GO blockers: (1) REBASE PR #743 onto CURRENT origin/main — resolve the base movement (merge-tree vs current main must equal head tree), keep the diff within the scope gate; (2) PROVE the postinstall blast radius: at the new head, run the member suite set (the apps whose postinstall creates dirs: machines, attachments, datasets, mementos, plus the full affected set) under the scriptless install ('bun install --frozen-lockfile --ignore-scripts' then 'bun run prepare:ordered' then the member test suites) — literal per-member rc + passed/failed counts. If any postinstall-dependent suite fails under the scriptless install, fix at the root by folding the postinstall work into prepare:ordered (never a sleep/retry/weaken); (3) the regression test must still pass red-before/green-after. Commit; push; verify the PR head. Return (JSON): { newHead, rebased, memberSuiteProof: [{member, rc, counts}], postinstallSafe, regressionProven, prNumber, pushed, evidence }
`

const VERIFY2 = CONST + `
ROLE: cycle-1 verify lane (Opus). At the remediated head: CI per-check table (gh api actions/runs?head_sha=<sha>, bounded polling) — the Install job MUST be green (this lane's own gate); the other jobs are CLASSIFIED: byte-identical failure to the named other-lane residual classes (turbo cycle d2776e8f, knowledge drift c5097108, contracts pin d175d558, mode surface 0731ef62, versioning b335a922) is recorded as named residual with the classification, not as this-lane defect; fresh frozen install rc=0 (literal); the member-suite proof from remediate re-measured or accepted with the evidence. Return (JSON): { installGreen, checks: [{name, conclusion, classification}], ciResiduals: [string], frozenInstallRc, memberSuiteProof, evidence }
`

const REVIEW2 = CONST + `
ROLE: cycle-1 re-reviewer (Fable, SAME lens as the initial review — reviewer machines-prepare-race-review). Re-review ONLY the three named NO_GO blockers and their direct regressions: (1) P0 CI: the Install job green at the new head (measured); other jobs classified as named other-lane residuals with byte-identical evidence. (2) P1 postinstall: the named member-suite measurement under the scriptless install — suites green or postinstall folded into prepare:ordered. (3) P1 base movement: merge-tree equality vs CURRENT origin/main at the new head. Do NOT discover or relitigate unrelated issues or unchanged evidence. Post '[REVIEW] <GO|NO_GO> — machines-prepare-race @ <sha> — lens: root CI task-graph repair (cycle 1), reviewer machines-prepare-race-review' to #board. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: machines-prepare-race-land', record merged sha, LIVE-VERIFY merged main tip CI green + fresh frozen install rc=0 (literal), complete row ${ROW} with the evidence. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, liveCiGreen, liveInstallRc, rowState, residue: [] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { mainTip: { type: 'string' }, ciRed: { type: 'array' }, reproRc: { type: 'number' }, reproOutput: { type: 'string' }, missingEdge: { type: 'string' }, filesToChange: { type: 'array' }, notChecked: { type: 'array' } }, required: ['mainTip', 'reproRc', 'missingEdge'] }
const FIX_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, rootCauseFixed: { type: 'string' }, diffStatSummary: { type: 'string' }, prNumber: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'prNumber'] }
const VERIFY_SCHEMA = { type: 'object', properties: { ciGreen: { type: 'boolean' }, checks: { type: 'array' }, installRc: { type: 'number' }, installOutput: { type: 'string' }, regressionProven: { type: 'boolean' }, diffGatePass: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['ciGreen', 'checks', 'installRc'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const REMEDIATE_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, rebased: { type: 'boolean' }, memberSuiteProof: { type: 'array' }, postinstallSafe: { type: 'boolean' }, regressionProven: { type: 'boolean' }, prNumber: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'postinstallSafe'] }
const VERIFY2_SCHEMA = { type: 'object', properties: { installGreen: { type: 'boolean' }, checks: { type: 'array' }, ciResiduals: { type: 'array' }, frozenInstallRc: { type: 'number' }, memberSuiteProof: { type: 'array' }, evidence: { type: 'string' } }, required: ['installGreen', 'checks'] }
const REVIEW2_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, liveCiGreen: { type: 'boolean' }, liveInstallRc: { type: ['number', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'machines-prepare-race-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
const fix = investigate && investigate.reproRc !== 0 ? await agent(FIX, { label: 'machines-prepare-race-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' }) : null

phase('Verify')
const verify = fix && fix.pushed ? await agent(VERIFY, { label: 'machines-prepare-race-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'machines-prepare-race-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'investigate/fix/verify did not complete or the race already recovered', detail: JSON.stringify({ investigate, fix, verify }) }] }

// CYCLE 1 — remediate the named NO_GO blockers only, then re-verify and re-review the same lens
let remediate = null
let verify2 = null
let finalReview = review
if (review && review.verdict === 'NO_GO') {
  phase('Remediate')
  remediate = await agent(REMEDIATE, { label: 'machines-prepare-race-remediate', phase: 'Remediate', schema: REMEDIATE_SCHEMA, model: 'opus' })
  phase('Verify-2')
  verify2 = remediate && remediate.pushed ? await agent(VERIFY2, { label: 'machines-prepare-race-verify2', phase: 'Verify-2', schema: VERIFY2_SCHEMA, model: 'opus' }) : null
  phase('Review-2')
  finalReview = verify2
    ? await agent(REVIEW2, { label: 'machines-prepare-race-review2', phase: 'Review-2', schema: REVIEW2_SCHEMA, model: 'fable' })
    : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'cycle-1 remediation did not complete', detail: JSON.stringify({ remediate, verify2 }) }] }
}

phase('Land')
const land = finalReview && finalReview.verdict === 'GO'
  ? await agent(LAND, { label: 'machines-prepare-race-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, liveCiGreen: false, liveInstallRc: null, rowState: 'pending', residue: ['NO_GO — fix lane must remediate per findings (two-cycle cap)'] }

return { investigate: investigate && { mainTip: investigate.mainTip, reproRc: investigate.reproRc, missingEdge: investigate.missingEdge }, fix: fix && { newHead: fix.newHead, prNumber: fix.prNumber, diffStatSummary: fix.diffStatSummary }, verify: verify && { ciGreen: verify.ciGreen, installRc: verify.installRc, diffGatePass: verify.diffGatePass }, cycle1: { remediate: remediate && { newHead: remediate.newHead, postinstallSafe: remediate.postinstallSafe, memberSuiteProof: remediate.memberSuiteProof }, verify2: verify2 && { installGreen: verify2.installGreen, ciResiduals: verify2.ciResiduals }, review2: finalReview && finalReview.verdict }, review: review && review.verdict, land }
