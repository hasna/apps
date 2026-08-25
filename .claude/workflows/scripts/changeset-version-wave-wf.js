export const meta = {
  name: 'changeset-version-wave',
  description: 'Apply the pending .changeset version wave on hasna/apps (34 pending incl. loops-96c837b0-execution-staleness): bunx changeset version in a worktree, verify, PR-first, Fable review — publish-all lane (the ONLY publisher) then ships every bumped app',
  phases: [
    { title: 'Apply', detail: 'worktree from origin/main, bunx changeset version, capture the bump set' },
    { title: 'Verify', detail: 'bun run check + per-bumped-app package.json/CHANGELOG sanity + secrets scan' },
    { title: 'Review', detail: 'Fable adversarial review of the version PR' },
    { title: 'Report', detail: 'PR + bump set on the task, #board; publish-all picks the queue up' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const TASK = '248f6ed8-d849-48ce-912c-1e7c5d8e69f0'

const CONST = `
You are a lane of the changeset-version-wave workflow (2026-08-19). The hasna/apps monorepo holds ~34 pending .changeset files (incl. loops-96c837b0-execution-staleness — the @hasna/loops scheduler fix that merged today, af55d546, still UNPUBLISHED: registry 0.5.1, repo 0.5.1). The versioning wave is the release lane's declared next step (publish-all follow-up O15-00122); this workflow applies it. The PUBLISH step belongs ONLY to the publish-all workflow — this lane NEVER runs npm publish. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/version-wave-<n> from origin/main. PR-first; never push to main. Commits end with 'Agent: version-wave-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: before applying anything, check whether a version wave is ALREADY in flight (an open PR touching multiple package.json versions / .changeset removal, or a recent version commit on main). If one exists, verify and record — do not duplicate. Also re-count the pending changesets at lane start (the count moves as other lanes merge).
- Apply 'bunx changeset version' in the worktree. Capture the bump set: app -> old version -> new version. If any changeset is malformed or the command errors, record the exact error and STOP that subset (do not hand-edit changesets to force it).
- Verify: 'bun run check' in the monorepo passes (or record the exact failures with the owning app), each bumped app's package.json + CHANGELOG.md look sane (version match, changelog entry), secrets scan of the diff clean. No internal-infra strings in the diff.
- The version PR is purely mechanical (versions + changelogs): title 'release: apply changeset version wave (N apps)'. Do NOT include unrelated changes.
- No secrets: never print/capture/commit credential values; staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on ${TASK}, posts to #board. English. Lineage 'conversations agents register' named version-wave-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const APPLY = CONST + `
ROLE: apply lane. Per the CONST: sync, worktree, re-count pending changesets (exact list + count), run 'bunx changeset version' (bounded 10 min), capture the FULL bump set (app, old, new). If the command fails, capture the literal error and return it with bumpsApplied=0.
Return (JSON): { pendingCount: number, changesetFiles: [string], bumpsApplied: number, bumps: [{app, oldVersion, newVersion}], commandError: string|null, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: 'bun run check' in the monorepo (bounded 15 min; record pass/fail + exact failures with owning app), per-bumped-app sanity (package.json version == changeset result; CHANGELOG entry present; no internal-infra strings), secrets scan of the diff clean. Confirm the version PR's diff is versions+changelogs ONLY (no unrelated edits).
Return (JSON): { checkPassed: bool, checkFailures: [{app, error}], bumpsSane: bool, diffScoped: bool, secretsClean: bool, acceptanceMet: bool, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review: (a) the bump set matches the pending changesets (no invented bumps, no missed ones), (b) version numbers follow the package's pre-1.0 convention (0.x.0 = breaking — changelog says so), (c) 'bun run check' passed or failures are recorded with owners, (d) the diff is versions+changelogs ONLY, (e) PR-first, no direct pushes, no secrets. Post '[REVIEW] <GO|NO_GO> — changeset-version-wave @ <evidence> — lens: release wave, reviewer version-wave-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const REPORT = CONST + `
ROLE: report. If GO + acceptanceMet: comment ${TASK} (bump set, PR number, verify evidence), post to #board naming the wave size and that publish-all will ship the bumped apps on its next pass. If NO_GO or acceptance not met: comment findings + resume condition, post residue to #board.
Return (JSON): { prNumber: number|null, bumps: [string], taskState: string, residue: [string] }
`

const APPLY_SCHEMA = { type: 'object', properties: { pendingCount: { type: 'number' }, changesetFiles: { type: 'array' }, bumpsApplied: { type: 'number' }, bumps: { type: 'array' }, commandError: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['bumpsApplied', 'bumps'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checkPassed: { type: 'boolean' }, checkFailures: { type: 'array' }, bumpsSane: { type: 'boolean' }, diffScoped: { type: 'boolean' }, secretsClean: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const REPORT_SCHEMA = { type: 'object', properties: { prNumber: { type: ['number', 'null'] }, bumps: { type: 'array' }, taskState: { type: 'string' }, residue: { type: 'array' } }, required: ['taskState'] }

phase('Apply')
const apply = await agent(APPLY, { label: 'version-wave-apply', phase: 'Apply', schema: APPLY_SCHEMA, model: 'opus' })
log(`apply: ${apply && apply.bumpsApplied !== undefined ? apply.bumpsApplied + ' bumps of ' + (apply.pendingCount || '?') + ' pending' : 'FAILED'}`)

phase('Verify')
let verify = null
if (apply && apply.bumpsApplied > 0 && !apply.commandError) {
  verify = await agent(VERIFY, { label: 'version-wave-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'apply did not complete: ' + (apply && apply.commandError || 'no bumps'), evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW, { label: 'version-wave-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P0', title: 'apply/verify did not complete', detail: JSON.stringify({ apply, verify }) }] }
}

phase('Report')
const report = await agent(REPORT, { label: 'version-wave-report', phase: 'Report', schema: REPORT_SCHEMA })

return { apply, verify, review, report }
