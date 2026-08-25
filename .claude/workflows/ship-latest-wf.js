export const meta = {
  name: 'ship-latest',
  description: 'Fable-verdict A (owner ask 2026-08-19, task cf390843): recurring 30-min ship-latest workflow — census merges+changesets (cheap no-op when nothing pending), changeset version wave -> mechanical version PR (label ship-latest) -> one Fable review -> merge -> [SHIP-READY] on git-publishing. publish-all is the ONLY publisher; this workflow never calls npm publish. Bound: merged code on npm + installed on all reachable stations within 3h worst case, typically 60-90 min, independent of drain state',
  phases: [
    { title: 'Census', detail: 'pending .changeset count + registry-ahead check; zero both -> one-line no-op, no agent spawns' },
    { title: 'Wave', detail: 'one-wave-lane idempotency; bunx @changesets/cli@2.27.9 version (pinned); version PR (branch release/version-wave, label ship-latest)' },
    { title: 'Review', detail: 'one Fable reviewer, mechanical scope (versions+changelogs ONLY), two-cycle cap' },
    { title: 'Merge', detail: 'squash-merge with Agent trailer, base-movement gate' },
    { title: 'Handoff', detail: '[SHIP-READY] on git-publishing naming packages/versions; publish-all owns publish + fleet install' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const TASK = 'cf390843-a2b3-460a-8fca-edf62c0d4434'

const CONST = `
You are a lane of the ship-latest workflow (Fable-verdict A, 2026-08-19, task ${TASK}). Mission: merged hasna/apps code SHIPS continuously — version waves follow merges within a bounded interval, publish-all (the ONLY publisher) then publishes and installs live on all reachable stations. This workflow NEVER calls npm publish. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/ship-latest-<n> from origin/main. PR-first; never push to main. Commits end with 'Agent: ship-latest-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY FIRST: before any mutation, check for an open version PR (gh pr list --repo hasna/apps --search 'label:ship-latest' or title 'Version Packages') — if one is open, the wave is in flight: record 'wave in flight', do NOT start a second wave, do NOT run changeset version. One wave lane at a time fleet-wide.
- The version PR is MECHANICAL: versions+changelogs ONLY, produced by bunx @changesets/cli@2.27.9 version (PINNED — bare bunx resolves 3.0.0 which hard-fails on the repo's 24 pre-existing internal-dep mismatches; measured 2026-08-22 wf_1092b0f8-5d1). Any code-content diff is a NO_GO; re-apply from main, never hand-edit. The PR: branch release/version-wave, title 'Version Packages', label 'ship-latest' (so pr-drain excludes it — it is this workflow's sole ownership for review+merge).
- No secrets: never print/capture/commit credential values; staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings in artifacts. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on ${TASK}, posts to #board and git-publishing. English. Lineage 'conversations agents register' named ship-latest-<your-role>. Distinguish measured vs inferred; state what you did not check.
- The shipped-interval bound (Fable verdict): merge -> next firing <=30 min -> wave applied+merged <=45 min -> next publish-all pass <=60 min -> publish+fleet install <=45 min. Worst case 180 min, typical 60-90. Independent of pr-drain state.
`

const CENSUS = CONST + `
ROLE: census lane. Per the CONST: ONE cheap read — git fetch origin main; VERIFY FETCH_HEAD is current: 'git rev-parse FETCH_HEAD' MUST equal 'gh api repos/hasna/apps/commits/heads/main --jq .sha' (a stale FETCH_HEAD produced a wrong census on 2026-08-21 — 831512fe vs current 2e3ab3877); if they differ, fetch again, then enumerate pending .changeset files at FETCH_HEAD (${MONOREPO}/.changeset/*.md via git ls-tree) and count packages whose repo version is AHEAD of the npm registry (bounded: npm view for the apps with pending changesets only, never a full registry sweep). ALSO check for an open version PR (label ship-latest). Decide: (a) no pending changesets AND nothing ahead -> NO-OP: return {noop: true} with the counts — no further phases run, no tokens burned; (b) pending changesets or ahead packages -> {noop: false} with the exact lists. Record the verified FETCH_HEAD sha in evidence.
Return (JSON): { noop: bool, pendingChangesets: [string], aheadPackages: [{name, repoVersion, registryVersion}], waveInFlight: bool, wavePr: number|null, evidence: string }
`

const WAVE = CONST + `
ROLE: wave lane. Per the CONST + the census (waveInFlight must be false): worktree ~/.hasna/repos/worktrees/apps/ship-latest-<n> from origin/main, run 'bunx @changesets/cli@2.27.9 version' (PINNED to the repo's 2.27.9 — bare bunx resolves 3.0.0 which hard-fails on the 24 pre-existing internal-dep mismatches; measured 2026-08-22 on run wf_1092b0f8-5d1; bounded 10 min), capture the bump set (app -> old -> new). REGISTRY-AHEAD GUARD (measured 2026-08-21 on run wf_e1c8334b-10b): the registry can be AHEAD of main's package.json — release-repair commit e3f7e6b5e5 rolled versions DOWN after publish (billing repo 0.1.1 vs registry 0.1.2, calendar 0.3.2 vs 0.3.4, holdings 0.1.3 vs 0.1.4, knowledge 0.2.108 vs 0.2.111), so a naive changeset bump from the low repo version produces an ALREADY-PUBLISHED version and those fixes silently never ship. AFTER changeset version, for EVERY bumped app compare the new version against 'npm view @hasna/<app> version' (rc=0): where newVersion <= registryVersion, bump the app's package.json (and its CHANGELOG entry) to registryVersion+1 patch, and name each such override + the reason in the PR body. Create branch release/version-wave, commit ('Agent: ship-latest-<your-role>'), push, open the PR: title 'Version Packages', label 'ship-latest', body = the bump table (with registry-override notes) + 'Mechanical version wave from ship-latest; versions+changelogs only'. If bunx @changesets/cli@2.27.9 version errors, capture the literal error and return with prNumber null.
Return (JSON): { prNumber: number|null, bumps: [{app, oldVersion, newVersion}], commandError: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Per the CONST: review the ship-latest version PR (number {PR}): the diff is versions+changelogs ONLY (any code-content change is a P0 NO_GO), version numbers follow the package's pre-1.0 convention (0.x.0 = breaking — changelog says so), every pending changeset is consumed (no missed bumps, no invented ones), 'bun run check' passes or failures are recorded with owners, secrets clean. Post '[REVIEW] <GO|NO_GO> — ship-latest version wave @ <sha> — lens: mechanical release wave, reviewer ship-latest-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const MERGE = CONST + `
ROLE: merge lane. Per the CONST: for the reviewed version PR ({PR}): verify head unchanged since the verdict, base-movement gate (merge-tree vs head; if main moved over the version files, re-run changeset version on the branch, never hand-merge), then gh pr merge <n> --squash --body-file ending 'Agent: ship-latest-ship'. Record the merged sha.
Return (JSON): { prNumber: number, merged: bool, mergedSha: string|null, reason: string|null }
`

const REMEDIATE1 = CONST + `
ROLE: cycle-1 remediate lane (Opus), wave PR {PR}. Fix EXACTLY the named NO_GO blockers from the initial review (same reviewer re-reviews only these):
(1) P1 verify-generated: apps/knowledge committed bin+dist embed pre-bump versions (0.2.109 -> 0.2.110, contracts 0.13.1 -> 0.13.2). REGENERATE apps/knowledge bin+dist UNDER THE PINNED bun 1.3.14 (bun --version MUST read 1.3.14; the knowledge-repro gate requires it — a wrong bun re-drifts) in the wave worktree, commit to the wave branch, push. Verify 'verify generated artifacts' will pass: run the verify script locally (scripts/verify-generated-artifacts.mjs) rc=0.
(2) P1 test-suites (3 instances, wave-caused-by-construction, NO OWNERS RECORDED): record owners ON THE PR COMMENT for each — (a) 'pending changesets are non-empty' fails on any fully-consuming wave: class owner b335a922 (versioning gate drift); (b) 'version change accompanied by changeset' — 12 internal-dependency bumps unbacked (suite does not model updateInternalDependencies:'patch'): class owner b335a922; (c) recordings 0.3.7 runtime mismatch not in KNOWN_RUNTIME_MISMATCHES: class owner b335a922 (the allowlist is hardcoded; PR 735 fixed the version surface, the allowlist needs the new entries). Record each on the PR comment AND on row b335a922.
(3) P1 gates (wave-caused-by-construction): check-manifests self-test resolves the workspace @hasna/contracts version (0.13.2) from the registry — unpublished until publish-all runs; fails by construction on any version wave. Record owner on the PR comment + row d175d558 (contracts pin/conformance class).
(4) P1 build+test (PRE-EXISTING, not wave-caused): @hasna/sessions 'Could not resolve: "@hasna/contracts/mode"' — class owned by row 0731ef62 (contracts-mode-surface lane, in flight); record on the PR comment + row 0731ef62. Do NOT touch the wave diff for this.
(5) P2 base moved: REBASE the wave branch onto CURRENT origin/main (PR baseRefOid is stale), push, so the merge-tree gate can pass.
Then run the wave PR's full CI at the new head (gh api actions/runs?head_sha=<sha>, bounded polling) and return the per-check table with classification. Return (JSON): { newHead, knowledgeRegenDone, verifyGeneratedLocalRc, ownersRecorded: [string], rebased, checks: [{name, conclusion, classification}], prNumber, pushed, evidence }
`

const VERIFY2 = CONST + `
ROLE: cycle-1 verify lane (Opus), wave PR {PR}. At the remediated head: verify-generated job MUST be green (this is the named P1 — the wave regenerated knowledge bin/dist under pinned bun 1.3.14; literal job conclusion); test-suites and gates: classify each failure as wave-caused-by-construction with the owner recorded on the PR (b335a922 / d175d558) — recorded owner satisfies the mission acceptance; build+test: classify the contracts/mode failure as pre-existing owned by 0731ef62 (in-flight lane) with the record on the PR; the wave diff remains versions+changelogs+regenerated-artifacts ONLY. Return (JSON): { verifyGeneratedGreen, checks: [{name, conclusion, classification, ownerRecorded}], diffGatePass, rebaseClean, evidence }
`

const REVIEW2 = CONST + `
ROLE: cycle-1 re-reviewer (Fable, SAME lens as the initial review — reviewer ship-latest-review). Re-review ONLY the named NO_GO blockers and their direct regressions: (1) verify-generated green at the new head (knowledge regenerated under pinned bun — measured), (2) test-suites failures have owners recorded on the PR (the recorded-owner acceptance), (3) gates failure has its owner recorded (d175d558), (4) the pre-existing build+test failure has its owner recorded (0731ef62), (5) wave diff still versions+changelogs+regenerated-artifacts only, (6) base-movement gate vs CURRENT origin/main. Do NOT discover or relitigate unrelated issues or unchanged evidence. Post '[REVIEW] <GO|NO_GO> — ship-latest version wave @ <sha> — lens: mechanical release wave (cycle 1), reviewer ship-latest-review' to #board. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const REMEDIATE2 = CONST + `
ROLE: cycle-2 remediate lane (Opus), wave PR {PR}. Fix EXACTLY the ONE remaining named NO_GO blocker from the cycle-1 review: the base-movement gate. REBASE release/version-wave-6 onto CURRENT origin/main (absorb #755, #760, and anything else that landed since), re-run the wave PR's full CI at the new head, re-measure the merge-tree gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}). Do NOT change the wave diff content (versions+changelogs+regenerated-artifacts only). The cycle-1 named blockers 1-4 were verified PASS and MUST NOT be relitigated or re-opened. If main has NOT moved since the cycle-1 review, record that and report the gate re-measurement only. Return (JSON): { newHead, rebased: bool, mergeTreeEqual: bool, checks: [{name, conclusion, classification}], prNumber, pushed, evidence }
`

const VERIFY3 = CONST + `
ROLE: cycle-2 verify lane (Opus), wave PR {PR}. At the remediated head: merge-tree gate vs CURRENT origin/main (merge-tree == head tree, literal); verify-generated job still green at the new head (regression of the cycle-1 blocker 1 — knowledge regenerated under pinned bun); wave diff still versions+changelogs+regenerated-artifacts ONLY; CI per-check table at the new head (bounded polling; classify each failure as wave-caused-by-construction-with-owner-recorded or named other-lane residual). Return (JSON): { mergeTreeEqual: bool, verifyGeneratedGreen: bool, checks: [{name, conclusion, classification}], diffGatePass: bool, rebaseClean: bool, evidence }
`

const REVIEW3 = CONST + `
ROLE: cycle-2 re-reviewer (Fable, SAME lens as the initial review — reviewer ship-latest-review). Re-review ONLY the named base-movement blocker and its direct regressions: (1) base-movement gate vs CURRENT origin/main (merge-tree == head tree, measured), (2) verify-generated still green at the new head, (3) wave diff unchanged in shape (versions+changelogs+regenerated-artifacts only), (4) CI at the new head classified with owners recorded for wave-caused failures. Do NOT discover or relitigate unrelated issues, unchanged evidence, or the cycle-1 PASS findings. Post '[REVIEW] <GO|NO_GO> — ship-latest version wave @ <sha> — lens: mechanical release wave (cycle 2), reviewer ship-latest-review' to #board. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const HANDOFF = CONST + `
ROLE: handoff lane. Per the CONST: derive the WAVE END STATE from origin/main merge-commit history, NEVER from a PR title — 'git log origin/main --grep=\"consume pending changesets\\|version wave\\|version packages\\|Version Packages\" -i --format=\"%H %s\" -5' (measured 2026-08-21: wave #717's PR was titled 'release(bridge): version 0.7.3' while its squash commit on main is 'chore: version wave — consume pending changesets (Version Packages) (#717)' — a PR-title census missed it and announced a stale end state in 718741; widened 2026-08-21 with -i + explicit 'Version Packages' after the case-sensitive grep missed wave #783's capitalized squash subject 'Version Packages (#708 wave)' and a pass announced 'none' at 721529). Take the LATEST such merge commit; read the bumped package set + versions from its tree (git show <sha>:apps/*/package.json vs its first parent); post [SHIP-READY] to git-publishing naming packages + versions + that merged sha (publish-all's next hourly census publishes exactly this set). DEDUPE CLAUSE (measured twice: 2026-08-21 run wf_e6351a48-597 — 16 duplicate posts in ~4.5h 722041..722391; 2026-08-23 run wf_10ba87d1-df4 — 8 handoff posts for end state c0eb4c6 in 02:15Z..03:45Z, of which 725774/725775 (03:14Z) and 725843 (03:45Z) restated an end state 725752 (03:08Z) had already fully announced — the registry-change justification is a ONE-TIME event captured by the first full post, and later firings must not re-post). DECIDE EXPLICITLY, then return postDecision: 'full' | 'one-liner' | 'none' with the comparison evidence in residue: (1) read the LAST 3 ship-latest-handoff posts on git-publishing (digest with --since, read the bodies via show); (2) post 'full' ONLY when the end-state sha CHANGED since the most recent ship-latest post, OR a package in the set was newly published/confirmed since that most recent post (a change captured by an earlier post is NOT a fresh change); (3) otherwise post 'one-liner' ONLY if NO ship-latest post for this end state is already this same one-liner — check the last SEVERAL posts, not only the most recent (measured 2026-08-23 run wf_9c5eed93-d2d: 725901 duplicated a one-liner 725834 already carried for the same end state c0eb4c6, because the lane keyed on the most recent post 725843 being a full); (4) otherwise 'none' — never restate an unchanged end state, and never post a second full announcement for a registry change an earlier post already announced. Comment ${TASK} (bump set, PR, merged sha). If no such merge commit exists and nothing else merged this pass, post one line: [SHIP-READY] none — registry current, and say it is a census-bounded claim.
Return (JSON): { shippedPackages: [string], postDecision: 'full'|'one-liner'|'none', postId: string|null, taskState: string, residue: [string] }
`


// LIVE GATES (owner 2026-08-25): TWO independent agent gates that run the app
// ITSELF live after the wave merges, before [SHIP-READY]. Each gate installs the
// wave's packages (bun install -g @hasna/<pkg>@<v>) and runs the app's real
// commands live — never test scripts, never --help-only, NON-DESTRUCTIVE —
// per-command GO/NO_GO with evidence. BOTH must return GO or the wave is not
// announced as shipped (a NO_GO files a task and the lane re-checks next pass).
const GATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'perCommand', 'failures'],
  properties: {
    verdict: { enum: ['GO', 'NO_GO'] },
    perCommand: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['command', 'verdict', 'evidence'],
        properties: {
          command: { type: 'string' },
          verdict: { enum: ['GO', 'NO_GO'] },
          evidence: { type: 'string' },
        },
      },
    },
    taskId: { type: ['string', 'null'] },
    failures: { type: 'array', items: { type: 'string' } },
  },
}
const GATE_PROMPT = (which) => `${CONST}
ROLE: LIVE GATE ${'${which}'} OF 2 (ship-latest, owner 2026-08-25). Wave end state: ${'${SHIPPED}'} (packages + versions + merged sha). You verify the SHIPPED APP ITSELF by running its real commands live — this is a LIVE RUN, not a script check:
1. For EACH package in the set: bun install -g @hasna/<pkg>@<v> (add the exact name to ~/.bunfig.toml minimumReleaseAgeExcludes first — the sanctioned quarantine escape; never bypass the quarantine itself). Verify the installed version: <bin> --version prints the published version.
2. RUN THE APP ITSELF, every bin and every non-destructive command: --version, --help (answers BEFORE any bind — a bind-before-version is NO_GO), and every read/validate/list/dry-run verb the app exposes — actual commands, actual outputs, per-command {command, verdict: GO|NO_GO, evidence}. For -serve bins: --version/--help WITHOUT binding, then start it live and hit /health /ready /version.
3. NON-DESTRUCTIVE ONLY: never mutate anything that isn't a throwaway scratch dir. NEVER write test scripts — run the real commands.
4. NO_GO: file a todos task in project 3bbc22e0 ('SHIP UNVERIFIED: <pkg>@<v> — live gate ${'${which}'} NO_GO', evidence in the description) and return its taskId.
Return {verdict, perCommand, failures}.`

const CENSUS_SCHEMA = { type: 'object', properties: { noop: { type: 'boolean' }, pendingChangesets: { type: 'array' }, aheadPackages: { type: 'array' }, waveInFlight: { type: 'boolean' }, wavePr: { type: ['number', 'null'] }, evidence: { type: 'string' } }, required: ['noop'] }
const WAVE_SCHEMA = { type: 'object', properties: { prNumber: { type: ['number', 'null'] }, bumps: { type: 'array' }, commandError: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['prNumber', 'bumps'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const MERGE_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, reason: { type: ['string', 'null'] } }, required: ['prNumber', 'merged'] }
const REMEDIATE1_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, knowledgeRegenDone: { type: 'boolean' }, verifyGeneratedLocalRc: { type: 'number' }, ownersRecorded: { type: 'array' }, rebased: { type: 'boolean' }, checks: { type: 'array' }, prNumber: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'verifyGeneratedLocalRc'] }
const VERIFY2_SCHEMA = { type: 'object', properties: { verifyGeneratedGreen: { type: 'boolean' }, checks: { type: 'array' }, diffGatePass: { type: 'boolean' }, rebaseClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['verifyGeneratedGreen', 'checks'] }
const REVIEW2_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const REMEDIATE2_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, rebased: { type: 'boolean' }, mergeTreeEqual: { type: 'boolean' }, checks: { type: 'array' }, prNumber: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'mergeTreeEqual'] }
const VERIFY3_SCHEMA = { type: 'object', properties: { mergeTreeEqual: { type: 'boolean' }, verifyGeneratedGreen: { type: 'boolean' }, checks: { type: 'array' }, diffGatePass: { type: 'boolean' }, rebaseClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['mergeTreeEqual', 'verifyGeneratedGreen', 'checks'] }
const REVIEW3_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const HANDOFF_SCHEMA = { type: 'object', properties: { shippedPackages: { type: 'array' }, postDecision: { enum: ['full', 'one-liner', 'none'] }, postId: { type: ['string', 'null'] }, taskState: { type: 'string' }, residue: { type: 'array' } }, required: ['taskState', 'postDecision'] }

// --- safeAgent hardening (O15-00732) ---
// A subagent that completes WITHOUT calling StructuredOutput (prose reply) makes
// agent() throw; an uncaught throw kills the whole infinite run (measured
// 2026-08-25: wf_b4894f28-d61 died after 37 agents / 2.7h). safeAgent catches,
// logs, and returns null so the pass continues through the existing null-guards;
// the failure flag makes the NEXT pass's census instruct a 300s bash sleep
// before re-dispatching (the established idle-wait primitive) — a transient
// agent failure pauses the lane instead of killing it or hot-looping.
let agentFailed = false
const safeAgent = async (prompt, opts) => {
  try {
    return await agent(prompt, opts)
  } catch (err) {
    agentFailed = true
    const label = (opts && (opts.label || opts.phase)) || 'agent'
    log('AGENT-FAILURE (' + label + '): ' + (err && err.message ? err.message : String(err)) + ' — continuing; next pass census sleeps 300s first')
    return null
  }
}
const censusPrompt = (body) => {
  if (agentFailed) {
    agentFailed = false
    return "NOTE: a previous pass's agent FAILED (a subagent returned prose instead of StructuredOutput, or another transient error). Sleep 300 (bash) FIRST, then run this census exactly as instructed — the lane is waiting out the transient condition.\n\n" + body
  }
  return body
}
// --- /safeAgent ---

// INFINITE SESSION-SCOPED LOOP (owner 2026-08-25): census -> wave (if owed) ->
// 2-agent live gates (if a wave merged) -> handoff -> sleep ~30 min inside the
// census when nothing pending -> re-census, forever. Stop = owner stops the run
// or the session ends. The census agent sleeps 1800 (bash) and re-checks once
// when it is a NO-OP, so the run stays alive at ~1 agent per idle window.
let pass = 0
for (pass = 1; ; pass++) {
phase('Census')
const census = await safeAgent(censusPrompt(CENSUS), { label: 'ship-latest-census-' + pass, phase: 'Census', schema: CENSUS_SCHEMA })
log(`pass ${pass} census: ${census && census.noop ? 'NO-OP (nothing pending)' : 'wave owed'}`)

let wave = null
let review = null
let merge = null
if (census && !census.noop && !census.waveInFlight) {
  phase('Wave')
  wave = await safeAgent(WAVE, { label: 'ship-latest-wave', phase: 'Wave', schema: WAVE_SCHEMA })

  if (wave && wave.prNumber) {
    phase('Review')
    review = await safeAgent(REVIEW.replace('{PR}', String(wave.prNumber)), { label: 'ship-latest-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })

    if (review && review.verdict === 'GO') {
      phase('Merge')
      merge = await safeAgent(MERGE.replace('{PR}', String(wave.prNumber)), { label: 'ship-latest-merge', phase: 'Merge', schema: MERGE_SCHEMA })
    } else if (review && review.verdict === 'NO_GO') {
      // CYCLE 1 — remediate the named blockers only, re-verify, same-lens re-review
      phase('Remediate-1')
      const remediate1 = await safeAgent(REMEDIATE1.replace('{PR}', String(wave.prNumber)), { label: 'ship-latest-remediate1', phase: 'Remediate-1', schema: REMEDIATE1_SCHEMA, model: 'opus' })
      phase('Verify-2')
      const verify2 = remediate1 && remediate1.pushed ? await safeAgent(VERIFY2.replace('{PR}', String(wave.prNumber)), { label: 'ship-latest-verify2', phase: 'Verify-2', schema: VERIFY2_SCHEMA, model: 'opus' }) : null
      phase('Review-2')
      const review2 = verify2
        ? await safeAgent(REVIEW2.replace('{PR}', String(wave.prNumber)), { label: 'ship-latest-review2', phase: 'Review-2', schema: REVIEW2_SCHEMA, model: 'fable' })
        : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'cycle-1 remediation did not complete', detail: JSON.stringify({ remediate1, verify2 }) }] }
      if (review2 && review2.verdict === 'GO') {
        phase('Merge')
        merge = await safeAgent(MERGE.replace('{PR}', String(wave.prNumber)), { label: 'ship-latest-merge', phase: 'Merge', schema: MERGE_SCHEMA })
      } else if (review2 && review2.verdict === 'NO_GO') {
        // CYCLE 2 — final remediation cycle (bounded-review cap: at most two). Remaining named blocker: base-movement gate only.
        phase('Remediate-2')
        const remediate2 = await safeAgent(REMEDIATE2.replace('{PR}', String(wave.prNumber)), { label: 'ship-latest-remediate2', phase: 'Remediate-2', schema: REMEDIATE2_SCHEMA, model: 'opus' })
        phase('Verify-3')
        const verify3 = remediate2 && remediate2.pushed ? await safeAgent(VERIFY3.replace('{PR}', String(wave.prNumber)), { label: 'ship-latest-verify3', phase: 'Verify-3', schema: VERIFY3_SCHEMA, model: 'opus' }) : null
        phase('Review-3')
        const review3 = verify3
          ? await safeAgent(REVIEW3.replace('{PR}', String(wave.prNumber)), { label: 'ship-latest-review3', phase: 'Review-3', schema: REVIEW3_SCHEMA, model: 'fable' })
          : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'cycle-2 remediation did not complete', detail: JSON.stringify({ remediate2, verify3 }) }] }
        if (review3 && review3.verdict === 'GO') {
          phase('Merge')
          merge = await safeAgent(MERGE.replace('{PR}', String(wave.prNumber)), { label: 'ship-latest-merge', phase: 'Merge', schema: MERGE_SCHEMA })
        }
        review = review3
      } else {
        review = review2
      }
    }
  }
}

// 2-AGENT LIVE GATES (owner 2026-08-25): when a wave MERGED this pass, the app
// itself must pass TWO independent live GO/NO_GO gates before [SHIP-READY].
let gates = null
let shipped = null
if (merge && merge.merged) {
  shipped = (merge && merge.mergedSha) ? merge.mergedSha : (wave ? wave.prNumber : null)
  phase('LiveGates')
  const gateResults = await parallel([
    () => safeAgent(GATE_PROMPT('ONE').replace('{SHIPPED}', JSON.stringify({ mergedSha: merge.mergedSha, prNumber: wave ? wave.prNumber : null })), { label: 'ship-latest-gate-1:' + pass, phase: 'LiveGates', schema: GATE_SCHEMA }),
    () => safeAgent(GATE_PROMPT('TWO').replace('{SHIPPED}', JSON.stringify({ mergedSha: merge.mergedSha, prNumber: wave ? wave.prNumber : null })), { label: 'ship-latest-gate-2:' + pass, phase: 'LiveGates', schema: GATE_SCHEMA }),
  ])
  const bothGo = gateResults.filter(Boolean).every(g => g && g.verdict === 'GO')
  gates = { bothGo, gate1: gateResults[0], gate2: gateResults[1] }
  log(`pass ${pass} live gates: ${bothGo ? 'BOTH GO' : 'NO_GO — wave NOT announced as shipped'}`)
}

phase('Handoff')
const handoff = await safeAgent(HANDOFF, { label: 'ship-latest-handoff-' + pass, phase: 'Handoff', schema: HANDOFF_SCHEMA })
if (gates && !gates.bothGo) {
  // A NO_GO gate means the wave is NOT verified live: do not let [SHIP-READY] stand as shipped.
  log('pass ' + pass + ': live gate NO_GO — [SHIP-READY] not posted for the unverified wave; tasks filed by the gates')
}

if (census && census.noop && !(merge && merge.merged)) {
  log(`pass ${pass}: nothing pending and nothing merged — the census waited ~30 min and re-checked; re-checking next pass`)
}
}
