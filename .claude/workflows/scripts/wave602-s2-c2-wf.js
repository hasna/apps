export const meta = {
  name: 'wave602-s2-c2',
  description: 'Remediation cycle 2 (FINAL) of the wave602 successor candidate (PR #602, release/version-wave): cycle-1 NO_GO was mechanical (branch CONFLICTING with moved main -> 0 CI runs at head a41b1f25). This cycle lands the named resume conditions: (1) rebase resolving the 4-file conflict (apps/draw/package.json, apps/search/package.json, apps/machines/templates/station/template.json, bun.lock); (2) reconcile apps/loops CHANGELOG with #625 0.5.2 + bump loops to 0.5.3 (version-coordination on the PR); (3) align 29 member hasna.contract.json kitVersion fields to 0.11.2 or record exceptions; (4) complete class-2 (recordings Info.plist literals 0.3.2 -> 0.3.3). Then CI runs exist -> 5/5 green (publish-guard documented wave-mechanism), Fable re-review (cycle 2 FINAL of the successor), merge, [SHIP-READY]. A NO_GO terminates the wave lineage as an engineering blocker',
  phases: [
    { title: 'Remediate', detail: 'rebase 4-file conflict + loops 0.5.3 + kitVersion alignment + recordings literals' },
    { title: 'Verify', detail: 'CI runs exist at the new head; 5/5 green (publish-guard documented class)' },
    { title: 'Review', detail: 'Fable re-review (cycle 2 FINAL of the successor)' },
    { title: 'Ship', detail: 'merge GO, [SHIP-READY]; NO_GO terminates the lineage' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PR = 602
const TASK = 'cf390843'

const CONST = `
You are a lane of the wave602-s2-c2 workflow (2026-08-19) — remediation cycle 2 (FINAL) of the wave602 successor candidate (PR hasna/apps#${PR}, branch release/version-wave). Cycle 1 (wave602-s2) remediated classes 1/3/4 (turbo cycle broken via contracts->secrets 0.3.0, knowledge bin/dist regenerated, publish-guard documented as wave-mechanism) but NO_GO'd MECHANICALLY: the branch is CONFLICTING with moved main (mergeable=false, refs/pull/602/merge absent, 4 conflicting files + bun.lock) so ZERO CI runs exist at head a41b1f25 — the verify lane had no CI evidence; local CI-equivalents were green. THIS IS THE SUCCESSOR CANDIDATE'S FINAL REMEDIATION CYCLE — a NO_GO here terminates the wave lineage as an engineering blocker. Final text = machine-readable JSON.

The named resume conditions (from wave602-s2-verify/ship, recorded on the PR):
(1) REBASE release/version-wave onto current origin/main resolving the 4-file conflict: apps/draw/package.json, apps/search/package.json, apps/machines/templates/station/template.json, bun.lock. #600 (machines 0.2.28) has MERGED — reconcile the wave's machines CHANGELOG duplicate heading per the ordering note (drop the wave's duplicate 0.2.28 entry, keep the version alignment).
(2) LOOP S VERSION COORDINATION (see the VERSION-COORDINATION comment on the PR): apps/loops CHANGELOG — keep #625's 0.5.2 section (runner verbs, merged), move this branch's five entries (pagination fix, machine routing, UNSERVED classifier, command digest + deps) into a new 0.5.3 section, bump apps/loops package.json 0.5.2 -> 0.5.3, align the loops version literal. DO NOT touch #616's changeset on main.
(3) KITVERSION: align the 29 member hasna.contract.json kitVersion fields to 0.11.2, or record exceptions in tooling/ci/tests/standard/contracts.test.ts — reachable, persists post-publish.
(4) CLASS-2 COMPLETION: apps/recordings Info.plist CFBundleShortVersionString + CFBundleVersion 0.3.2 -> 0.3.3 (and any other remaining stale literals from the wave602-s2 class-2 list: actions/changelog/instructions literals + the 3 backing changesets — verify against the cycle-1 remediation what remains).

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/wave602-c3-<n>; work on the PR's OWN branch (release/version-wave — never guess). PR-first; never push to main. Commits end with 'Agent: wave602-c3-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check PR #${PR} comments — if a resume condition already landed (head moved past a41b1f25), verify and record; do not duplicate.
- REMEDIATE ONLY THE NAMED CONDITIONS. No version bumps beyond the coordination (loops 0.5.3), no behavior changes, no unrelated edits. The declaration-emission fix + class-1/3 remediations from cycles 2 and the successor are RETAINED.
- Verify: 'bun install --frozen-lockfile' rc=0 at the new head (literal), the versioning-integrity probe passes locally if runnable (record the command + output), knowledge verify:generated rc=0 (the class-3 regen must survive the rebase — re-run if the rebase touched knowledge), secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on PR #${PR} and task ${TASK}, posts to #board. English. Lineage 'conversations agents register' named wave602-c3-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const REMEDIATE = CONST + `
ROLE: remediate lane. Per the CONST: rebase onto current origin/main resolving the 4-file conflict (both sides kept per the coordination notes), reconcile machines CHANGELOG with #600, apply the loops 0.5.3 coordination (CHANGELOG merge + package.json 0.5.3 + literal), the 29 kitVersion alignments (or exceptions recorded in the test source), the recordings Info.plist literals, and any remaining class-2 literals + backing changesets. Frozen install rc=0 at the new head (literal), local probes green, secrets scan, commit ('Agent: wave602-c3-<your-role>'), push --force-with-lease.
Return (JSON): { newHead: string, diffSummary: string, conflictResolution: [{file, kept}], loopsBumped: bool, loopsVersion: string, kitVersionAligned: number, recordingsFixed: bool, frozenInstallOk: bool, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: the rebase must make CI runs exist again — 'gh pr checks ${PR}' (if the run does not exist, check 'gh run list --branch release/version-wave' and note it; a mergeable PR must produce runs), re-run failed jobs (gh run rerun), poll bounded (max 25 min), require: build+test GREEN (cycle broken + build graph green), gates GREEN (versioning integrity incl. kitVersion), verify-generated GREEN (knowledge regen survived the rebase), test-suites GREEN, publish-guard RECORDED (its actual state + the wave-mechanism documentation reference — it cannot pass pre-publish by design; the gate at publish time is publish-all's per-candidate release review). Record the per-check table.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, publishGuardState: string, frozenInstallOk: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) — cycle 2 (FINAL) of the successor candidate, scoped to the named resume conditions. Review: (a) the conflict resolution kept both sides per the coordination (incl. loops 0.5.3 with #625's 0.5.2 intact), (b) kitVersion alignment complete or exceptions recorded, (c) recordings/class-2 literals aligned, (d) frozen install rc=0 + the three satisfiable checks green (publish-guard documented, not silently waived), (e) the cycle-1 and earlier remediations intact (cycle break, knowledge regen, declaration emission), (f) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — wave602-c3 @ <sha> — lens: successor cycle-2 FINAL, reviewer wave602-c3-review'. Block ONLY concrete P0/P1 defects. A NO_GO terminates the wave lineage as an engineering blocker.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge PR #${PR} (base-movement gate first — merge-tree against origin/main, verify the reviewed tree is what lands; gh pr merge --squash --body-file ending 'Agent: wave602-c3-ship'), record the merged sha, post '[SHIP-READY] hasna/apps#${PR} @ <merged sha> — 35 bumps + loops 0.5.3 + machines 0.2.28-aligned; publish-all next pass ships (repos 0.1.50 fixes the FK brick; rename #636/#637 merge after mergedAt)' on git-publishing, comment task ${TASK}. If NO_GO: comment findings + resume condition, leave open — the wave lineage stops as an engineering blocker; record that on the task.
Return (JSON): { merged: bool, mergedSha: string|null, shipReadyPosted: bool, taskState: string, residue: [string] }
`

const REM_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, diffSummary: { type: 'string' }, conflictResolution: { type: 'array' }, loopsBumped: { type: 'boolean' }, loopsVersion: { type: 'string' }, kitVersionAligned: { type: 'number' }, recordingsFixed: { type: 'boolean' }, frozenInstallOk: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, publishGuardState: { type: 'string' }, frozenInstallOk: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, shipReadyPosted: { type: 'boolean' }, taskState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Remediate')
const remediate = await agent(REMEDIATE, { label: 'wave602-c3-fix', phase: 'Remediate', schema: REM_SCHEMA })

phase('Verify')
let verify = null
if (remediate && remediate.newHead) {
  verify = await agent(VERIFY, { label: 'wave602-c3-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'remediation did not complete', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW, { label: 'wave602-c3-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'remediate/verify did not complete', detail: JSON.stringify({ remediate, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'wave602-c3-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { remediate, verify, review, ship }
