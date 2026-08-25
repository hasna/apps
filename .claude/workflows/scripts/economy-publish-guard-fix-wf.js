export const meta = {
  name: 'economy-publish-guard-fix',
  description: 'Row 029ceb00 (filed 2026-08-21 as the publish-guard sibling of 0cbbd621): hasna/apps publish-guard gate red at EVERY PR head and on main — apps/economy prepack `bun run build` exits 2 with TS2307 Cannot find module @hasna/projects at src/lib/open-projects.ts(31,38). Lane: reproduce at CURRENT main (TDD red), root fix in apps/economy deps/imports, publish-guard green, one Fable review, PR, merge, complete the row.',
  phases: [
    { title: 'Investigate', detail: 'idempotency check; reproduce TS2307 at CURRENT origin/main (literal); name the root cause (missing workspace dep declaration vs wrong import)' },
    { title: 'Fix', detail: 'smallest owned root fix in apps/economy; regression (prepack build passes); changeset' },
    { title: 'Verify', detail: 'publish-guard + member build + suite green at head; frozen install; CI per-check at head (incl. publish-guard)' },
    { title: 'Review', detail: 'one Fable adversarial reviewer' },
    { title: 'Land', detail: 'base gate + squash merge + complete row 029ceb00' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '029ceb00'

const CONST = `
You are the economy-publish-guard-fix lane (row ${ROW}; owner-authorized via the task-drain queue). Final text = machine-readable JSON.

Context (filed from pr-drain PASS 80 residue, 2026-08-21): hasna/apps publish-guard gate is RED at every PR head and on main itself — apps/economy prepack 'bun run build' exits 2 with 'src/lib/open-projects.ts(31,38): error TS2307: Cannot find module '@hasna/projects''. Evidence: run 32472685167 job 96742593962 (PR 766, attachments-only diff — the failure is in apps/economy, not the PR). This blocks the entire merge queue.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: (a) row ${ROW} is pending and unowned (no in_progress fixer row, no open PR fixing the economy open-projects.ts/TS2307 class — check gh pr list --repo hasna/apps --search 'economy in:title,body'); (b) reproduce the defect at CURRENT origin/main FIRST: in your worktree after a clean frozen install, run the apps/economy prepack build (bun run build in apps/economy) — literal rc + TS2307 output. If main already builds clean, record the evidence and STOP (lane complete by recovery).
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} fetch origin main -q; never discard local work). Resolve CURRENT origin/main from FETCH_HEAD and verify FETCH_HEAD == gh api repos/hasna/apps/commits/heads/main --jq .sha. File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/economy-publish-guard cut from CURRENT origin/main. NEW BRANCH fix/economy-publish-guard. PR-first; never push to main. Commits end with 'Agent: economy-publish-guard-fix-<role>' (the ONLY attribution line; never Co-Authored-By). Commit identity MUST be the canonical fleet identity (Andrei Hasna <andrei@hasna.com>).
- ROOT CAUSE, NARROWLY: read src/lib/open-projects.ts:31,38 and apps/economy package.json + workspace tooling to name the exact failure (a missing '@hasna/projects' dependency declaration in apps/economy, or an import path that resolves only in a non-prepack context). Fix the owning surface with the smallest change — declare the dependency at the version main pins (check other members' pinned @hasna/projects version; prefer the workspace convention), or correct the import if that is the true defect. DO NOT add @ts-ignore, DO NOT stub the module, DO NOT touch files outside apps/economy (+ changeset). Add a regression that proves the prepack build passes (a build assertion or CI-shaped test) and a .changeset/economy-publish-guard.md patch changeset.
- VERIFY at the new head: apps/economy prepack build rc=0 (literal); the repo's publish-guard gate green (run the same gate CI runs — 'bun run check' or the named gate verb at the root, literal rc); economy member suite green (literal counts); 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules, literal); CI per-check table at the head (gh api actions/runs?head_sha=<sha> + per-job conclusions, bounded polling — publish-guard MUST be green; other named lane residuals recorded with classification); secrets scan clean.
- REVIEW (one Fable adversarial reviewer): (a) red-before/green-after measured (not skipped), (b) root fix at the owning surface (dependency declaration or import correction — no ts-ignore/stub), (c) publish-guard + prepack build green at the head (literal), (d) CI at the head green for the economy reason, (e) diff gate within scope, (f) mergeability vs CURRENT origin/main (merge-tree clean), (g) secrets clean. Post '[REVIEW] <GO|NO_GO> — economy-publish-guard @ <sha> — lens: publish-guard TS2307 root fix, reviewer economy-publish-guard-review' to #board. Block ONLY concrete P0/P1 defects; two remediation cycles max.
- LAND: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: economy-publish-guard-fix-land', record the merged sha, LIVE-VERIFY the publish-guard gate at the merged main tip (bounded), complete row ${ROW} with evidence (merged sha, gate result, review verdict). The package publishes via publish-all's next census (the ONLY publisher) — this lane never calls npm publish.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on the PR and row ${ROW}, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Reproduce the TS2307 at CURRENT origin/main (literal rc + output); read src/lib/open-projects.ts:31,38 and apps/economy package.json + workspace tooling to name the exact root cause; check the pinned @hasna/projects version other members use. Return (JSON): { reproRc, reproOutput, rootCauseSurface, missingDep, pinnedVersion, filesToChange: [string], notChecked: [string] }
`

const FIX = CONST + `
ROLE: fix lane (Opus). At the head after investigate: apply the smallest owned root fix in apps/economy (dependency declaration at the pinned version or import correction — never ts-ignore/stub), add the regression + changeset; HARD SCOPE GATE (apps/economy + changeset only); canonical commit identity; commit; push; open the PR referencing row ${ROW}. Return (JSON): { newHead, rootCauseFixed, prepackBuildRc, diffStatSummary, prNumber, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head: apps/economy prepack build rc=0 (literal); root publish-guard gate green (literal rc); economy member suite green (literal counts); frozen install rc=0 (literal, bun 1.3.14, zero node_modules); CI per-check table at the head (bounded polling; publish-guard green for the economy reason; other named lane residuals classified); diff gate (apps/economy + changeset only); secrets scan clean. Return (JSON): { prepackBuildRc, publishGuardGreen, suiteCounts: {passed, failed}, frozenInstallRc, ciGreen, checks: [{name, conclusion, classification}], ciResiduals: [string], diffGatePass, secretsClean, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). One review at the new head: (a) red-before/green-after measured, (b) root fix at the owning surface (no ts-ignore/stub), (c) prepack build + publish-guard green (literal), (d) CI at the head green for the economy reason (or the exact named non-this-lane residual), (e) diff gate within scope, (f) mergeability vs CURRENT origin/main (merge-tree clean), (g) secrets clean. Post '[REVIEW] <GO|NO_GO> — economy-publish-guard @ <sha> — lens: publish-guard TS2307 root fix, reviewer economy-publish-guard-review' to #board. Block ONLY concrete P0/P1 defects. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: economy-publish-guard-fix-land', record merged sha, LIVE-VERIFY the publish-guard gate at the merged main tip (bounded), complete row ${ROW} with evidence. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, liveGateRc, rowState, residue: [] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { reproRc: { type: 'number' }, reproOutput: { type: 'string' }, rootCauseSurface: { type: 'string' }, missingDep: { type: 'boolean' }, pinnedVersion: { type: 'string' }, filesToChange: { type: 'array' }, notChecked: { type: 'array' } }, required: ['reproRc', 'rootCauseSurface'] }
const FIX_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, rootCauseFixed: { type: 'string' }, prepackBuildRc: { type: 'number' }, diffStatSummary: { type: 'string' }, prNumber: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'prNumber'] }
const VERIFY_SCHEMA = { type: 'object', properties: { prepackBuildRc: { type: 'number' }, publishGuardGreen: { type: 'boolean' }, suiteCounts: { type: 'object' }, frozenInstallRc: { type: 'number' }, ciGreen: { type: 'boolean' }, checks: { type: 'array' }, ciResiduals: { type: 'array' }, diffGatePass: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['prepackBuildRc', 'publishGuardGreen', 'ciGreen', 'checks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, liveGateRc: { type: ['number', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'economy-pg-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
const fix = investigate && investigate.reproRc !== 0 ? await agent(FIX, { label: 'economy-pg-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' }) : null

phase('Verify')
const verify = fix && fix.pushed ? await agent(VERIFY, { label: 'economy-pg-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'economy-pg-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'investigate/fix/verify did not complete or the gate already recovered', detail: JSON.stringify({ investigate, fix, verify }) }] }

phase('Land')
const land = review && review.verdict === 'GO'
  ? await agent(LAND, { label: 'economy-pg-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, liveGateRc: null, rowState: 'pending', residue: ['NO_GO — fix lane must remediate per findings (two-cycle cap)'] }

return { investigate: investigate && { reproRc: investigate.reproRc, rootCauseSurface: investigate.rootCauseSurface }, fix: fix && { newHead: fix.newHead, prNumber: fix.prNumber, prepackBuildRc: fix.prepackBuildRc }, verify: verify && { publishGuardGreen: verify.publishGuardGreen, ciGreen: verify.ciGreen }, review: review && review.verdict, land }
