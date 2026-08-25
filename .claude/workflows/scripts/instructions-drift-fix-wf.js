export const meta = {
  name: 'instructions-drift-fix',
  description: 'Row 0b71efdc: BUG @hasna/instructions — station01 codewith home DRIFT (CODEWITH.md stale 78e7ba92 vs want 3a54347d; 4 rule files missing: 02-r11, 03-codewith-adversarial-review-proportionality, 04-temporary-codewith-suspension, 70-codewith-global-overlay). This lane: diagnose why the render did not cover the home (render spec vs rendered output), repair at the source (instructions pipeline, never hand-edit rendered files), verify drift clean, one Fable review, land, complete the row.',
  phases: [
    { title: 'Investigate', detail: 'diagnose the drift: render spec membership, last render, why 4 rule files + CODEWITH.md went stale' },
    { title: 'Fix', detail: 'smallest owned repair in the instructions pipeline (never hand-edit rendered files)' },
    { title: 'Verify', detail: 'drift clean: CODEWITH.md at want 3a54347d, 4 rule files present, instructions status/scan clean' },
    { title: 'Review', detail: 'one Fable adversarial review' },
    { title: 'Land', detail: 'land per owning-repo gates + complete row 0b71efdc' },
  ],
}

const CONST = `
You are the instructions-drift-fix lane (owner-authorized; row 0b71efdc). Final text = machine-readable JSON.

Context (filed): station01 codewith home DRIFT — CODEWITH.md stale 78e7ba92 vs want 3a54347d; 4 rule files missing: 02-r11 (global-r11-recording-eagerness), 03-codewith-adversarial-review-proportionality, 04-temporary-codewith-suspension, 70-codewith-global-overlay. The rendered home is out of sync with the sources; rendered files carry 'Managed by @hasna/configs session render. Do not edit this generated file directly.' — NEVER hand-edit a rendered file; the repair is at the source (the instructions render spec / pipeline in apps/instructions).

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: confirm row 0b71efdc is still pending and no live fixer exists (open PR on hasna/apps touching apps/instructions, in_progress fixer row, comments naming a workstream); if already fixed or a lane is live, verify + stop. Re-measure the drift first (instructions status / the exact drift probe) — if clean now, record and complete the row.
- /home/hasna/workspace/repos/hasna/apps is READ/context only. Sync first (git -C <checkout> fetch origin main -q; never discard local work). File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/instructions-drift-fix cut from origin/main. PR-first; never push to main. Commits end with 'Agent: instructions-drift-fix-<role>' (the ONLY attribution line; never Co-Authored-By).
- INVESTIGATE: read the render spec for the station01 codewith home (spec id from the instructions store), compare spec membership vs the rendered home, find why CODEWITH.md + the 4 rule files are missing/stale (spec omission, render not run, render-spec drift). Paste literal evidence; state what you did not check.
- FIX at the source: update the render spec / the pipeline in apps/instructions so the codewith home receives the global corpus incl. the 4 missing files, re-run the managed render for that home, verify the rendered output. Never hand-edit a rendered file.
- VERIFY: the exact drift probe is clean (CODEWITH.md at want 3a54347d or newer; the 4 rule files present in the home; instructions status/scan reports no drift; a fresh render produced the files), and the rendered files carry the managed marker.
- REVIEW (one Fable adversarial reviewer): (a) root cause named with evidence, (b) repair at the source — no hand-edited rendered files, (c) drift probe clean measured at the end (literal output), (d) no secret exposure, (e) mergeability vs CURRENT origin/main. Post '[REVIEW] <GO|NO_GO> — instructions-drift-fix @ <sha> — lens: codewith home render-drift remediation, reviewer instructions-drift-fix-review' to #board.
- LAND: on GO, base-movement gate (merge-tree vs CURRENT origin/main), gh pr merge --squash --body-file ending 'Agent: instructions-drift-fix-land', record merged sha, complete row 0b71efdc with evidence. If the fix is a re-render with no repo change, the land is the verified render + row completion.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on row 0b71efdc and #board. English. Distinguish measured vs inferred; state what you did not check.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Diagnose the drift: read the render spec for the station01 codewith home, compare spec membership vs the rendered home, determine why CODEWITH.md + the 4 rule files are missing/stale. Return (JSON): { driftRcNow, rootCause, renderSpecId, missingFiles: [string], notChecked: [string] }
`

