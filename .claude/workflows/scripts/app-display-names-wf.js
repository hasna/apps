export const meta = {
  name: 'app-display-names',
  description: "Owner 2026-08-19 (task 75986409): sweep every hasna/apps member for the display title Hasna<Name> (no space, e.g. HasnaNotes) instead of 'Hasna <Name>'; fix per affected app, PR-first, Fable review, merge. Extends the NAMING convention (6d824d44)",
  phases: [
    { title: 'Census', detail: 'find every HasnaName-form title across apps/* (Info.plist CFBundleDisplayName, productName, manifest metadata, UI title strings, package display names)' },
    { title: 'Fix', detail: 'per-app PR: title -> Hasna <Name>, smallest owned change' },
    { title: 'Review', detail: 'Fable adversarial review' },
    { title: 'Report', detail: 'per-app PRs + merge' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const TASK = '75986409-62ac-4bcd-b3cf-e2d2767c41a9'

const CONST = `
You are a lane of the app-display-names workflow (2026-08-19, task ${TASK}). Owner: the app title must be 'Hasna Notes' (with the space), never 'HasnaNotes' — 'same applies for all the other apps, we need a workflow to check and land prs for all the ones that have HasnaName instead of Hasna Name'. The convention: display names are 'Hasna <Name>' (NAMING row 6d824d44). Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in task worktrees ~/.hasna/repos/worktrees/apps/display-name-<n> from origin/main. PR-first; never push to main. Commits end with 'Agent: display-name-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check for open PRs already fixing display names; check the NAMING row (6d824d44) for recorded per-app states; do not duplicate.
- CENSUS: search for the no-space form across apps/* — grep for 'Hasna[A-Z]' (camelCase concatenations) in Info.plist CFBundleDisplayName/CFBundleName, productName/build settings, hasna.contract.json metadata/display fields, package.json name is NOT in scope (npm names stay kebab), UI title strings and macOS app naming. Report every hit with file:line and the current string. Cap: the FULL census — every app in apps/* (pass 1 of 2026-08-19 scanned only the 40 most recent by mtime and recorded the bound; pass 2 covers all remaining apps; note the per-pass coverage in the result).
- FIX: per affected app, one PR (or grouped PR for a monorepo-wide shared string if one source serves many apps): change ONLY the display-title surface to 'Hasna <Name>' (the correct spaced form). No behavior changes, no version bumps, no unrelated edits. If an app's title is correct, record 'correct' — do not touch.
- Verify: 'bun run check' passes (or failures recorded with owners); secrets scan of each diff clean; the changed string read back exactly.
- No secrets: never print/capture/commit credential values; staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on ${TASK}, posts to #board. English. Lineage 'conversations agents register' named display-name-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const CENSUS = CONST + `
ROLE: census lane. Per the CONST: enumerate every no-space 'Hasna<Name>' occurrence across apps/* with file:line and current string, plus a per-app title-state list (correct / needs-fix / not-applicable). Record the bound.
Return (JSON): { hits: [{app, file, line, current}], appStates: [{app, state, title}], bound: number }
`

const FIX = CONST + `
ROLE: fix lanes. Per the CONST + the census ({CENSUS}): one PR per affected app (or one grouped PR if a shared source serves many), title -> 'Hasna <Name>'. Run the affected app's checks, secrets scan, commit ('Agent: display-name-<your-role>'), push, open the PR referencing ${TASK}.
Return (JSON): { prs: [{app, prNumber, changed: [{file, from, to}]}] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review each PR ({PRS}): the change is display-title ONLY (no behavior/version/unrelated edits), the new title is exactly 'Hasna <Name>' with the space, checks pass or failures recorded, secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — display-name <app> @ <sha> — lens: naming convention, reviewer display-name-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { prs: [{number, verdict, findings: [{severity, title, detail}]}] }
`

const REPORT = CONST + `
ROLE: report. Merge every GO PR (base-movement gate; squash with 'Agent: display-name-ship' trailer). Comment ${TASK} (per-app PRs + merged shas), post the summary to #board. NO_GO: comment findings + resume condition.
Return (JSON): { prs: [{app, prNumber, merged, mergedSha}], taskState: string, residue: [string] }
`

const CENSUS_SCHEMA = { type: 'object', properties: { hits: { type: 'array' }, appStates: { type: 'array' }, bound: { type: 'number' } }, required: ['hits', 'appStates'] }
const FIX_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REVIEW_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REPORT_SCHEMA = { type: 'object', properties: { prs: { type: 'array' }, taskState: { type: 'string' }, residue: { type: 'array' } }, required: ['taskState'] }

phase('Census')
const census = await agent(CENSUS, { label: 'display-name-census', phase: 'Census', schema: CENSUS_SCHEMA })
log(`census: ${census && census.hits ? census.hits.length + ' no-space hits across ' + (census.appStates || []).length + ' apps' : 'FAILED'}`)

phase('Fix')
let fix = null
if (census && census.hits && census.hits.length) {
  fix = await agent(FIX.replace('{CENSUS}', JSON.stringify(census)), { label: 'display-name-fix', phase: 'Fix', schema: FIX_SCHEMA })
} else {
  fix = { prs: [] }
}

phase('Review')
let review = null
if (fix && fix.prs && fix.prs.length) {
  review = await agent(REVIEW.replace('{PRS}', JSON.stringify(fix.prs)), { label: 'display-name-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { prs: [] }
}

phase('Report')
const report = await agent(REPORT, { label: 'display-name-report', phase: 'Report', schema: REPORT_SCHEMA })

return { census, fix, review, report }
