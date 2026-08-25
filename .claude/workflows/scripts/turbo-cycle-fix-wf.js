export const meta = {
  name: 'turbo-cycle',
  description: 'Fix lane for row d2776e8f (CI build+test: turbo task-graph cycle @hasna/contracts prodDep @hasna/secrets <-> @hasna/secrets devDep @hasna/contracts blocks turbo run build). Lane: IDEMPOTENCY CHECK FIRST -> reproduce at CURRENT main -> root fix (break the cycle in the task graph / dependency direction, NOT a bypass) -> CI build+test green -> one Fable review -> base gate + merge -> complete row with evidence.',
  phases: [
    { title: 'Investigate', detail: 'idempotency check; reproduce turbo run build cycle at CURRENT main; name the exact dependency edge to break' },
    { title: 'Fix', detail: 'smallest owned root fix breaking the cycle (task-graph/pipeline edge or dependency direction)' },
    { title: 'Verify', detail: 'turbo run build passes at head, CI per-check green, frozen install rc=0, diff gate (root CI config + the two apps deps only)' },
    { title: 'Review', detail: 'one Fable adversarial reviewer' },
    { title: 'Land', detail: 'base gate + squash merge + complete row d2776e8f with evidence' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = 'd2776e8f'

const CONST = `
You are the turbo-cycle lane (row ${ROW}; owner-authorized via the task-drain queue). Final text = machine-readable JSON.

Context (filed 2026-08-21): the CI build+test job reports a turbo task-graph cycle: @hasna/contracts (prodDep @hasna/secrets) <-> @hasna/secrets (devDep @hasna/contracts) blocks 'turbo run build' (full and --affected). This is a known class (named P1 in the terminated main-lockfile lineage) that has never been fixed at the root.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: confirm row ${ROW} is still pending and unowned (no in_progress fixer row); check for an existing open PR fixing the cycle (gh pr list --repo hasna/apps --search 'turbo cycle in:title,body' — PR 743 (machines prepare edge) is a DIFFERENT lane: do not confuse or touch it). Sync the checkout (git -C ${MONOREPO} fetch origin main -q; never discard local work). Reproduce at CURRENT origin/main: 'bunx turbo run build' (bounded) — literal rc + the cycle error. If it already passes at current main, record the evidence and STOP (the lane is complete by recovery). NOTE: main CI may currently be red at the Install step (frozen-lockfile class, tracked by row 3b2a7f1e's lane); your reproduction must isolate the build+test job's cycle failure from the Install failure — run the turbo build directly after a successful frozen install in your worktree.
- ${MONOREPO} is READ/context only. File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/turbo-cycle cut from CURRENT origin/main. NEW BRANCH fix/turbo-cycle. PR-first; never push to main. Commits end with 'Agent: turbo-cycle-<role>' (the ONLY attribution line; never Co-Authored-By). Commit identity MUST be the canonical fleet identity (name 'Andrei Hasna', email andrei@hasna.com).
- FIX AT THE ROOT, NARROWLY: break the cycle by fixing the DEPENDENCY DIRECTION or the task-graph edge — do NOT bypass the cycle with a flag, a skip, or a task-graph hack that hides it. Read both packages' dependency wiring and the root turbo pipeline; the smallest owned fix is whichever edge is wrong (e.g. the devDep direction, or a pipeline task that should not depend on the other). Add a regression that proves the graph builds (a turbo dry-run/graph assertion or a deterministic build). Add a .changeset/turbo-cycle.md patch changeset if a package dep changes. HARD SCOPE GATE: the PR diff MUST be limited to the root CI/turbo config + apps/contracts + apps/secrets dependency wiring (+ the regression + changeset) — any unrelated app file is a self-inflicted NO_GO.
- VERIFY: 'bunx turbo run build' passes at the head (literal rc + output, in the worktree with a clean frozen install); 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules, literal); CI per-check table at the head (gh api actions/runs?head_sha=<sha> + per-job conclusions, bounded polling — build+test must be green; the Install-step class is a DIFFERENT lane's scope, but if the head's Install is green because the lockfile class resolved, all 5 must be green); diff gate (within scope); secrets scan clean (redirect + 'secrets scan input', rc 0 clean).
- REVIEW (one Fable adversarial reviewer): (a) the cycle is broken at the root (dependency direction or graph edge — NOT a bypass flag), (b) turbo run build passes at the head (literal), (c) the regression proves the graph, (d) CI at the head green (or the exact named non-this-lane residual), (e) diff gate within scope, (f) mergeability vs CURRENT origin/main (merge-tree clean). Post '[REVIEW] <GO|NO_GO> — turbo-cycle @ <sha> — lens: turbo task-graph repair, reviewer turbo-cycle-review' to #board. Block ONLY concrete P0/P1 defects; two remediation cycles max.
- LAND: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: turbo-cycle-land', record the merged sha, LIVE-VERIFY turbo run build at the merged main tip (bounded), complete row ${ROW} with the evidence (merged sha, turbo rc, CI result, review verdict). If NO_GO: comment findings + resume condition on the PR and the row, leave open, row stays pending.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on the PR and row ${ROW}, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Reproduce the cycle at CURRENT origin/main (frozen install in a scratch dir first, then 'bunx turbo run build' bounded) — literal rc + the exact cycle error; read apps/contracts and apps/secrets package.json dependency wiring and the root turbo pipeline config; name the edge to break. Return (JSON): { mainTip, reproRc, reproOutput, cycleEdges: [string], edgeToBreak, filesToChange: [string], notChecked: [string] }
`

const FIX = CONST + `
ROLE: fix lane (Opus). At the head after investigate: apply the smallest owned root fix (dependency direction or graph edge) + regression + changeset; HARD SCOPE GATE (see CONST); canonical commit identity; commit; push; open the PR referencing row ${ROW}. Return (JSON): { newHead, rootCauseFixed, turboBuildRc, diffStatSummary, prNumber, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head: frozen install rc=0 (literal); 'bunx turbo run build' passes (literal rc + output); CI per-check table at the head (bounded polling; build+test green; if Install is green because the lockfile class resolved, all 5 green required); diff gate (within scope); secrets scan clean. Return (JSON): { frozenInstallRc, turboBuildRc, turboBuildOutput, ciGreen, checks: [{name, conclusion}], diffGatePass, secretsClean, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). One review at the new head: (a) cycle broken at the root (not a bypass flag), (b) turbo run build passes (literal), (c) regression proves the graph, (d) CI at the head green (or the exact named non-this-lane residual), (e) diff gate within scope, (f) mergeability vs CURRENT origin/main (merge-tree clean), (g) secrets clean. Post '[REVIEW] <GO|NO_GO> — turbo-cycle @ <sha> — lens: turbo task-graph repair, reviewer turbo-cycle-review' to #board. Block ONLY concrete P0/P1 defects. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: turbo-cycle-land', record merged sha, LIVE-VERIFY turbo run build at the merged main tip (bounded), complete row ${ROW} with the evidence. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, liveTurboRc, rowState, residue: [] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { mainTip: { type: 'string' }, reproRc: { type: 'number' }, reproOutput: { type: 'string' }, cycleEdges: { type: 'array' }, edgeToBreak: { type: 'string' }, filesToChange: { type: 'array' }, notChecked: { type: 'array' } }, required: ['mainTip', 'reproRc', 'edgeToBreak'] }
const FIX_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, rootCauseFixed: { type: 'string' }, turboBuildRc: { type: 'number' }, diffStatSummary: { type: 'string' }, prNumber: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'prNumber'] }
const VERIFY_SCHEMA = { type: 'object', properties: { frozenInstallRc: { type: 'number' }, turboBuildRc: { type: 'number' }, turboBuildOutput: { type: 'string' }, ciGreen: { type: 'boolean' }, checks: { type: 'array' }, diffGatePass: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['turboBuildRc', 'ciGreen', 'checks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, liveTurboRc: { type: ['number', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'turbo-cycle-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
const fix = investigate && investigate.reproRc !== 0 ? await agent(FIX, { label: 'turbo-cycle-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' }) : null

phase('Verify')
const verify = fix && fix.pushed ? await agent(VERIFY, { label: 'turbo-cycle-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'turbo-cycle-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'investigate/fix/verify did not complete or the cycle already recovered', detail: JSON.stringify({ investigate, fix, verify }) }] }

phase('Land')
const land = review && review.verdict === 'GO'
  ? await agent(LAND, { label: 'turbo-cycle-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, liveTurboRc: null, rowState: 'pending', residue: ['NO_GO — fix lane must remediate per findings (two-cycle cap)'] }

return { investigate: investigate && { mainTip: investigate.mainTip, reproRc: investigate.reproRc, edgeToBreak: investigate.edgeToBreak }, fix: fix && { newHead: fix.newHead, prNumber: fix.prNumber, diffStatSummary: fix.diffStatSummary }, verify: verify && { turboBuildRc: verify.turboBuildRc, ciGreen: verify.ciGreen }, review: review && review.verdict, land }
