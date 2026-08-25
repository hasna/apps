export const meta = {
  name: 'instructions-keystatus',
  description: 'Fix lane for row 67e30a56 (filed from incidents 720505/720506): @hasna/instructions verifyApiKey construction lacks the keyStatus hook from @hasna/contracts auth — instructions list exits rc=1 with "an unregistered key is irrevocable", blocking the instruction-delivery check on station01 (PLAN-FAILED across all 30 homes). Same class as PR 762 (domains) and PR 769 (todos, in flight). Lane: IDEMPOTENCY CHECK FIRST -> reproduce at CURRENT main -> root fix wiring keyStatus at the owning surface -> suite green -> one Fable review -> base gate + merge -> complete the row.',
  phases: [
    { title: 'Investigate', detail: 'idempotency check; reproduce instructions list rc=1 at CURRENT origin/main (literal); locate the verifyApiKey construction and name the missing keyStatus hook' },
    { title: 'Fix', detail: 'smallest owned root fix wiring keyStatus (contracts auth hook, no parallel implementation); regression; changeset' },
    { title: 'Verify', detail: 'instructions member suite green (literal counts), member build rc=0, frozen install rc=0, CI per-check at head, diff gate (apps/instructions + changeset only), secrets scan clean' },
    { title: 'Review', detail: 'one Fable adversarial reviewer' },
    { title: 'Land', detail: 'base gate + squash merge + complete row 67e30a56 with evidence' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '67e30a56'

const CONST = `
You are the instructions-keystatus lane (row ${ROW}; owner-authorized via the task-drain queue). Final text = machine-readable JSON.

Context (filed 2026-08-21 from incidents 720505/720506, station01-instruction-delivery): 'instructions list' exits rc=1 with 'verifyApiKey was given only isRevoked, which cannot refuse a key this service has no record of: it returns false both for an active key and for one that was never registered, so an unregistered key is irrevocable. Wire keyStatus: store.keyStatus (or isRevoked: store.statusChecker()), or set allowUnregisteredKeys: true to accept that risk explicitly.' — the instructions CLI's verifyApiKey construction lacks the keyStatus hook from @hasna/contracts auth. The instruction-delivery check is PLAN-FAILED across all 30 homes on station01 because this read fails. Same class as PR 762 (domains — keyStatus wired at app.ts) and PR 769 (todos — in flight).

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: confirm row ${ROW} is still pending and unowned (no in_progress fixer row); check for an existing open PR fixing the keyStatus/verifyApiKey class in apps/instructions (gh pr list --repo hasna/apps --search 'keyStatus in:title,body' and 'verifyApiKey in:title,body' — open PRs 762 (domains, merged) and 769 (todos) are OTHER members: do not confuse or touch them). Sync the checkout (git -C ${MONOREPO} fetch origin main -q; never discard local work). Reproduce at CURRENT origin/main: in your worktree after a clean frozen install, run 'instructions list' (or the CLI verb that triggers the verifyApiKey path) — literal rc + the stderr line. If the read already succeeds at current main, record the evidence and STOP (the lane is complete by recovery).
- ${MONOREPO} is READ/context only. File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/instructions-keystatus cut from CURRENT origin/main. NEW BRANCH fix/instructions-keystatus. PR-first; never push to main. Commits end with 'Agent: instructions-keystatus-<role>' (the ONLY attribution line; never Co-Authored-By). Commit identity MUST be the canonical fleet identity (name 'Andrei Hasna', email andrei@hasna.com).
- FIX AT THE ROOT, NARROWLY: locate the verifyApiKey construction in apps/instructions (search the source for 'verifyApiKey' and 'isRevoked') and name the exact surface; wire 'keyStatus: store.keyStatus' (or the contracts-provided status hook) the way PR 762 wired it in apps/domains — match the member's own auth flow and the contracts auth surface; do not hand-roll a parallel key-status implementation, and do NOT set allowUnregisteredKeys:true as a workaround (that accepts the risk explicitly — the fix is the hook). Add a regression that proves the verifyApiKey path refuses-and-accepts correctly (mirror the domains keystatus regression class) and a .changeset/instructions-keystatus.md patch changeset. HARD SCOPE GATE: the PR diff MUST be limited to apps/instructions (the auth wiring file + directly-flowing auth files + the regression + the changeset) — any other app file is a self-inflicted NO_GO. If the root cause lives in @hasna/contracts rather than apps/instructions, diagnose it, record the exact owning fix needed, and STOP with the finding (do NOT modify apps/contracts in this lane without a named contracts owner).
- VERIFY: the instructions member suite passes at the head (literal passed/failed counts); the verifyApiKey repro verb ('instructions list') rc=0 at the head (literal); instructions member build rc=0 (literal); 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules, literal); CI per-check table at the head (gh api actions/runs?head_sha=<sha> + per-job conclusions, bounded polling — build+test green for the instructions reason; other named lane residuals recorded with the classification); diff gate (apps/instructions + changeset only); secrets scan clean (redirect + 'secrets scan input', rc 0 clean).
- REVIEW (one Fable adversarial reviewer): (a) root fix wired at the owning surface (keyStatus hook from contracts auth, no parallel implementation, no allowUnregisteredKeys workaround), (b) 'instructions list' rc=0 at the head (literal), (c) instructions member suite green, (d) CI at the head green for the instructions reason (or the exact named non-this-lane residual), (e) diff gate within scope, (f) mergeability vs CURRENT origin/main (merge-tree clean), (g) secrets clean. Post '[REVIEW] <GO|NO_GO> — instructions-keystatus @ <sha> — lens: auth key-status hook repair, reviewer instructions-keystatus-review' to #board. Block ONLY concrete P0/P1 defects; two remediation cycles max.
- LAND: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: instructions-keystatus-land', record the merged sha, LIVE-VERIFY 'instructions list' rc=0 at the merged main tip (bounded), complete row ${ROW} with the evidence (merged sha, repro result, review verdict). If NO_GO: comment findings + resume condition on the PR and the row, leave open, row stays pending.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on the PR and row ${ROW}, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Reproduce the verifyApiKey failure at CURRENT origin/main (literal rc + stderr); locate the verifyApiKey construction in apps/instructions source and name the missing keyStatus hook + the correct wiring (mirror PR 762's domains fix). Return (JSON): { mainTip, reproRc, reproOutput, rootCauseSurface, missingHook, filesToChange: [string], notChecked: [string] }
`

const FIX = CONST + `
ROLE: fix lane (Opus). At the head after investigate: wire the keyStatus hook at the owning surface (contracts auth hook, no parallel implementation, no allowUnregisteredKeys workaround), add the regression + changeset; HARD SCOPE GATE (see CONST — if root cause is in apps/contracts, STOP with the finding); canonical commit identity; commit; push; open the PR referencing row ${ROW}. Return (JSON): { newHead, rootCauseFixed, reproRc, suiteCounts: {passed, failed}, diffStatSummary, prNumber, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head: 'instructions list' rc=0 (literal); instructions member suite passes (literal counts); instructions member build rc=0 (literal); frozen install rc=0 (literal, bun 1.3.14, zero node_modules); CI per-check table at the head (bounded polling; build+test green for the instructions reason; other named lane residuals classified); diff gate (apps/instructions + changeset only); secrets scan clean. Return (JSON): { reproRc, suiteCounts: {passed, failed}, memberBuildRc, frozenInstallRc, ciGreen, checks: [{name, conclusion, classification}], ciResiduals: [string], diffGatePass, secretsClean, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). One review at the new head: (a) root fix wired at the owning surface (keyStatus hook, no parallel implementation, no workaround flag), (b) 'instructions list' rc=0 (literal), (c) instructions member suite green, (d) CI at the head green for the instructions reason (or the exact named non-this-lane residual), (e) diff gate within scope, (f) mergeability vs CURRENT origin/main (merge-tree clean), (g) secrets clean. Post '[REVIEW] <GO|NO_GO> — instructions-keystatus @ <sha> — lens: auth key-status hook repair, reviewer instructions-keystatus-review' to #board. Block ONLY concrete P0/P1 defects. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: instructions-keystatus-land', record merged sha, LIVE-VERIFY 'instructions list' rc=0 at the merged main tip (bounded), complete row ${ROW} with the evidence. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, liveReproRc, rowState, residue: [] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { mainTip: { type: 'string' }, reproRc: { type: 'number' }, reproOutput: { type: 'string' }, rootCauseSurface: { type: 'string' }, missingHook: { type: 'string' }, filesToChange: { type: 'array' }, notChecked: { type: 'array' } }, required: ['mainTip', 'reproRc', 'rootCauseSurface'] }
const FIX_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, rootCauseFixed: { type: 'string' }, reproRc: { type: 'number' }, suiteCounts: { type: 'object' }, diffStatSummary: { type: 'string' }, prNumber: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'prNumber'] }
const VERIFY_SCHEMA = { type: 'object', properties: { reproRc: { type: 'number' }, suiteCounts: { type: 'object' }, memberBuildRc: { type: 'number' }, frozenInstallRc: { type: 'number' }, ciGreen: { type: 'boolean' }, checks: { type: 'array' }, ciResiduals: { type: 'array' }, diffGatePass: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['reproRc', 'ciGreen', 'checks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, liveReproRc: { type: ['number', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'instructions-ks-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
const fix = investigate && investigate.reproRc !== 0 ? await agent(FIX, { label: 'instructions-ks-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' }) : null

phase('Verify')
const verify = fix && fix.pushed ? await agent(VERIFY, { label: 'instructions-ks-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'instructions-ks-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'investigate/fix/verify did not complete or the read already recovered', detail: JSON.stringify({ investigate, fix, verify }) }] }

phase('Land')
const land = review && review.verdict === 'GO'
  ? await agent(LAND, { label: 'instructions-ks-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, liveReproRc: null, rowState: 'pending', residue: ['NO_GO — fix lane must remediate per findings (two-cycle cap)'] }

return { investigate: investigate && { mainTip: investigate.mainTip, reproRc: investigate.reproRc, rootCauseSurface: investigate.rootCauseSurface }, fix: fix && { newHead: fix.newHead, prNumber: fix.prNumber, reproRc: fix.reproRc, suiteCounts: fix.suiteCounts }, verify: verify && { reproRc: verify.reproRc, ciGreen: verify.ciGreen, ciResiduals: verify.ciResiduals }, review: review && review.verdict, land }
