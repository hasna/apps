export const meta = {
  name: 'wave602-successor',
  description: 'Adjudicated ONE successor for hasna/apps#602 (ship-latest 36-app version wave). Cycle-2 (FINAL) NO_GO at 21c94afa: the declaration-emissionP1 is RESOLVED (frozen install rc=0) but four wave-caused CI gate classes remain. This successor is a materially new candidate: remediate the three satisfiable classes (turbo dep cycle events/secrets/contracts; 9 stale version literals + changesets; knowledge generated artifacts regen), document the fourth (publish-guard 12-package pack, structurally unsatisfiable pre-publish — wave-mechanism, real gate is publish-all release review), re-verify frozen install + all five checks, fresh Fable review. NO_GO stops the lineage as an engineering blocker.',
  phases: [
    { title: 'Prepare', detail: 'idempotency census: PR #602 head, main movement, machines-split state, the four classes exact evidence, turbo-cycle edge decision' },
    { title: 'Remediate', detail: 'lane 1: turbo cycle break + version literals + changesets; lane 2 (parallel, read-only): publish-guard evidence pack' },
    { title: 'Regen', detail: 'knowledge committed bin/ + dist/ regenerated at head' },
    { title: 'Verify', detail: 'frozen install rc=0 + all five CI checks at the new head' },
    { title: 'Review', detail: 'Fable adversarial review, fresh lineage (reviewer wave602-s2-review)' },
    { title: 'Ship', detail: 'merge GO, [SHIP-READY], task cf390843, ordering note vs #600' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PR = 602
const TASK = 'cf390843'

const CONST = `
You are a lane of the wave602-successor workflow (2026-08-19) — the adjudicated ONE successor for hasna/apps#${PR} (the 36-app version wave, branch release/version-wave). PR #${PR} exhausted its two remediation cycles (lockfile in cycle 1, declaration emission in cycle 2 FINAL) and cycle-2's verify lane recorded FOUR wave-caused CI gate failures at head 21c94afa (all five checks passed at merge-base 13087f2787; all four reproduced locally byte-identical):

(1) build+test — turbo dep cycle: the wave aligned events/secrets/contracts ranges to member 0.11.2, closing a workspace cycle (@hasna/events <-> @hasna/secrets <-> @hasna/contracts). Fix: break one edge or keep one range registry-resolving (prepare lane names the decision).
(2) versioning integrity — 9 stale literal runtime version exports (actions/changelog/instructions) + backing changesets owed for the aligned packages.
(3) verify-generated — apps/knowledge committed bin/ + dist/ must be regenerated at head (bundle embeds the pre-wave version).
(4) publish-guard — 12 packages failing pack (unpublished-version class): the guard compares tarballs against registry state, so a version wave CANNOT satisfy it pre-publish — recorded as wave-mechanism; the real gate at publish time is publish-all's per-candidate release review (npm-release-agent-review). This class is DOCUMENTED, not remediated.

The declaration-emission fix from cycle 2 (apps/contracts + apps/machines emit declared subpath .d.ts; machines gains prepare; externals in bundles; types/ committed) IS retained at head 21c94afa — verified by five fresh 'bun install --frozen-lockfile' rc=0 runs. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/wave602-s2-<n>; work on the PR's OWN branch (release/version-wave — never guess). PR-first; never push to main. Commits end with 'Agent: wave602-s2-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check PR #${PR} comments — if remediation of a class already landed (head moved past 21c94afa), verify and record; do not duplicate.
- REMEDIATE ONLY THE NAMED CLASSES. No version bumps, no behavior changes, no unrelated edits. The successor's acceptance: 'bun install --frozen-lockfile' rc=0 at the new head, the three satisfiable checks green, publish-guard recorded with per-package evidence.
- No secrets: never print/capture/commit credential values; staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on PR #${PR} and task ${TASK}, posts to #board. English. Lineage 'conversations agents register' named wave602-s2-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const PREPARE = CONST + `
ROLE: prepare lane. Per the CONST: (a) confirm PR #${PR} head and that the cycle-2 declaration fix is committed at 21c94afa (or later); (b) record origin/main HEAD and whether a rebase is owed; (c) check the machines-split state: PR #600 (machines 0.2.28, branch machines-split) — open or merged? Both carry machines 0.2.28; record the ordering dependency (if #600 is open, the wave's machines bump is version-only; publish-all's per-package release review arbitrates content order); (d) reproduce or re-read the evidence for each of the four classes at head 21c94afa (record the literal per-class failure output — 'gh pr checks ${PR}' table + the local repros; if CI already shows one green, say so); (e) NAME the turbo-cycle edge decision: read the actual package.json ranges of events/secrets/contracts at head, decide the smallest break that keeps the wave's alignment intent (which range stays workspace-linked, which resolves from the registry), and record it; (f) enumerate the 9 stale version literals (file:line) and the changesets owed.
Return (JSON): { prHead: string, mainHead: string, rebaseOwed: bool, machinesSplit: {prNumber, state, orderingNote}, classes: [{id, name, evidence, satisfiable}], cycleDecision: {edge, action, rationale}, versionLiterals: [{file, line, expected}], changesetsOwed: [string], evidence: string }
`

const LANE_CYCLE = CONST + `
ROLE: remediate lane (class 1 + 2). Per the CONST and the prepare decision ({PREP}): (a) break the turbo cycle exactly as decided (the named edge keeps a registry-resolving range or the named workspace edge is removed — smallest change), (b) align the 9 stale literal runtime version exports ({LITERALS}) to the wave versions, (c) add the backing changesets ({CHANGESETS}) for the aligned packages. Verify: 'bun install --frozen-lockfile' rc=0 locally (literal), the affected packages' suites green (record counts), the versioning-integrity check's own probe passes locally if runnable (record the command + output), secrets scan, commit ('Agent: wave602-s2-<your-role>'), push --force-with-lease.
Return (JSON): { newHead: string, diffSummary: string, cycleBroken: bool, literalsAligned: bool, changesetsAdded: bool, frozenInstallOk: bool, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const LANE_DOC = CONST + `
ROLE: evidence lane (class 4, READ-ONLY — no branch mutation, no commits). Per the CONST: for each of the 12 packages failing pack at head 21c94afa, capture the literal pack failure output (package name, version, the failing check line) into an evidence pack; classify each as unpublished-version wave-mechanism (the tarball name/version does not exist on the registry because the wave IS the publication) or something else (a genuinely reachable defect). Post the pack to PR #${PR} and task ${TASK} as a comment: 'WAVE602-S2 PUBLISH-GUARD PACK: N of 12 classified wave-mechanism; M non-mechanism (list them with evidence); real gate at publish = publish-all per-candidate release review (npm-release-agent-review)'. No file changes.
Return (JSON): { packages: [{name, version, failure, classification}], mechanismCount: number, nonMechanism: [string], postedToPr: bool, postedToTask: bool, evidence: string }
`

const REGEN = CONST + `
ROLE: regen lane (class 3). Per the CONST: regenerate apps/knowledge's committed generated artifacts at the new head (the committed bin/ and dist/ under apps/knowledge must be rebuilt from source so the embedded version matches the wave bump — find the generating command in the package's own scripts, run it, commit ONLY the regenerated artifacts + any source-of-truth that changed). Verify the generated artifacts now embed the wave version (literal grep line), the knowledge suite green (record counts), secrets scan, commit ('Agent: wave602-s2-<your-role>'), push --force-with-lease.
Return (JSON): { newHead: string, diffSummary: string, regenerated: [string], versionEmbedded: string, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks ${PR}', re-run failed jobs (gh run rerun), poll bounded (max 25 min), require: build+test GREEN (turbo cycle broken), gates GREEN (versioning integrity), verify-generated GREEN (knowledge regen), test-suites GREEN, and publish-guard recorded (its actual state at the new head + the wave-mechanism classification reference — it cannot pass pre-publish by design; the gate at publish time is publish-all's per-candidate release review). Re-verify 'bun install --frozen-lockfile' rc=0 at the new head (literal) and loops prepare passes. Record the per-check table. The known environmental 'Install playwright chromium' stall (apt mirror, task 552e18cc) is unrelated — if it is the ONLY failing step, re-run once and record it as environmental.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, publishGuardState: string, frozenInstallOk: bool, loopsPrepareOk: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) — fresh lineage for this materially new successor candidate. Review at the new head: (a) class 1: the turbo cycle is broken by the smallest named edge change, no collateral bumps; (b) class 2: the 9 literals align with the wave versions and changesets back them; (c) class 3: knowledge's generated artifacts regenerated and version-correct; (d) class 4: the publish-guard pack is complete per-package evidence, non-mechanism packages (if any) are named and blocked; (e) frozen install rc=0 + the three satisfiable checks green (publish-guard documented, not silently waived); (f) the cycle-2 declaration fix intact; (g) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — wave602-s2 @ <sha> — lens: successor classes 1-4, reviewer wave602-s2-review'. Block ONLY concrete P0/P1 defects. This successor is the lineage's single adjudicated attempt — a NO_GO here terminates the wave lineage as an engineering blocker.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge PR #${PR} (base-movement gate first — merge-tree against origin/main, verify the reviewed tree is what lands; gh pr merge --squash --body-file ending 'Agent: wave602-s2-ship'), record the merged sha, post '[SHIP-READY] hasna/apps#${PR} @ <merged sha> — 36 bumps, publish-all next pass ships (machines 0.2.28 ordering: <state of #600>)' on git-publishing, comment task ${TASK}. If NO_GO: comment findings + resume condition, leave open — the lineage stops as an engineering blocker, record that in the task.
Return (JSON): { merged: bool, mergedSha: string|null, shipReadyPosted: bool, taskState: string, residue: [string] }
`

const PREP_SCHEMA = { type: 'object', properties: { prHead: { type: 'string' }, mainHead: { type: 'string' }, rebaseOwed: { type: 'boolean' }, machinesSplit: { type: 'object' }, classes: { type: 'array' }, cycleDecision: { type: 'object' }, versionLiterals: { type: 'array' }, changesetsOwed: { type: 'array' }, evidence: { type: 'string' } }, required: ['prHead', 'classes', 'cycleDecision'] }
const CYCLE_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, diffSummary: { type: 'string' }, cycleBroken: { type: 'boolean' }, literalsAligned: { type: 'boolean' }, changesetsAdded: { type: 'boolean' }, frozenInstallOk: { type: 'boolean' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'diffSummary'] }
const DOC_SCHEMA = { type: 'object', properties: { packages: { type: 'array' }, mechanismCount: { type: 'number' }, nonMechanism: { type: 'array' }, postedToPr: { type: 'boolean' }, postedToTask: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['packages'] }
const REGEN_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, diffSummary: { type: 'string' }, regenerated: { type: 'array' }, versionEmbedded: { type: 'string' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, publishGuardState: { type: 'string' }, frozenInstallOk: { type: 'boolean' }, loopsPrepareOk: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, shipReadyPosted: { type: 'boolean' }, taskState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Prepare')
const prepare = await agent(PREPARE, { label: 'wave602-s2-prepare', phase: 'Prepare', schema: PREP_SCHEMA })

phase('Remediate')
let cycle = null
let doc = null
if (prepare) {
  ;[cycle, doc] = await parallel([
    () => agent(LANE_CYCLE.replace('{PREP}', JSON.stringify({ decision: prepare.cycleDecision, literals: prepare.versionLiterals || [], changesets: prepare.changesetsOwed || [] })).replace('{LITERALS}', JSON.stringify(prepare.versionLiterals || [])).replace('{CHANGESETS}', JSON.stringify(prepare.changesetsOwed || [])), { label: 'wave602-s2-cycle', phase: 'Remediate', schema: CYCLE_SCHEMA }),
    () => agent(LANE_DOC, { label: 'wave602-s2-doc', phase: 'Remediate', schema: DOC_SCHEMA }),
  ])
} else {
  cycle = { newHead: null }
  doc = { packages: [] }
}

phase('Regen')
let regen = null
if (cycle && cycle.newHead) {
  regen = await agent(REGEN, { label: 'wave602-s2-regen', phase: 'Regen', schema: REGEN_SCHEMA })
} else {
  regen = { newHead: null }
}

phase('Verify')
let verify = null
if (regen && regen.newHead) {
  verify = await agent(VERIFY, { label: 'wave602-s2-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'remediate/regen did not complete', evidence: JSON.stringify({ cycle, regen }) }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW, { label: 'wave602-s2-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'remediate/verify did not complete', detail: JSON.stringify({ prepare, cycle, doc, regen, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'wave602-s2-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { prepare, cycle, doc, regen, verify, review, ship }
