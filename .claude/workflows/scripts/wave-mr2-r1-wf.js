export const meta = {
  name: 'wave-mr2-r1',
  description: 'Remediation cycle 1 for the machines workspace-member repair PR hasna/apps#673 (wave #670 gate class): fix+verify completed at head a5c075ce (committed types/ + install-time prepare; TS2307 class GONE, frozen install rc=0, 5-check CI 4/5 green) but the publish guard is RED deterministically 3 of 3 — `npm pack --dry-run` -> prepack -> `bun run verify:pack` exits 1, failing step hidden behind the guard\'s 5-line stderr tail, runner-side npm debug log unexamined, local repro of every step passes at the exact head. This lane: diagnose the verify:pack CI failure (runner-side log or widen the guard\'s capture), fix the root cause, publish guard GREEN at the same head, re-verify all five checks, Fable re-review (scoped), merge, then wave #670 rebases onto main and its machines class clears',
  phases: [
    { title: 'Fix', detail: 'diagnose + fix machines verify:pack CI failure at head a5c075ce (publish guard green)' },
    { title: 'Verify', detail: '5/5 CI green at the new head' },
    { title: 'Review', detail: 'Fable re-review (cycle 1, scoped to the named defect)' },
    { title: 'Ship', detail: 'base gate, merge #673, wave #670 machines class clears' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PR = 673

const CONST = `
You are a lane of the wave-mr2-r1 workflow (2026-08-20) — remediation cycle 1 of the machines workspace-member repair PR hasna/apps#${PR} (wave #670 gate class). Cycle-0 (wave-machines-repair) fixed the workspace-link dist story at head a5c075ce529b00feec2c42fe81df42718d484244: committed export-map declarations (types/) + install-time prepare build — the deterministic TS2307 'Cannot find module @hasna/machines/consumer' in fresh checkouts is GONE (PREPARE_RC=0 repro), frozen install rc=0, CI 4/5 green at head. ONE check remains RED, deterministically 3 of 3 (runs 32322406585 + two --failed re-runs): publish guard (no internal-infra strings in tarballs) — 'npm pack --dry-run' -> prepack -> 'bun run verify:pack' exits 1; the guard captures only the last 5 stderr lines so the failing step is invisible; the runner-side npm debug log (/home/runner/.npm/_logs/...debug-0.log, path printed in the job) was never examined; every step of verify:pack reproduces GREEN locally at the exact head under npm 11.18, npm@10 and cold bun cache. Same job class is GREEN on main (run 32322205507, machines 136 entries) — the failure is change-correlated. Final text = machine-readable JSON.

The named remediation (from cycle-0's resume condition): diagnose the machines verify:pack CI failure (read the runner-side npm debug log from the latest failed run, or widen the guard's stderr capture so the failing step is visible), fix the ROOT CAUSE (candidate classes: smoke-section registry install of the tarball, or runtime imports of the newly externalized @hasna/contracts in the packed bundle), get the publish guard GREEN at the same head, then re-verify all five checks at that head. Do NOT waive or bypass the guard; do NOT disable verify:pack.

Coordination: when #${PR} merges, wave #670 (Version Packages, release/version-wave) must rebase onto the new main and its machines class clears; the wave's contracts class is held on the contracts-split lane (already merged, publish pending) — NOT this lane.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work; shared checkout dirty from other lanes — fetch refs and work from a worktree if the pull refuses). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/wave-mr2r1-<n>; work on the PR's OWN branch (wave-machines-repair — gh pr view ${PR} --json headRefName, never guess). PR-first; never push to main. Commits end with 'Agent: wave-mr2r1-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check PR #${PR} comments — if the publish-guard remediation already landed (a fix commit past a5c075ce with the guard green, or the PR merged), verify and record; do not duplicate.
- REMEDIATE ONLY THE NAMED DEFECT: the publish-guard verify:pack CI failure. No scope creep, no new version bumps, no gate edits that weaken the guard.
- Verify: machines suite green (record counts; the known test-harness 5000ms-budget timeout is pre-existing on main — record it, do not chase), 'bun install --frozen-lockfile' rc=0, 'bun run verify:pack' rc=0 locally at the new head (literal), secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on PR #${PR} and wave #670, posts to #board. English. Lineage 'conversations agents register' named wave-mr2r1-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const FIX = CONST + `
ROLE: fix lane. Per the CONST: pull the latest failed publish-guard run's debug log path from the job ('gh run view <run> --log-failed' or the printed /home/runner/.npm/_logs/ path — read the runner-side capture), identify the failing verify:pack step, reproduce the mechanism locally, apply the smallest owned root-cause fix in the PR branch, prove 'bun run verify:pack' rc=0 at the new head (literal) + machines suite green + frozen install rc=0, secrets scan, commit ('Agent: wave-mr2r1-<your-role>'), push --force-with-lease.
Return (JSON): { newHead: string, diffSummary: string, rootCause: string, verifyPackOk: bool, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks ${PR}', re-run failed jobs (gh run rerun), poll bounded (max 25 min), require ALL FIVE checks GREEN at the new head (record the per-check table; publish guard is the check under test). If the publish guard is STILL red after the fix: classify (same class vs new), capture the runner-side log, report the exact resume condition — do NOT loop re-running.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, publishGuardOk: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) — cycle 1, scoped to the named defect. Review: (a) the root cause is real and the fix is the smallest owned change (verify:pack green locally at the new head, measured), (b) publish guard GREEN in CI at the new head, (c) no guard weakening (verify:pack not disabled, no waivers), (d) no scope creep, (e) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — wave-mr2-r1 @ <sha> — lens: machines verify:pack publish-guard remediation, reviewer wave-mr2r1-review'. Block ONLY concrete P0/P1 defects; two cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge PR #${PR} (base-movement gate first — merge-tree against origin/main; gh pr merge --squash --body-file ending 'Agent: wave-mr2r1-ship'), record the merged sha, comment on wave #670 that the machines class cleared and it must rebase onto the new main. If NO_GO: comment findings + resume condition, leave open — the lineage stops as an engineering blocker on a second consecutive NO_GO; record that.
Return (JSON): { merged: bool, mergedSha: string|null, residue: [string] }
`

const FIX_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, diffSummary: { type: 'string' }, rootCause: { type: 'string' }, verifyPackOk: { type: 'boolean' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'diffSummary', 'rootCause'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, publishGuardOk: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, residue: { type: 'array' } }, required: ['merged'] }

phase('Fix')
const fix = await agent(FIX, { label: 'wave-mr2r1-fix', phase: 'Fix', schema: FIX_SCHEMA })

phase('Verify')
let verify = null
if (fix && fix.newHead) {
  verify = await agent(VERIFY, { label: 'wave-mr2r1-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'fix did not produce a new head', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW, { label: 'wave-mr2r1-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'fix/verify did not complete', detail: JSON.stringify({ fix, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'wave-mr2r1-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { fix, verify, review, ship }
