export const meta = {
  name: 'attachments-help-bind',
  description: 'Row 970d7c6f: BUG @hasna/attachments — attachments-serve --help binds the DB pool before answering (exits 1, createCloud failure before help prints). Same class as the access-help-bind fix (row 2920eed6, PR 712). This lane: reproduce (TDD red), fix the startup order (help answers before pool/bind), verify suite + CI, one Fable review, PR, merge, complete the row.',
  phases: [
    { title: 'Investigate', detail: 'reproduce, name the root cause, TDD red' },
    { title: 'Fix', detail: 'smallest owned fix (help answers before pool creation/bind), suite green, push' },
    { title: 'Verify', detail: 'CI green at the new head + two-sided probe' },
    { title: 'Review', detail: 'one Fable adversarial review' },
    { title: 'Land', detail: 'base gate + merge + complete 970d7c6f' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PROJ = '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'

const CONST = `
You are the attachments-help-bind-fix lane (owner-authorized; row 970d7c6f). Final text = machine-readable JSON.

Context (filed 2026-08-21 from the publish-all fresh lane): BUG @hasna/attachments — 'attachments-serve --help' exits 1 before printing help: '[attachments-serve] fatal: createCloud...' — the serve verb creates the DB pool before handling --help/--version (startup order defect). Repro on record: installed @hasna/attachments@1.1.6, station01. Same defect class as row 2920eed6 (@hasna/access, fixed in PR 712) — the fixes in apps/access and apps/attachments are separate owned changes; do not reuse the access PR.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: confirm row 970d7c6f is still pending and no live fixer exists (open PR on hasna/apps touching apps/attachments with this class, in_progress fixer row); if already fixed or a lane is live, verify + stop. Reproduce first: 'attachments-serve --help' (or the installed bin form) — paste literal output.
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} fetch origin main -q; never discard local work). File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/attachments-help-bind cut from origin/main. PR-first; never push to main. Commits end with 'Agent: attachments-help-bind-fix-<role>' (the ONLY attribution line; never Co-Authored-By). Commit identity MUST be the canonical fleet identity (name 'Andrei Hasna', email andrei@hasna.com).
- REPRODUCE first (TDD): write the failing regression test capturing that --help answers without creating the DB pool (e.g. help exits 0 while no pool/connect is attempted; the reverse: without --help the server still creates the pool and binds). Confirm red with literal output.
- FIX the smallest owned change in apps/attachments serve: --help/--version answer before any pool creation or bind/listen. Do not change help text content; do not weaken the real serve path.
- VERIFY: two-sided probes at the head (--help answers rc=0 without pool creation; plain serve still binds), attachments suite green (literal counts, exit 0), CI per-check table at the new head (green or exactly the named other-lane residual class), 'bun install --frozen-lockfile' rc=0, secrets scan clean.
- REVIEW (one Fable adversarial reviewer): (a) red-before/green-after measured, (b) --help does not create the pool (positive probe), plain serve still binds (negative probe), (c) smallest owned change, (d) suite + CI green or the exact named residual, (e) mergeability vs CURRENT origin/main. Post '[REVIEW] <GO|NO_GO> — attachments-help-bind @ <sha> — lens: serve help-before-bind remediation, reviewer attachments-help-bind-review' to #board.
- LAND: on GO, base-movement gate (merge-tree vs CURRENT origin/main), gh pr merge --squash --body-file ending 'Agent: attachments-help-bind-fix-land', record merged sha, complete row 970d7c6f with evidence. The package publishes via publish-all's next census (the ONLY publisher) — this lane never calls npm publish.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on the PR and row 970d7c6f, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is ${PROJ}.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Reproduce the bind-before-help defect (literal output), locate the serve startup path in apps/attachments, write the failing two-sided regression test, confirm red. Return (JSON): { bindsBeforeHelp, serveStartupPath, redBefore: {helpAnswers, helpBinds}, testPath, notChecked: [string] }
`

const FIX = CONST + `
ROLE: fix lane (Opus). At the head after investigate: apply the smallest owned fix (help/version answer before pool creation/bind), suite green (literal counts, exit 0), both probes pass (--help rc=0 without pool creation; plain serve binds), frozen install rc=0, secrets scan clean, commit, push, open the PR. Return (JSON): { newHead, fixSummary, rootCause, probes: {helpNoBind, serveBinds}, suiteCounts: {passed, failed}, prNumber, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head: CI per-check table (green or exactly the named other-lane residual class); attachments suite green (literal counts, exit 0); two-sided probes re-run at the head; frozen install rc=0; secrets scan clean. Return (JSON): { ciGreen, checks: [{name, conclusion}], suiteCounts: {passed, failed}, probesPass, installRc, secretsClean, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). One review at the new head: (a) red-before/green-after measured (not skipped), (b) --help answers without pool creation (positive probe), plain serve still binds (negative probe), (c) smallest owned change, (d) suite + CI green or the exact named residual, (e) mergeability vs CURRENT origin/main, (f) secrets clean. Post '[REVIEW] <GO|NO_GO> — attachments-help-bind @ <sha> — lens: serve help-before-bind remediation, reviewer attachments-help-bind-review' to #board. Block ONLY concrete P0/P1 defects. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: base-movement gate, gh pr merge --squash --body-file ending 'Agent: attachments-help-bind-fix-land', record merged sha, complete row 970d7c6f with evidence. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, rowState, residue: [] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { bindsBeforeHelp: { type: 'boolean' }, serveStartupPath: { type: 'string' }, redBefore: { type: 'object' }, testPath: { type: 'string' }, notChecked: { type: 'array' } }, required: ['bindsBeforeHelp', 'redBefore'] }
const FIX_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, fixSummary: { type: 'string' }, rootCause: { type: 'string' }, probes: { type: 'object' }, suiteCounts: { type: 'object' }, prNumber: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'prNumber'] }
const VERIFY_SCHEMA = { type: 'object', properties: { ciGreen: { type: 'boolean' }, checks: { type: 'array' }, suiteCounts: { type: 'object' }, probesPass: { type: 'boolean' }, installRc: { type: 'number' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['ciGreen', 'checks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'attachments-help-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
const fix = investigate && investigate.bindsBeforeHelp ? await agent(FIX, { label: 'attachments-help-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' }) : null

phase('Verify')
const verify = fix && fix.pushed ? await agent(VERIFY, { label: 'attachments-help-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'attachments-help-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'investigate/fix/verify did not complete or defect not reproduced', detail: JSON.stringify({ investigate, fix, verify }) }] }

phase('Land')
const land = review && review.verdict === 'GO'
  ? await agent(LAND, { label: 'attachments-help-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, rowState: 'pending', residue: ['NO_GO — fix lane must remediate per findings'] }

return { investigate: investigate && { bindsBeforeHelp: investigate.bindsBeforeHelp, redBefore: investigate.redBefore }, fix: fix && { newHead: fix.newHead, prNumber: fix.prNumber, probes: fix.probes }, verify: verify && { ciGreen: verify.ciGreen, probesPass: verify.probesPass }, review: review && review.verdict, land }
