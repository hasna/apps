export const meta = {
  name: 'version-wave-lockfix',
  description: 'Fix PR hasna/apps#595 (version wave, 36 apps): regenerate bun.lock for the 7 dependency-range bumps (docs/draw/models/servers/treasury @hasna/contracts->0.11.2; mcps/orgs @hasna/events->0.1.16) + resolve the events types/*.d.ts deletion — mechanical, push to the wave branch, verify CI, Fable review; unblocks loops 0.5.2 (the 96c837b0 fix) reaching the registry',
  phases: [
    { title: 'Fix', detail: 'regenerate bun.lock on branch version-wave-1, fix events types if real, commit+push' },
    { title: 'Verify', detail: 'bun install --frozen-lockfile passes; CI re-run on the PR reaches check lanes' },
    { title: 'Review', detail: 'Fable review of the delta' },
    { title: 'Report', detail: 'PR #595 state + #board' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PR = 595

const CONST = `
You are a lane of the version-wave-lockfix workflow (2026-08-19). PR hasna/apps#${PR} ('release: apply changeset version wave (36 apps)', branch version-wave-1, head c228796898) is the in-flight version wave (one-shot; the recurring ship-latest workflow defers to it). It FAILS CI at install: 'bun install --frozen-lockfile' errors 'lockfile had changes, but lockfile is frozen' — the wave bumped 7 dependency ranges without committing bun.lock (apps/docs, apps/draw, apps/models, apps/servers, apps/treasury @hasna/contracts 0.11.1->0.11.2; apps/mcps, apps/orgs @hasna/events->0.1.16). A second verify finding: apps/events has 15 tracked types/*.d.ts files deleted with no replacement — determine whether the wave caused it (check whether the deletion is in PR ${PR}'s diff) and repair only if the wave caused it. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/version-wave-lockfix-<n>; work on the PR's OWN branch (checkout the PR head branch name from the fetched pull ref — never guess; force-push with --force-with-lease ONLY on that branch).
- IDEMPOTENCY CHECK FIRST: check PR ${PR} comments for an existing lockfix attempt; check whether the branch head already moved past c228796898. If someone already fixed it, verify and record — do not duplicate.
- The fix is MECHANICAL: regenerate bun.lock (bun install in the monorepo root with the wave's package.json state, commit ONLY the lockfile + any events types repair). No version changes, no code changes beyond the events repair if genuinely wave-caused. Never weaken CI.
- Verify: 'bun install --frozen-lockfile' passes at the new head; the PR's CI re-run gets past Install (trigger a re-run of the failed checks via 'gh pr checks' + 'gh run rerun' on the failed runs, or push the fix which retriggers). Record the CI state with literal output.
- No secrets: never print/capture/commit credential values; staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on PR ${PR}, posts to #board. English. Lineage 'conversations agents register' named lockfix-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const FIX = CONST + `
ROLE: fix lane. Per the CONST: worktree, checkout the PR branch (version-wave-1), regenerate bun.lock ('bun install' in the monorepo root — it must produce the lockfile matching the wave's package.json), check the events types deletion: is it in PR ${PR}'s diff (git diff origin/main...HEAD -- apps/events/types)? If wave-caused, repair (regenerate types or restore); if NOT wave-caused (pre-existing on main), record that and do not touch it. Commit ('Agent: lockfix-<your-role>'), push --force-with-lease to the PR branch.
Return (JSON): { lockfileCommitted: bool, eventsDeletionWaveCaused: bool, eventsRepaired: bool, newHead: string, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: 'bun install --frozen-lockfile' at the new head (bounded 8 min, rc + literal output), then drive the PR's CI: 'gh pr checks ${PR}' — for failed check runs whose failure was the frozen-lockfile install, re-run ('gh run rerun <id>'); wait bounded (max 15 min) for the re-run; require Install to pass and at least the check lanes to reach their own verdicts. Record the exact per-check state.
Return (JSON): { frozenInstallPasses: bool, rerunTriggered: bool, checks: [{name, status, conclusion}], acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review: (a) the delta is lockfile + (if wave-caused) the events repair ONLY — no version changes, no unrelated edits, (b) frozen-lockfile install passes at the new head, (c) the events deletion was classified with evidence (wave-caused or pre-existing), (d) PR-first on the PR's own branch, no direct pushes to main, (e) secrets clean. Post '[REVIEW] <GO|NO_GO> — version-wave-lockfix @ <new head> — lens: wave unblock, reviewer lockfix-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const REPORT = CONST + `
ROLE: report. If GO + acceptanceMet: comment PR ${PR} (fix summary, new head, CI state), post one line to #board — the wave is merge-ready; the ship-latest workflow's next firing (or the drain) merges it, then publish-all ships the 36 bumps incl. @hasna/loops 0.5.2. If NO_GO or acceptance not met: comment findings + resume condition, post residue to #board.
Return (JSON): { prState: string, newHead: string, residue: [string] }
`

const FIX_SCHEMA = { type: 'object', properties: { lockfileCommitted: { type: 'boolean' }, eventsDeletionWaveCaused: { type: 'boolean' }, eventsRepaired: { type: 'boolean' }, newHead: { type: 'string' }, evidence: { type: 'string' } }, required: ['lockfileCommitted', 'newHead'] }
const VERIFY_SCHEMA = { type: 'object', properties: { frozenInstallPasses: { type: 'boolean' }, rerunTriggered: { type: 'boolean' }, checks: { type: 'array' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const REPORT_SCHEMA = { type: 'object', properties: { prState: { type: 'string' }, newHead: { type: 'string' }, residue: { type: 'array' } }, required: ['prState'] }

phase('Fix')
const fix = await agent(FIX, { label: 'lockfix-fix', phase: 'Fix', schema: FIX_SCHEMA })

phase('Verify')
let verify = null
if (fix && fix.lockfileCommitted) {
  verify = await agent(VERIFY, { label: 'lockfix-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'fix did not complete: ' + (fix && fix.evidence || 'no lockfile commit'), evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW, { label: 'lockfix-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P0', title: 'fix/verify did not complete', detail: JSON.stringify({ fix, verify }) }] }
}

phase('Report')
const report = await agent(REPORT, { label: 'lockfix-report', phase: 'Report', schema: REPORT_SCHEMA })

return { fix, verify, review, report }
