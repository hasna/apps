export const meta = {
  name: 'calendar-serve-help-fix',
  description: 'Fix lane for row dd27cac0 (BUG: @hasna/calendar — calendar-serve binds before answering --help; serve bin starts listening then refuses without credential). SAME defect class as attachments serve-help-before-bind (row 970d7c6f, PR 766, GO lineage): startup order — the serve bin creates the pool/binds before parsing --help/--version. Lane: IDEMPOTENCY CHECK FIRST -> reproduce at CURRENT main -> root fix (arg parse before any bind/pool creation) in apps/calendar -> suite + two-sided probes -> one Fable review -> base gate + merge -> complete the row.',
  phases: [
    { title: 'Investigate', detail: 'idempotency check; reproduce calendar-serve --help/--version binding before answering (literal) at CURRENT origin/main; locate the startup order in apps/calendar serve entry' },
    { title: 'Fix', detail: 'smallest owned root fix: parse --help/--version BEFORE any pool creation/bind (mirror attachments PR 766 shape); regression test (help/version rc=0 without pool; serve still binds/refuses without credential); changeset' },
    { title: 'Verify', detail: 'calendar suite green (literal counts); two-sided probes at head (--help/--version rc=0 no-pool; plain serve still attempts pool/binds — literal); frozen install; CI per-check at head; diff gate (apps/calendar + changeset only); secrets clean' },
    { title: 'Review', detail: 'one Fable adversarial reviewer' },
    { title: 'Land', detail: 'base gate + squash merge + complete row dd27cac0 with evidence' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = 'dd27cac0'

const CONST = `
You are the calendar-serve-help-fix lane (row ${ROW}; owner-authorized via the task-drain queue). Final text = machine-readable JSON.

Context (filed 2026-08-21T12:21Z): @hasna/calendar's serve bin starts listening before answering --help — the serve entry creates the pool/binds first, then refuses without a credential, so 'calendar-serve --help' exits non-zero instead of printing usage. This is the SAME defect class as attachments serve-help-before-bind (row 970d7c6f, PR 766 — fix = arg parse before pool/bind, GO lineage across three heads, byte-identical fix content). The fix shape is established: parse/answer --help and --version BEFORE any pool creation, bind, or credential touch.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: (a) row ${ROW} is pending and unowned (no in_progress fixer row); (b) no open PR fixes the calendar serve-help/bind-order class (gh pr list --repo hasna/apps --search 'calendar in:title,body' — 459 manifest-align and 772 version-wave are OTHER classes, do not touch them); (c) reproduce at CURRENT origin/main FIRST: in your worktree after a clean frozen install, run 'calendar-serve --help' and '--version' — literal rc + output (does it bind first? does it refuse without credential?). If the read already succeeds at current main, record the evidence and STOP (the lane is complete by recovery).
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} fetch origin main -q; never discard local work). Resolve CURRENT origin/main from FETCH_HEAD and verify FETCH_HEAD == gh api repos/hasna/apps/commits/heads/main --jq .sha. File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/calendar-serve-help cut from CURRENT origin/main. NEW BRANCH fix/calendar-serve-help-before-bind. PR-first; never push to main. Commits end with 'Agent: calendar-serve-help-fix-<role>' (the ONLY attribution line; never Co-Authored-By). Commit identity MUST be the canonical fleet identity (Andrei Hasna <andrei@hasna.com>).
- FIX AT THE ROOT, NARROWLY: locate the serve entry in apps/calendar (search for the serve bin source and its startup sequence); move the --help/--version answer BEFORE any pool creation/bind/credential touch. Mirror the attachments PR 766 shape (early-args test class). Add a regression that proves: --help and --version exit rc=0 WITHOUT creating the pool/binding (no listen, no fatal, no credential refusal — literal probes), and plain serve STILL creates the pool and refuses without a credential (negative probe intact — the startup order change must not disable the credential guard). Add a .changeset/calendar-serve-help-before-bind.md patch changeset. HARD SCOPE GATE: the PR diff MUST be limited to apps/calendar (the serve entry + directly-flowing files + the regression + the changeset) — any other app file is a self-inflicted NO_GO.
- VERIFY at the head (bounded): calendar suite green (literal passed/failed counts); the two-sided probes re-run at the head (--help rc=0 + usage WITHOUT pool creation; --version rc=0; plain serve rc=1 with the credential refusal and the pool still attempted — literal); 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules, literal); CI per-check table at the head (bounded polling — classify every failure against CURRENT origin/main state: main's own run must fail identically for a main-state residual (contracts 0.13.2/0.13.3 resolution class, versioning-integrity); calendar-caused failures MUST be green); diff gate (apps/calendar + changeset only); secrets scan clean.
- REVIEW (one Fable adversarial reviewer): (a) red-before/green-after measured (the repro at CURRENT main vs the fix at the head, literal), (b) root fix at the owning surface (arg parse before bind — no credential-guard weakening, no ts-ignore, no stub), (c) two-sided probes pass at the head (help/version rc=0 no-pool AND plain serve still refuses without credential — literal), (d) calendar suite green, (e) CI at the head green for the calendar reason (or the exact named non-this-lane residual), (f) diff gate within scope, (g) mergeability vs CURRENT origin/main (merge-tree clean), (h) secrets clean. Post '[REVIEW] <GO|NO_GO> — calendar-serve-help-fix @ <sha> — lens: serve bind-order root fix, reviewer calendar-serve-help-review' to #board. Block ONLY concrete P0/P1 defects; two remediation cycles max.
- LAND: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: calendar-serve-help-fix-land', record the merged sha, LIVE-VERIFY 'calendar-serve --help' rc=0 at the merged main tip (bounded), complete row ${ROW} with evidence. If NO_GO: comment findings + resume condition, leave open, row stays pending. The package publishes via publish-all's next census (the ONLY publisher) — this lane never calls npm publish.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on the PR and row ${ROW}, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Reproduce 'calendar-serve --help' and '--version' at CURRENT origin/main (literal rc + output — does it bind first / refuse without credential?); locate the serve startup order in apps/calendar source and name the exact surface where the answer should move. Return (JSON): { mainTip, reproHelpRc, reproVersionRc, reproOutput, rootCauseSurface, filesToChange: [string], notChecked: [string] }
`

const FIX = CONST + `
ROLE: fix lane (Opus). At the head after investigate: apply the smallest owned root fix in apps/calendar (arg parse/help/version BEFORE any pool creation/bind/credential touch, mirroring attachments PR 766); add the regression (two-sided: help/version rc=0 without pool; plain serve still refuses without credential) + changeset; HARD SCOPE GATE (apps/calendar + changeset only); canonical commit identity; commit; push; open the PR referencing row ${ROW}. Return (JSON): { newHead, rootCauseFixed, reproHelpRc, diffStatSummary, prNumber, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head: 'calendar-serve --help' rc=0 without pool creation (literal); '--version' rc=0 (literal); plain serve rc=1 with credential refusal and pool attempted (literal); calendar suite green (literal counts); 'bun install --frozen-lockfile' rc=0 (literal, bun 1.3.14, zero node_modules); CI per-check table at the head (bounded polling; every failure classified vs CURRENT origin/main — main-state residuals named, calendar-caused MUST be green); diff gate (apps/calendar + changeset only); secrets scan clean. Return (JSON): { helpRc, versionRc, serveRefusalRc, suiteCounts: {passed, failed}, frozenInstallRc, ciGreen, checks: [{name, conclusion, classification}], ciResiduals: [string], diffGatePass, secretsClean, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). One review at the new head: (a) red-before/green-after measured, (b) root fix at the owning surface (arg parse before bind — no guard weakening), (c) two-sided probes pass (literal), (d) calendar suite green, (e) CI at the head green for the calendar reason (or the exact named non-this-lane residual), (f) diff gate within scope, (g) mergeability vs CURRENT origin/main (merge-tree clean), (h) secrets clean. Post '[REVIEW] <GO|NO_GO> — calendar-serve-help-fix @ <sha> — lens: serve bind-order root fix, reviewer calendar-serve-help-review' to #board. Block ONLY concrete P0/P1 defects. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: calendar-serve-help-fix-land', record merged sha, LIVE-VERIFY 'calendar-serve --help' rc=0 at the merged main tip (bounded), complete row ${ROW} with evidence. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, liveHelpRc, rowState, residue: [] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { mainTip: { type: 'string' }, reproHelpRc: { type: 'number' }, reproVersionRc: { type: 'number' }, reproOutput: { type: 'string' }, rootCauseSurface: { type: 'string' }, filesToChange: { type: 'array' }, notChecked: { type: 'array' } }, required: ['mainTip', 'reproHelpRc', 'rootCauseSurface'] }
const FIX_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, rootCauseFixed: { type: 'string' }, reproHelpRc: { type: 'number' }, diffStatSummary: { type: 'string' }, prNumber: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'prNumber'] }
const VERIFY_SCHEMA = { type: 'object', properties: { helpRc: { type: 'number' }, versionRc: { type: 'number' }, serveRefusalRc: { type: 'number' }, suiteCounts: { type: 'object' }, frozenInstallRc: { type: 'number' }, ciGreen: { type: 'boolean' }, checks: { type: 'array' }, ciResiduals: { type: 'array' }, diffGatePass: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['helpRc', 'ciGreen', 'checks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, liveHelpRc: { type: ['number', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'calendar-serve-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
const fix = investigate && investigate.reproHelpRc !== 0 ? await agent(FIX, { label: 'calendar-serve-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' }) : null

phase('Verify')
const verify = fix && fix.pushed ? await agent(VERIFY, { label: 'calendar-serve-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'calendar-serve-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'investigate/fix/verify did not complete or the read already recovered', detail: JSON.stringify({ investigate, fix, verify }) }] }

phase('Land')
const land = review && review.verdict === 'GO'
  ? await agent(LAND, { label: 'calendar-serve-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, liveHelpRc: null, rowState: 'pending', residue: ['NO_GO — fix lane must remediate per findings (two-cycle cap)'] }

return { investigate: investigate && { reproHelpRc: investigate.reproHelpRc, rootCauseSurface: investigate.rootCauseSurface }, fix: fix && { newHead: fix.newHead, prNumber: fix.prNumber }, verify: verify && { helpRc: verify.helpRc, ciGreen: verify.ciGreen, ciResiduals: verify.ciResiduals }, review: review && review.verdict, land }
