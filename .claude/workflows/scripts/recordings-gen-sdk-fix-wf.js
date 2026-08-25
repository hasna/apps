export const meta = {
  name: 'recordings-gen-sdk',
  description: 'Fix lane for row 2d77b2ce (BUG: recordings generate:sdk fails at declared @hasna/contracts 0.13.1 — "Generated SDK query serializer changed; update the array compatibility transform" at scripts/generate-sdk.ts:28 — blocks regenerating the v1.generated.ts version stamp). Lane: IDEMPOTENCY CHECK FIRST -> reproduce -> smallest owned fix in apps/recordings -> generate:sdk rc=0 + suite green -> one Fable review -> base gate + merge -> complete row with evidence.',
  phases: [
    { title: 'Investigate', detail: 'idempotency check; reproduce generate:sdk failure at CURRENT main; name the serializer change and the transform to update' },
    { title: 'Fix', detail: 'smallest owned fix in apps/recordings (generate-sdk.ts array compatibility transform + regenerated v1.generated.ts + changeset)' },
    { title: 'Verify', detail: 'generate:sdk rc=0 fresh, recordings suite green, frozen install rc=0, CI green at head, diff gate (apps/recordings only)' },
    { title: 'Review', detail: 'one Fable adversarial reviewer' },
    { title: 'Land', detail: 'base gate + squash merge + complete row 2d77b2ce with evidence' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '2d77b2ce-2c06-4098-9bbf-3175951cc47f'

const CONST = `
You are the recordings-gen-sdk lane (row ${ROW}; owner-authorized via the task-drain queue). Final text = machine-readable JSON.

Context (filed 2026-08-21): apps/recordings' scripts/generate-sdk.ts:28 fails at the package's DECLARED @hasna/contracts 0.13.1 dependency with 'Generated SDK query serializer changed; update the array compatibility transform'. This blocks regenerating the v1.generated.ts version stamp. The serializer output contract changed in contracts 0.13.1; the array compatibility transform in generate-sdk.ts must be updated to the new shape.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: confirm row ${ROW} is still pending and unowned (no in_progress fixer row, no comments naming a workstream); check for an existing open PR fixing this (gh pr list --repo hasna/apps --search 'generate-sdk in:title,body' + 'recordings' open PRs: 269/424/696 are OTHER lanes — do not confuse or touch them; if a NEW PR specifically fixing this bug exists, verify and record it, do NOT duplicate). Sync the checkout (git -C ${MONOREPO} fetch origin main -q; never discard local work). Reproduce at CURRENT origin/main: run 'bun run generate:sdk' in apps/recordings — literal rc + the exact error. If it already passes at current main, record the evidence and STOP (the lane is complete by recovery).
- ${MONOREPO} is READ/context only. File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/recordings-gen-sdk cut from CURRENT origin/main. NEW BRANCH fix/recordings-gen-sdk. PR-first; never push to main. Commits end with 'Agent: recordings-gen-sdk-<role>' (the ONLY attribution line; never Co-Authored-By). Commit identity MUST be the canonical fleet identity (name 'Andrei Hasna', email andrei@hasna.com).
- FIX AT THE ROOT, NARROWLY: update the array compatibility transform in scripts/generate-sdk.ts to the 0.13.1 serializer shape (read the actual serializer output — do not guess the shape), regenerate v1.generated.ts via the script (so the version stamp updates), add a .changeset/recordings-gen-sdk.md patch changeset. HARD SCOPE GATE: the PR diff MUST be limited to apps/recordings (scripts/generate-sdk.ts, the generated file, the changeset) — any other app's files are a self-inflicted NO_GO. If the fix requires a contracts change, STOP and return the exact evidence as residue — do not widen scope.
- VERIFY: 'bun run generate:sdk' rc=0 at the head (literal output; the regenerated file must be committed); the recordings test suite green (literal counts: 'bun test' in apps/recordings — report passed/failed counts); 'bun install --frozen-lockfile' rc=0 in the worktree; CI per-check table green at the head sha (gh api actions/runs?head_sha=<sha> + per-job conclusions, bounded polling); diff gate (git diff origin/main...HEAD --stat: apps/recordings only); secrets scan clean (redirect + 'secrets scan input', rc 0 clean).
- REVIEW (one Fable adversarial reviewer): (a) the transform matches the 0.13.1 serializer shape (measured, not guessed), (b) generate:sdk rc=0 at the head (literal), (c) recordings suite green, (d) diff gate — apps/recordings only, (e) CI green at the head, (f) mergeability vs CURRENT origin/main (merge-tree clean). Post '[REVIEW] <GO|NO_GO> — recordings-gen-sdk @ <sha> — lens: generated-SDK serializer compat, reviewer recordings-gen-sdk-review' to #board. Block ONLY concrete P0/P1 defects; two remediation cycles max.
- LAND: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: recordings-gen-sdk-land', record the merged sha, complete row ${ROW} with the evidence (merged sha, generate:sdk rc, suite counts, review verdict). If NO_GO: comment findings + resume condition on the PR and the row, leave open, row stays pending.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on the PR and row ${ROW}, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Reproduce 'bun run generate:sdk' at CURRENT origin/main — literal rc + the exact error. Read scripts/generate-sdk.ts around line 28 and the installed @hasna/contracts 0.13.1 serializer output to name the exact shape change. Return (JSON): { mainTip, reproRc, reproOutput, serializerChange, transformToUpdate, scopeFiles: [string], notChecked: [string] }
`

const FIX = CONST + `
ROLE: fix lane (Opus). At the head after investigate: apply the smallest owned fix in apps/recordings (array compatibility transform + regenerated v1.generated.ts + patch changeset); HARD SCOPE GATE (see CONST); canonical commit identity; commit; push; open the PR referencing row ${ROW}. Return (JSON): { newHead, rootCauseFixed, generateSdkRc, diffStatSummary, prNumber, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head: 'bun run generate:sdk' rc=0 (literal); recordings suite green (literal passed/failed counts); frozen install rc=0 in the worktree; CI per-check table at the head (bounded polling); diff gate (apps/recordings only); secrets scan clean. Return (JSON): { generateSdkRc, suiteCounts: {passed, failed}, frozenInstallRc, ciGreen, checks: [{name, conclusion}], diffGatePass, secretsClean, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). One review at the new head: (a) transform matches the 0.13.1 serializer shape (measured), (b) generate:sdk rc=0 (literal), (c) recordings suite green, (d) diff gate — apps/recordings only, (e) CI green at the head, (f) mergeability vs CURRENT origin/main (merge-tree clean), (g) secrets clean. Post '[REVIEW] <GO|NO_GO> — recordings-gen-sdk @ <sha> — lens: generated-SDK serializer compat, reviewer recordings-gen-sdk-review' to #board. Block ONLY concrete P0/P1 defects. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: recordings-gen-sdk-land', record merged sha, complete row ${ROW} with the evidence. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, rowState, residue: [] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { mainTip: { type: 'string' }, reproRc: { type: 'number' }, reproOutput: { type: 'string' }, serializerChange: { type: 'string' }, transformToUpdate: { type: 'string' }, scopeFiles: { type: 'array' }, notChecked: { type: 'array' } }, required: ['mainTip', 'reproRc', 'transformToUpdate'] }
const FIX_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, rootCauseFixed: { type: 'string' }, generateSdkRc: { type: 'number' }, diffStatSummary: { type: 'string' }, prNumber: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'prNumber'] }
const VERIFY_SCHEMA = { type: 'object', properties: { generateSdkRc: { type: 'number' }, suiteCounts: { type: 'object' }, frozenInstallRc: { type: 'number' }, ciGreen: { type: 'boolean' }, checks: { type: 'array' }, diffGatePass: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['generateSdkRc', 'ciGreen', 'checks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'recordings-gen-sdk-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
const fix = investigate && investigate.reproRc !== 0 ? await agent(FIX, { label: 'recordings-gen-sdk-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' }) : null

phase('Verify')
const verify = fix && fix.pushed ? await agent(VERIFY, { label: 'recordings-gen-sdk-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'recordings-gen-sdk-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'investigate/fix/verify did not complete or the defect already recovered', detail: JSON.stringify({ investigate, fix, verify }) }] }

phase('Land')
const land = review && review.verdict === 'GO'
  ? await agent(LAND, { label: 'recordings-gen-sdk-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, rowState: 'pending', residue: ['NO_GO — fix lane must remediate per findings (two-cycle cap)'] }

return { investigate: investigate && { mainTip: investigate.mainTip, reproRc: investigate.reproRc, transformToUpdate: investigate.transformToUpdate }, fix: fix && { newHead: fix.newHead, prNumber: fix.prNumber, diffStatSummary: fix.diffStatSummary }, verify: verify && { generateSdkRc: verify.generateSdkRc, ciGreen: verify.ciGreen, diffGatePass: verify.diffGatePass }, review: review && review.verdict, land }
