export const meta = {
  name: 'apps-small-fixes',
  description: 'Owner directive 2026-08-20 queue drain, batch 2: 4 fix lanes on 4 packages, each on its own worktree — terminal repository.url alignment (b3748c87), identities CHANGELOG 0.5.5 gap (f263e43e), repo hygiene .editorconfig + prepack (f32c886e + e49a6f5a), contracts resolveClientTransport mode inference (a8c08df1). Each lane: IDEMPOTENCY CHECK FIRST -> TDD where applicable -> PR + CI -> Fable review -> merge + complete row',
  phases: [
    { title: 'Fix', detail: '4 parallel lanes, one package each, own worktree' },
    { title: 'Review', detail: 'Fable adversarial review per lane' },
    { title: 'Ship', detail: 'base gate + merge + complete row per lane' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PROJ = '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'

const CONST = `
You are a lane of the apps-small-fixes workflow (owner directive 2026-08-20: drain the apps project queue). Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} fetch origin && git -C ${MONOREPO} pull --ff-only; never discard local work). File mutation happens in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/<lane-name> (repo name then worktree name) cut from origin/main. NEW BRANCH fix/<lane-name>; PR-first; never push to main. Commits end with 'Agent: <lane-name>-<role>' (the ONLY attribution line; never Co-Authored-By).
- IDEMPOTENCY CHECK FIRST: before any fix, search for an existing open PR fixing this (gh pr list --repo hasna/apps --search '<package> in:title,body' + the bug's keywords) and read the row's comments for an existing fixer or duplicate filing. If a live fix exists, verify and record it; do NOT duplicate.
- TDD where applicable (config/doc fixes may not be testable — say so honestly); do NOT weaken tests.
- Verify: package suite green (literal counts) where the change touches code; 'bun install --frozen-lockfile' rc=0 in the worktree; secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push; changeset (patch) added via .changeset/<lane-name>.md for any package change (root-hygiene changes that touch no package version do not need one — say so).
- The version wave PR hasna/apps#670 may be open and rebasing concurrently; if the wave lands while you work, rebase your branch onto the new origin/main and re-verify (base-movement gate at merge: <merge-ref>^{tree} == <head>^{tree} at CURRENT origin/main).
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the PR and the row, posts to #board. English. Distinguish measured vs inferred; state what you did not check.
- The apps project is ${PROJ}; each lane completes its own row.
`

function lane(name, row, pkg, bug, notes) {
  const FIX = CONST + `
ROLE: fix lane for ${name} (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Then make the smallest owned change in ${pkg ? 'apps/' + pkg : 'the repo root'}; reproduce first where a defect is claimed (red, measured); suite green where code changed; frozen install rc=0; secrets scan clean; changeset patch where applicable; commit ('Agent: ${name}-fix'); push; open the PR referencing row ${row}.
BUG: ${bug}
${notes ? 'EXTRA CONTEXT: ' + notes : ''}
Return (JSON): { prNumber, diffSummary, redBefore: {failed, named}, suiteCounts: {passed, failed}, secretsClean, changesetNeeded, evidence }
`
  const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) for lane ${name}. Review PR (number in the fix result): (a) the change is the smallest owned fix for the stated defect, (b) the claimed repro is measured (red-before where testable), (c) no test weakening, (d) scope is ${pkg ? 'apps/' + pkg : 'the repo root'} only, (e) CI green at the head sha, (f) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — ${name} @ <sha> — lens: ${pkg || 'root'} fix, reviewer ${name}-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`
  const SHIP = CONST + `
ROLE: ship lane for ${name}. If GO: base-movement gate first (git merge-tree against CURRENT origin/main; after any rebase <merge-ref>^{tree} == <head>^{tree} must hold), then gh pr merge --squash --body-file ending 'Agent: ${name}-ship', record the merged sha, complete row ${row} with the evidence (merged sha, suite counts, review verdict). If NO_GO: comment findings + resume condition, leave open, row stays pending.
Return (JSON): { merged, mergedSha, rowState, residue: [] }
`
  return { name, row, pkg, bug, FIX, REVIEW, SHIP }
}

const LANES = [
  lane('terminal-repo-url', 'b3748c87', 'terminal',
    `package.json repository.url points to the standalone-era hasna/terminal.git — align to the monorepo location (the hasna/apps repo path) per the monorepo layout convention.`,
    'Doc/metadata alignment only — no code change. Verify the exact standalone-era URL in the file first.'),
  lane('identities-changelog', 'f263e43e', 'identities',
    `@hasna/identities CHANGELOG has no '## 0.5.5' section — PR #57 (v1.1.19 -> v1.1.20 secrets-exec doctrine) is missing its changelog entry. Add the missing section from the merged PR content.`,
    'Changelog documentation fix; content derives from the merged PR #57 diff.'),
  lane('repo-hygiene', 'f32c886e', null,
    `Repo hygiene: add .editorconfig at the repo root AND add prepack build where missing (row e49a6f5a: 'add prepack build + .editorconfig'). Both rows are one change set at the repo root — complete BOTH rows (f32c886e + e49a6f5a) with the same PR.`,
    'Root-level hygiene: .editorconfig (indent/spacing conventions matching the repo style), prepack build script where a member package lacks one (census the member dirs; add only where the package has a build step and no prepack). No version changes.'),
  lane('contracts-transport-mode', 'a8c08df1', 'contracts',
    `ROOT CAUSE: @hasna/contracts resolveClientTransport infers cloud mode from pointer-var PRESENCE — the unset-variable-selects-a-different-store failure class: an unset HASNA_*_API_URL silently selects a different transport. Fix: resolve the transport from explicit configuration (both backend vars must be explicitly set, or a documented default with no silent inference); regression test both directions (explicit config selects the right transport; unset vars do NOT silently flip it).`,
    'The mode-removal doctrine: the only technical switch is the server data backend (sqlite|postgresql); client transport must not infer from pointer-var presence.'),
]

const FIX_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, diffSummary: { type: 'string' }, redBefore: { type: 'object' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, changesetNeeded: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['prNumber', 'diffSummary'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Fix')
const fixes = await parallel(LANES.map(l => () =>
  agent(l.FIX, { label: `${l.name}-fix`, phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' })
    .then(fix => ({ lane: l, fix }))
))

phase('Review')
const reviews = await parallel(fixes.filter(Boolean).map(({ lane: l, fix }) => () =>
  fix && fix.prNumber
    ? agent(l.REVIEW, { label: `${l.name}-review`, phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
        .then(review => ({ lane: l, fix, review }))
    : Promise.resolve({ lane: l, fix, review: { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'fix did not open a PR', detail: JSON.stringify(fix) }] } })
))

phase('Ship')
const ships = await parallel(reviews.filter(Boolean).map(({ lane: l, fix, review }) => () =>
  review && review.verdict === 'GO'
    ? agent(l.SHIP, { label: `${l.name}-ship`, phase: 'Ship', schema: SHIP_SCHEMA })
    : Promise.resolve({ lane: l, fix, review, ship: { merged: false, mergedSha: null, rowState: 'pending', residue: ['NO_GO — fix lane must remediate per findings'] } })
))

const lanes = ships.filter(Boolean).filter(s => s && s.lane).map(s => ({ name: s.lane.name, row: s.lane.row, fix: s.fix && { prNumber: s.fix.prNumber, diffSummary: s.fix.diffSummary }, review: s.review && s.review.verdict, ship: s.ship && { merged: s.ship.merged, mergedSha: s.ship.mergedSha, rowState: s.ship.rowState } }))
return { lanes }
