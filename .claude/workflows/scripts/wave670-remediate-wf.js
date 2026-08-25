export const meta = {
  name: 'wave670-remediate',
  description: 'Remediation lane for wave PR hasna/apps#670 (release/version-wave @ 0948ff270) — wave-caused deterministic CI blocker: wave range rewrites flip bun resolution from registry tarballs to the dist-less workspace member (apps/attachments @hasna/contracts ^0.8.2 -> ^0.11.2; Could not resolve "@hasna/contracts/auth" at serve/index.ts:18, 5/5 checks fail, 10/10 logs identical, reproduced after contracts 0.12.0 publish). THIS lane: diagnose the resolution mechanism, smallest wave-owned fix (range exclusion or the correct subpath story), re-verify CI 5/5 at the new head, Fable review, base gate, merge, [SHIP-READY] -> publish-all ships',
  phases: [
    { title: 'Diagnose', detail: 'idempotency check + confirm the resolution mechanism at 0948ff270 (why ^0.11.2 flips to the workspace member)' },
    { title: 'Fix', detail: 'smallest wave-owned remediation on release/version-wave, frozen install + versioning suite green, push' },
    { title: 'Verify', detail: 'CI 5/5 at the new head' },
    { title: 'Review', detail: 'Fable adversarial review' },
    { title: 'Ship', detail: 'base gate, merge, [SHIP-READY] with the bump set' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PR = 670

const CONST = `
You are a lane of the wave670-remediate workflow (2026-08-20) — the remediation for wave PR hasna/apps#${PR} 'Version Packages' (branch release/version-wave, head 0948ff270, label ship-latest; sole owner is the ship-latest workflow — NO second wave may be opened). Final text = machine-readable JSON.

THE BLOCKER (measured by wave670-merge verify, 2026-08-20, run 32349106646): CI 5/5 fails deterministically at 0948ff270 — 10/10 job logs carry the identical signature at Install: error: Could not resolve: "@hasna/contracts/auth". Maybe you need to "bun install"? at apps/attachments/src/serve/index.ts:18:29 -> build exit 1 -> attachments prepare exit 1. Mechanism measured from tree: wave range rewrites flip bun resolution from registry tarballs to a dist-less workspace member — main attachments @hasna/contracts: ^0.8.2, wave head ^0.11.2; the range is satisfied by the workspace member apps/contracts, whose dist lacks the auth subpath. Registry state is irrelevant when the range is satisfied (contracts 0.12.0 was published BEFORE both CI attempts and the class did NOT clear). Merging the wave as-is would land main with the same fresh-checkout CI failure.

THE REMEDIATION: diagnose the exact resolution mechanism at the wave head, then apply the SMALLEST wave-owned fix on release/version-wave so a fresh checkout install resolves @hasna/contracts/auth correctly while keeping the wave version-only and the bump set intact. Candidate directions (measure, do not guess): exclude the attachments @hasna/contracts dependency line from the wave's range rewrite (keep main's value), fix the workspace-member dist/export story only if it is genuinely wave-owned (it is NOT if main's CI is green at the same contracts source — then the wave must not flip resolution), or the equivalent minimal correction proven by a fresh-checkout install. Re-run changeset version consistency, frozen install rc=0 (full, not --ignore-scripts), versioning suite per the documented classes, secrets scan, push.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work; shared checkout dirty from other lanes — fetch refs and work from a worktree if the pull refuses). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/wave670r-<n>; work on the PR's OWN branch (release/version-wave — gh pr view ${PR} --json headRefName, never guess). PR-first; never push to main. Commits end with 'Agent: wave670r-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check PR #${PR} comments and state — if the wave already merged, or a remediation already landed a fresh-checkout green at a newer head, verify and record; do not duplicate.
- SCOPE: the smallest wave-owned remediation ONLY. No other version changes, no scope creep, no second wave.
- Verify: 'bun install --frozen-lockfile' rc=0 (full; the --ignore-scripts variant is NOT the acceptance gate here — the blocker is an install-time prepare failure), versioning suite green per the two documented classes (loops 0.5.4 changeset-accompaniment; 11-pkg literal-runtime-export — wave-1 precedent merged red), the per-check CI table at the new head, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on PR #${PR}, posts to #board. English. Lineage 'conversations agents register' named wave670r-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const DIAGNOSE = CONST + `
ROLE: diagnose lane (Opus). IDEMPOTENCY CHECK FIRST (per the CONST). Then confirm the mechanism at the wave head: reproduce the resolution failure locally (fresh checkout semantics: bun install in a worktree at 0948ff270 with the wave branch checked out — or the equivalent measured repro), and name EXACTLY why the wave's range rewrite flips @hasna/contracts/auth resolution to the workspace member (bun workspace resolution rules, the range math, the dist surface of apps/contracts vs the published tarball). State what you did not check.
Return (JSON): { idempotency: { alreadyMerged: bool, remediationLanded: string|null, decision: string }, mechanism: string, repro: string, fixDirection: string, evidence: string }
`

const FIX = CONST + `
ROLE: fix lane. Per the CONST + the mechanism ({MECHANISM}): apply the SMALLEST wave-owned remediation on release/version-wave ({FIXDIRECTION}), prove a fresh-checkout install resolves @hasna/contracts/auth (frozen install rc=0 FULL — the install-time prepare must pass), versioning suite per the two documented classes, wave diff stays version-only (re-check: no non-version paths vs origin/main), secrets scan, commit ('Agent: wave670r-<your-role>'), push --force-with-lease.

RE-ENTRY (resume wf_9c220c1f-fea, run 4, 2026-08-20): SHIP-LANE RULING B APPLICATION. The ship lane NO_GO'd at head ccfe2db (CI 32360538778): gates + verify-generated SUCCESS; test-suites FAIL exactly the two documented classes (loops changeset-accompaniment; 11-pkg literal-runtime-export); build+test FAIL on the NEWLY measured orgs surface (apps/orgs/src/coverage-sol.test.ts:835 expects "0.1.0", CLI reports "0.1.1" — orgs 0.1.0->0.1.1 wave bump, test file not in wave diff); publish guard FAIL (same 11-pkg root via pack checks). Per the ship lane's documented RULING B (wave670r-ship 10:33:04Z): the 11-pkg literal-runtime-export class is REMEDIATE-IN-WAVE, NOT mergeable red. THIS cycle: (1) apply RULING B in-wave at head ccfe2db — sync the committed runtime version surfaces to the wave-bumped package versions: the 11 documented members (access APP_VERSION, billing APP_VERSION, actions ACTIONS_VERSION, recordings version:check, plus changelog/consolidations/draw/releases/router/secrets/slides per the versioning suite reader) AND the newly measured orgs surface (coverage-sol.test.ts:835 "0.1.0" -> "0.1.1"); enumerate the FULL surface set locally BEFORE pushing by running each wave-bumped member's own test suite (CI build+test fail-fast masks members — attempt 1 reported access, attempt 2 orgs, both fail). No bun.lock change needed (no dep lines change). (2) REBASE release/version-wave onto origin/main ad7e0dad (main advanced via #686) keeping all landed fixes. (3) Re-run: full bun install --frozen-lockfile rc=0, bun run test:versioning (expect red at most on the loops class), bun run test:standard, secrets scan, push. (4) Fresh CI: expected gates/build+test/publish-guard/verify-generated SUCCESS; test-suites red at most on the loops changeset-accompaniment class, which the ship lane rules per RULING D (keep-and-document vs drop). Base gate at merge time; publish-all is the ONLY publisher; commits end 'Agent: wave670r-fix'.
Return (JSON): { newHead: string, diffSummary: string, fixApplied: string, frozenInstallOk: bool, versionOnly: bool, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks ${PR}' at the new head ({HEAD}), re-run failed jobs, poll bounded (max 25 min), record the per-check table. acceptanceMet=true ONLY when all five checks pass (or the ONLY remaining failures are the two documented versioning classes with wave-1 precedent — never an install/prepare class).

RE-ENTRY (resume wf_9c220c1f-fea, run 2 verify-fail at 283a3ea4b): re-verify at the NEW head after the re-entry fix push. Previous run-2 table at 283a3ea4b: gates success; test-suites FAIL; verify-generated FAIL; build+test FAIL; publish-guard FAIL. acceptanceMet=true only when the new table is 5/5 green or the ONLY failures are the two documented versioning classes (loops changeset-accompaniment; 11-pkg literal-runtime-export) with the ship lane's documented ruling.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the wave at the new head ({HEAD}): (a) the remediation is the smallest wave-owned change (no scope creep), (b) a fresh-checkout install resolves @hasna/contracts/auth (measured), (c) the wave diff remains version-only, (d) CI per the verify classification, (e) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — wave670-remediate @ <sha> — lens: wave remediation, reviewer wave670r-review'. Block ONLY concrete P0/P1 defects; two cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge PR #${PR} (base-movement gate first — merge-tree against origin/main; gh pr merge --squash --body-file ending 'Agent: wave670r-ship'), record the merged sha, post '[SHIP-READY] hasna/apps#${PR} @ <merged sha> — <bump count> bumps; publish-all next pass ships' on git-publishing. If preconditions missing or NO_GO: comment the exact remaining gates + resume condition, leave open.

RE-ENTRY (resume wf_9c220c1f-fea, run 2 verify-fail at 283a3ea4b): re-entry ship — merge only if the re-entry fix pushed a new head, verify reports 5/5 green (or the two documented versioning classes with the documented ship-lane ruling) at that head, and review returned GO. Base gate at merge time (base == refs/remotes/origin/main; merge-tree check). publish-all is the ONLY publisher.
Return (JSON): { merged: bool, mergedSha: string|null, shipReadyPosted: bool, residue: [string] }
`

const DIAGNOSE_SCHEMA = { type: 'object', properties: { idempotency: { type: 'object' }, mechanism: { type: 'string' }, repro: { type: 'string' }, fixDirection: { type: 'string' }, evidence: { type: 'string' } }, required: ['idempotency', 'mechanism'] }
const FIX_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, diffSummary: { type: 'string' }, fixApplied: { type: 'string' }, frozenInstallOk: { type: 'boolean' }, versionOnly: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, shipReadyPosted: { type: 'boolean' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Diagnose')
const diagnose = await agent(DIAGNOSE, { label: 'wave670r-diagnose', phase: 'Diagnose', schema: DIAGNOSE_SCHEMA, model: 'opus' })

phase('Fix')
let fix = null
if (diagnose && diagnose.idempotency && diagnose.idempotency.decision !== 'already-done') {
  fix = await agent(FIX.replace('{MECHANISM}', diagnose.mechanism).replace('{FIXDIRECTION}', diagnose.fixDirection), { label: 'wave670r-fix', phase: 'Fix', schema: FIX_SCHEMA })
} else {
  fix = { newHead: 'none', diffSummary: 'skipped', evidence: 'idempotency: already-done' }
}

phase('Verify')
let verify = null
if (fix && fix.newHead && fix.newHead !== 'none') {
  verify = await agent(VERIFY.replace('{HEAD}', fix.newHead), { label: 'wave670r-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'fix did not produce a head', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW.replace('{HEAD}', fix.newHead), { label: 'wave670r-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'fix/verify did not complete', detail: JSON.stringify({ fix, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'wave670r-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { diagnose, fix, verify, review, ship }
