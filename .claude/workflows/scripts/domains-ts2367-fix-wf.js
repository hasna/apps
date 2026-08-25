export const meta = {
  name: 'domains-ts2367',
  description: 'Fix lane for row 0fdd8998 (CI build+test: @hasna/domains src/db/store.ts:920 TS2367 types \'"sqlite" | "http"\' vs \'"cloud-http"\' no overlap + :926 TS2339 — modes-class residue in domains source, pre-existing at b7b454f2, untracked until filed 2026-08-21 from the turbo-cycle review P2). Lane: IDEMPOTENCY CHECK FIRST -> reproduce the member build failure at CURRENT main -> root fix: align store.ts backend-type unions to the removed-modes surface (cloud-http no longer exists) -> build+test green -> one Fable review -> base gate + merge -> complete row with evidence.',
  phases: [
    { title: 'Investigate', detail: 'idempotency check; reproduce the domains member build TS2367/TS2339 at CURRENT main (literal rc + errors); read src/db/store.ts around :920/:926 and the backend-type union it flows from' },
    { title: 'Fix', detail: 'smallest owned root fix: remove the dead cloud-http mode from domains source types/wiring (modes directive in force — do NOT re-add the mode)' },
    { title: 'Verify', detail: 'member build passes at head (literal), domains suite green, frozen install rc=0, CI per-check green (or exact named other-lane residual), diff gate (apps/domains + changeset only)' },
    { title: 'Review', detail: 'one Fable adversarial reviewer' },
    { title: 'Land', detail: 'base gate + squash merge + complete row 0fdd8998 with evidence' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '0fdd8998'

const CONST = `
You are the domains-ts2367 lane (row ${ROW}; owner-authorized via the task-drain queue). Final text = machine-readable JSON.

Context (filed 2026-08-21 from the turbo-cycle review P2): CI build+test (affected) fails at Build on @hasna/domains — src/db/store.ts:920 TS2367 (types '"sqlite" | "http"' vs '"cloud-http"' no overlap) and :926 TS2339 (Property 'client' does not exist on type 'never'). Reproduced identically at the pre-merge base b7b454f22 with the direct member build (rc=2) — pre-existing main drift, self-contained in domains' own source, causally independent of the turbo-cycle diff. Class: modes-vocabulary residue — the removed-modes directive (owner 2026-07-29: no mode vocabulary, no deploymentMode(s)) removed the 'cloud-http' backend mode, and domains' source types still reference it.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: confirm row ${ROW} is still pending and unowned (no in_progress fixer row; the cancelled duplicate 6ec51c7d is not a fixer); check for an existing open PR fixing the domains TS2367 (gh pr list --repo hasna/apps --search 'domains in:title,body' — open domains PRs are OTHER scopes unless one specifically fixes the store.ts type mismatch; PR 749 (contracts-pin-drift) and PR 743 (machines-prepare-race) are DIFFERENT lanes: do not confuse or touch them). Sync the checkout (git -C ${MONOREPO} fetch origin main -q; never discard local work). Reproduce at CURRENT origin/main: the domains member build ('bun run build' in apps/domains after a clean frozen install in your worktree) — literal rc + the TS2367/TS2339 errors. If the build already passes at current main, record the evidence and STOP (the lane is complete by recovery). NOTE: main CI may be red at other steps (contracts-pin d175d558, mode-surface 0731ef62, machines-prepare 3b2a7f1e — all separate lanes in flight); your reproduction must isolate the domains build failure.
- ${MONOREPO} is READ/context only. File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/domains-ts2367 cut from CURRENT origin/main. NEW BRANCH fix/domains-ts2367. PR-first; never push to main. Commits end with 'Agent: domains-ts2367-<role>' (the ONLY attribution line; never Co-Authored-By). Commit identity MUST be the canonical fleet identity (name 'Andrei Hasna', email andrei@hasna.com).
- FIX AT THE ROOT, NARROWLY: align the domains backend-type unions and wiring to the removed-modes surface — the 'cloud-http' branch is dead code referencing a removed mode; remove it and make the sqlite|http union consistent (read the surrounding store.ts code to name the correct surviving surface — the modes directive removed the concept, so the union must not retain a cloud-http member). DO NOT re-add the mode, DO NOT weaken tsc strictness, DO NOT @ts-ignore. Add a regression that proves the member build (a build assertion or a type-level test) and a .changeset/domains-ts2367.md patch changeset if package scripts change. HARD SCOPE GATE: the PR diff MUST be limited to apps/domains (store.ts + any directly-flowing type files + the regression + the changeset) — any other app file is a self-inflicted NO_GO.
- VERIFY: the domains member build passes at the head (literal rc + output); the domains suite green (literal passed/failed counts); 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules, literal); CI per-check table at the head (gh api actions/runs?head_sha=<sha> + per-job conclusions, bounded polling — build+test MUST be green for the domains reason; other named lane residuals recorded with the classification); diff gate (apps/domains + changeset only); secrets scan clean (redirect + 'secrets scan input', rc 0 clean).
- REVIEW (one Fable adversarial reviewer): (a) the dead cloud-http mode is removed at the root (no re-add, no strictness weakening, no @ts-ignore), (b) the domains member build passes at the head (literal), (c) domains suite green, (d) CI at the head green for the domains reason (or the exact named non-this-lane residual), (e) diff gate within scope, (f) mergeability vs CURRENT origin/main (merge-tree clean), (g) secrets clean. Post '[REVIEW] <GO|NO_GO> — domains-ts2367 @ <sha> — lens: modes-residue type repair, reviewer domains-ts2367-review' to #board. Block ONLY concrete P0/P1 defects; two remediation cycles max.
- LAND: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: domains-ts2367-land', record the merged sha, LIVE-VERIFY the domains member build at the merged main tip (bounded), complete row ${ROW} with the evidence (merged sha, build rc, suite result, review verdict). If NO_GO: comment findings + resume condition on the PR and the row, leave open, row stays pending.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on the PR and row ${ROW}, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Reproduce the domains member build failure at CURRENT origin/main (frozen install in your worktree first) — literal rc + the TS2367/TS2339 errors; read src/db/store.ts around :920/:926 and the backend-type union it flows from; name the dead cloud-http surface. Return (JSON): { mainTip, reproRc, reproOutput, deadModeSurface, filesToChange: [string], notChecked: [string] }
`

const FIX = CONST + `
ROLE: fix lane (Opus). At the head after investigate: remove the dead cloud-http mode from domains source types/wiring (root fix, no re-add/strictness-weaken/@ts-ignore), add the regression + changeset; HARD SCOPE GATE (see CONST); canonical commit identity; commit; push; open the PR referencing row ${ROW}. Return (JSON): { newHead, rootCauseFixed, memberBuildRc, diffStatSummary, prNumber, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head: domains member build passes (literal rc + output); domains suite green (literal counts); frozen install rc=0 (literal, bun 1.3.14, zero node_modules); CI per-check table at the head (bounded polling; build+test green for the domains reason; other named lane residuals classified); diff gate (apps/domains + changeset only); secrets scan clean. Return (JSON): { memberBuildRc, memberBuildOutput, suiteCounts: {passed, failed}, frozenInstallRc, ciGreen, checks: [{name, conclusion, classification}], ciResiduals: [string], diffGatePass, secretsClean, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). One review at the new head: (a) dead cloud-http mode removed at the root (no re-add/strictness-weaken/@ts-ignore), (b) domains member build passes (literal), (c) domains suite green, (d) CI at the head green for the domains reason (or the exact named non-this-lane residual), (e) diff gate within scope, (f) mergeability vs CURRENT origin/main (merge-tree clean), (g) secrets clean. Post '[REVIEW] <GO|NO_GO> — domains-ts2367 @ <sha> — lens: modes-residue type repair, reviewer domains-ts2367-review' to #board. Block ONLY concrete P0/P1 defects. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: domains-ts2367-land', record merged sha, LIVE-VERIFY the domains member build at the merged main tip (bounded), complete row ${ROW} with the evidence. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, liveBuildRc, rowState, residue: [] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { mainTip: { type: 'string' }, reproRc: { type: 'number' }, reproOutput: { type: 'string' }, deadModeSurface: { type: 'string' }, filesToChange: { type: 'array' }, notChecked: { type: 'array' } }, required: ['mainTip', 'reproRc', 'deadModeSurface'] }
const FIX_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, rootCauseFixed: { type: 'string' }, memberBuildRc: { type: 'number' }, diffStatSummary: { type: 'string' }, prNumber: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'prNumber'] }
const VERIFY_SCHEMA = { type: 'object', properties: { memberBuildRc: { type: 'number' }, memberBuildOutput: { type: 'string' }, suiteCounts: { type: 'object' }, frozenInstallRc: { type: 'number' }, ciGreen: { type: 'boolean' }, checks: { type: 'array' }, ciResiduals: { type: 'array' }, diffGatePass: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['memberBuildRc', 'ciGreen', 'checks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, liveBuildRc: { type: ['number', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'domains-ts2367-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
const fix = investigate && investigate.reproRc !== 0 ? await agent(FIX, { label: 'domains-ts2367-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' }) : null

phase('Verify')
const verify = fix && fix.pushed ? await agent(VERIFY, { label: 'domains-ts2367-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'domains-ts2367-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'investigate/fix/verify did not complete or the build already recovered', detail: JSON.stringify({ investigate, fix, verify }) }] }

phase('Land')
const land = review && review.verdict === 'GO'
  ? await agent(LAND, { label: 'domains-ts2367-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, liveBuildRc: null, rowState: 'pending', residue: ['NO_GO — fix lane must remediate per findings (two-cycle cap)'] }

return { investigate: investigate && { mainTip: investigate.mainTip, reproRc: investigate.reproRc, deadModeSurface: investigate.deadModeSurface }, fix: fix && { newHead: fix.newHead, prNumber: fix.prNumber, memberBuildRc: fix.memberBuildRc, diffStatSummary: fix.diffStatSummary }, verify: verify && { memberBuildRc: verify.memberBuildRc, ciGreen: verify.ciGreen, ciResiduals: verify.ciResiduals }, review: review && review.verdict, land }