const FIX = CONST + `
ROLE: fix lane (Opus). At the head after investigate: apply the smallest owned fix in the instructions pipeline/render spec so the codewith home receives the full corpus incl. the 4 missing files, re-run the managed render for that home, verify the rendered output. Never hand-edit a rendered file. If the fix is a spec/pipeline change, commit + push + open the PR. Return (JSON): { fixSummary, rootCause, landedAs: 'pr'|'render', prNumber, renderVerified, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). After fix: re-measure the exact drift probe (CODEWITH.md content at want or newer; the 4 rule files present with the managed marker; instructions status/scan clean — paste literal output). If a PR: CI per-check table at the head. Return (JSON): { driftClean, codeWithMdMatches, missingFilesNow: [], scanClean, ciGreen, checks: [{name, conclusion}], evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). One review: (a) root cause named with evidence, (b) repair at the source — no hand-edited rendered files, (c) drift probe clean MEASURED (literal output: CODEWITH.md at want, 4 files present, scan clean), (d) no secret exposure, (e) mergeability vs CURRENT origin/main (merge-tree), (f) row evidence complete. Post '[REVIEW] <GO|NO_GO> — instructions-drift-fix @ <sha> — lens: codewith home render-drift remediation, reviewer instructions-drift-fix-review' to #board. Block ONLY concrete P0/P1 defects. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: base-movement gate, merge the PR with --body-file ending 'Agent: instructions-drift-fix-land' (or record the verified render), record merged sha, complete row 0b71efdc with evidence. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { landed, mergedSha, rowState, residue: [] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { driftRcNow: { type: 'number' }, rootCause: { type: 'string' }, renderSpecId: { type: 'string' }, missingFiles: { type: 'array' }, notChecked: { type: 'array' } }, required: ['driftRcNow', 'rootCause'] }
const FIX_SCHEMA = { type: 'object', properties: { fixSummary: { type: 'string' }, rootCause: { type: 'string' }, landedAs: { type: 'string' }, prNumber: { type: ['number', 'null'] }, renderVerified: { type: 'boolean' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['fixSummary', 'landedAs'] }
const VERIFY_SCHEMA = { type: 'object', properties: { driftClean: { type: 'boolean' }, codeWithMdMatches: { type: 'boolean' }, missingFilesNow: { type: 'array' }, scanClean: { type: 'boolean' }, ciGreen: { type: 'boolean' }, checks: { type: 'array' }, evidence: { type: 'string' } }, required: ['driftClean'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { landed: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['landed'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'instructions-drift-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
const fix = investigate && investigate.driftRcNow !== 0 ? await agent(FIX, { label: 'instructions-drift-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' }) : null

phase('Verify')
const verify = fix && (fix.pushed || fix.renderVerified) ? await agent(VERIFY, { label: 'instructions-drift-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'instructions-drift-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'investigate/fix/verify did not complete or drift already clean', detail: JSON.stringify({ investigate, fix, verify }) }] }

phase('Land')
const land = review && review.verdict === 'GO'
  ? await agent(LAND, { label: 'instructions-drift-land', phase: 'Land', schema: LAND_SCHEMA })
  : { landed: false, mergedSha: null, rowState: 'pending', residue: ['NO_GO — fix lane must remediate per findings'] }

return { investigate: investigate && { rootCause: investigate.rootCause, driftRcNow: investigate.driftRcNow }, fix: fix && { fixSummary: fix.fixSummary, landedAs: fix.landedAs }, verify: verify && { driftClean: verify.driftClean, ciGreen: verify.ciGreen }, review: review && review.verdict, land }
