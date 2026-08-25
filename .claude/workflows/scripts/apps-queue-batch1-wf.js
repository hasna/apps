export const meta = {
  name: 'apps-queue-batch1',
  description: 'Owner directive 2026-08-20: drain the apps project queue at up to 8 concurrent lanes — 6 fix lanes on 6 packages, each on its own worktree (conversations send positional form, secrets xai detector, repos exact lookup, recordings prepublish, loops CLAUDE_CONFIG_DIR, identities post-publish settle). Each lane: IDEMPOTENCY CHECK FIRST -> TDD fix -> PR + CI -> Fable review -> merge + complete row',
  phases: [
    { title: 'Fix', detail: '6 parallel lanes, one package each, own worktree' },
    { title: 'Review', detail: 'Fable adversarial review per lane' },
    { title: 'Ship', detail: 'base gate + merge + complete row per lane' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PROJ = '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'

const CONST = `
You are a lane of the apps-queue-batch1 workflow (owner directive 2026-08-20: drain the apps project queue at up to 8 concurrent lanes). Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} fetch origin && git -C ${MONOREPO} pull --ff-only; never discard local work; if the shared checkout is dirty, work from a fresh worktree anyway). File mutation happens in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/<lane-name> (repo name then worktree name) cut from origin/main. NEW BRANCH fix/<lane-name>; PR-first; never push to main. Commits end with 'Agent: <lane-name>-<role>' (the ONLY attribution line; never Co-Authored-By).
- IDEMPOTENCY CHECK FIRST: before any fix, search for an existing open PR fixing this bug (gh pr list --repo hasna/apps --search '<package> in:title,body' + the bug's keywords), and read the row's comments (todos show <row> + todos comment history) for an existing fixer or duplicate filing. If a live fix exists, verify and record it; do NOT duplicate. Also note: the project may carry a duplicate row for the same bug with a different id — check and record it in the PR body if found.
- TDD: failing regression test first (red, measured), smallest owned fix (green). Do NOT weaken tests.
- Verify: package suite green (literal counts), 'bun install --frozen-lockfile' rc=0 in the worktree, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push, changeset (patch — bug fix) added via .changeset/<lane-name>.md.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the PR and the row, posts to #board. English. Distinguish measured vs inferred; state what you did not check.
- The apps project is ${PROJ}; the row is tracked there.
`

function lane(name, row, pkg, bug, notes) {
  const FIX = CONST + `
ROLE: fix lane for ${name} (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Then REPRODUCE the bug and name the code path; write the failing regression test first (red); implement the smallest owned fix in apps/${pkg}; suite green (literal counts); frozen install rc=0; secrets scan clean; changeset patch; commit ('Agent: ${name}-fix'); push; open the PR referencing row ${row}.
BUG: ${bug}
${notes ? 'EXTRA CONTEXT: ' + notes : ''}
Return (JSON): { prNumber, diffSummary, redBefore: {failed, named}, suiteCounts: {passed, failed}, secretsClean, evidence }
`
  const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) for lane ${name}. Review PR (number in the fix result): (a) the regression test reproduces the bug and the fix passes it (red-before/green-after measured), (b) the fix is the smallest owned change, (c) no test weakening, (d) scope is apps/${pkg} only, (e) CI green at the head sha, (f) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — ${name} @ <sha> — lens: ${pkg} bug fix, reviewer ${name}-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`
  const SHIP = CONST + `
ROLE: ship lane for ${name}. If GO: base-movement gate first (git merge-tree against CURRENT origin/main; after any rebase <merge-ref>^{tree} == <head>^{tree} must hold — a GO at a prior head does not cover a rebased head), then gh pr merge --squash --body-file ending 'Agent: ${name}-ship', record the merged sha, complete row ${row} with the evidence (merged sha, suite counts, review verdict). If NO_GO: comment findings + resume condition, leave open, row stays pending.
Return (JSON): { merged, mergedSha, rowState, residue: [] }
`
  return { name, row, pkg, bug, FIX, REVIEW, SHIP }
}

const LANES = [
  lane('conversations-send-positional', '4a2a4ac1-c45f-4252-b4f0-5b209f09803f', 'conversations',
    `'conversations send <channel> --from X' positional form exits rc=1 'Recipient is required: use --to <agent> or --channel <name>' — the CLI only accepts --channel/--to, while the charter, .claude/rules and several dispatch briefs teach the positional form, so every driver following our own docs fails its record step. Fix direction: make the positional first argument resolve as the channel (compat with the documented form) OR fix the docs if the CLI form is intentional — smallest owned fix, Fix Once, decide with evidence.`,
    'Measured again 2026-08-20 while posting a fleet heartbeat: positional channel form rc=1 with that exact message; --channel form works.'),
  lane('secrets-xai-detector', 'a869386e-3ef4-4bb1-ad13-397aa0c2a956', 'secrets',
    `The xai_api_key detector matches on the bare 'xai-' prefix, so ordinary model IDs like "id": "xai-grok-reasoning" trip the staged scan at rc=1 and block commits on files that contain no credential. Fix: the detector must require a value-shaped match (high-entropy suffix), not a bare prefix. Regression test both ways: a model id must pass, a real xai key must still trip.`,
    'This is the root cause of the false positive that produced scrub row 0a464091 (xai_api_key value mis-scanned in a task body).'),
  lane('repos-exact-lookup', 'd8ed2fc2-4e40-4457-8290-55fbeca920a1', 'repos',
    `'repos repo --remote <owner>/<name>' exact owner/name lookup is rejected (rc=1) — the exact-target form the worktree law mandates fails while fuzzy forms resolve to the stale mirror. Fix the exact lookup path; regression test the exact form returns the canonical checkout.`,
    'Related precedent: bare-name lookups resolve to the _factory_src mirror (bug c357a1f3); the exact --remote form must refuse rather than guess, but currently refuses even when the target exists.'),
  lane('recordings-prepublish', '7f97afef-0e22-40c4-b755-abef5153a542', 'recordings',
    `prepublishOnly runs a suite that cannot pass off-CI, so npm publish is blocked on this box. Fix: the prepublish gate must pass in a normal local environment (or be scoped to the CI-only part with a documented, non-silent skip); regression test the prepublish path succeeds locally.`,
    ''),
  lane('loops-config-dir', 'e84f3956-1083-4b4a-bb73-59f901b054b7', 'loops',
    `BUG: @hasna/loops — the runner does not propagate CLAUDE_CONFIG_DIR, so headless claude command targets run as the WRONG ACCOUNT (the unset-variable silently selects a different profile/account class). Fix: the runner must propagate CLAUDE_CONFIG_DIR (and any sibling config-selecting vars) to the spawned claude process; regression test asserts the child environment carries it.`,
    'Same family as the unset-variable-selects-a-different-backing-store incidents (claude resolved to an exhausted account).'),
  lane('identities-publish-settle', '6e098191-2078-4a87-a12f-bbd2759acbea', 'identities',
    `BUG: @hasna/identities — post-publish verification needs registry settle/retry: immediately after publish the registry read can still show the OLD version (eventual consistency), so release:oss:verify fails and the lane marks the release failed incorrectly. Fix: bounded settle/retry (e.g. poll npm view with a bounded window and clear failure after the bound, never an unbounded loop); regression test with a fake registry clock.`,
    'Related: the gitHead gate fix (row 949b6ed5) shipped; this is the settle half.'),
]

const FIX_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, diffSummary: { type: 'string' }, redBefore: { type: 'object' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['prNumber', 'diffSummary'] }
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
