export const meta = {
  name: 'recordings-bar-successor',
  description: 'Successor attempt: recordings macOS bar-only — fix the 3 terminated P1 classes, Developer ID signing, backup+remove full app, install bar on station03/04, live test',
  phases: [
    { title: 'Fix', detail: 'one Sonnet fixer: bar-only candidate fixing the 3 named P1 classes + Developer ID signing support' },
    { title: 'Review', detail: 'Fable adversarial review, bounded two-cycle remediation, exact-sha verdict' },
    { title: 'Ship', detail: 'merge, build+sign on station03, backup+remove full Recordings.app, install bar 03/04, live test' },
    { title: 'Harvest', detail: 'independent Opus harvest' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const APP = 'apps/recordings'
const TASK = '4ee4ebbf-9a10-4181-8e43-9307d56e684b'
const CHANNEL = 'recordings'

const CONST = `
You are a lane of the recordings macOS bar-only SUCCESSOR workflow (owner-authorized 2026-08-17, task ${TASK}). This is the single adjudicated successor to the terminated PR hasna/apps#269 lineage (three NO_GOs). The owner's outcome remains authorized: backup+remove the full macOS Recordings.app, keep only the menu bar, install the bar on station03 and station04. Your final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first: git -C ${MONOREPO} pull (fast-forward; never discard local work). Edits ONLY in task worktrees ~/.hasna/repos/worktrees/apps/<name>, branch from UPDATED main. PRs target hasna/apps. Before EVERY commit/push: secrets scan staged (0 clean / 1 finding / 2 could-not-scan — non-zero blocks). Commits end with 'Agent: recordings-bar-<your-role>' (the ONLY attribution line).
- No secrets: never print/capture/commit credential values in any encoding; consume ONLY via 'secrets exec <key> --as VAR -- <cmd>'. No internal-infra strings in artifacts.
- Capture path: redirect to files, read both + $?; never pipe large reads. Paste literal output lines when reporting.
- Record as you go: comments on ${TASK}, mementos for non-obvious findings, posts to #${CHANNEL}. English. Register a lineage identity ('conversations agents register') named recordings-bar-<your-role>.
- Repo laws: ${MONOREPO}/AGENTS.md + .claude/rules/. Frozen review scope: the successor addresses ONLY the named defect classes + their direct regressions + the signing support; do not relitigate unrelated findings.
- Distinguish measured vs inferred; state what you did not check. Plain register.
`

const FIX_BAR = CONST + `
ROLE: fixer — bar-only candidate (Sonnet). PR title 'fix(recordings): bar-only successor — build variant, windowless smoke, signing'. Worktree: ~/.hasna/repos/worktrees/apps/fix-recordings-bar (task ${TASK}).
The terminated candidate (PR #269) failed three reviews on these P1 classes — your materially-new candidate must fix ALL of them, regression tests FIRST (add the failing test, see it fail, then fix):
1. **run_swift empty-array abort**: scripts/build.sh run_swift expands an empty "\${variant_flags[@]}" under set -u, aborting EVERY macOS build. Fix: guard the array expansion (e.g. "\${variant_flags[@]+"\${variant_flags[@]}"}") and add a regression that builds/runs run_swift with no variant flags under set -u (bash-level test, Linux-runnable: source the function or extract the guard into a testable form) — and a second regression with the bar variant set.
2. **Windowless-branch runtime smoke**: the windowless branch keyed on declaresMainWindow fails deterministically in the full-app runtime smoke. Read src/native/Recordings (App/RecordingsApp.swift + MenuBarPresentation.swift + RuntimeSmoke.swift): implement bar-only so the app launches with NO workspace window and a LIVE menu bar (the real launch path must pass the variant — see 3), and the smoke (RuntimeSmoke or a new smoke target, Linux-runnable parts + named macOS proofs) passes in bar mode. The menu bar must keep: record controls (fn/fn-hold global shortcut via FnKeyMonitor — needs Accessibility), live transcription, paste delivery, settings.
3. **Variant wiring + release rejection**: the build/install path must actually pass the variant through: scripts/build.sh consumes the variant (e.g. RECORDINGS_VARIANT=bar or the equivalent flag) AND rejects the bar variant in release mode unless the artifact is explicitly marked (manifest/variant verification wired into the install path — macos_artifact.ts manifest verification must be invoked at install time, not just generated). Add the regression: release-mode bar build without an explicit mark FAILS; with the mark, the artifact carries the verified variant.
4. **Developer ID signing support** (the signing blocker is resolved — do not re-litigate the OU=unset cert): extend the build script so signing uses a Developer ID identity from the macOS keychain when available: read the signing identity from env (e.g. HASNA_CODESIGN_IDENTITY, default: discover via 'security find-identity -v -p codesigning' on the Mac and pick the Developer ID Application identity), codesign the bundle with it (--options runtime if a hardened-runtime profile exists), keep 'codesign --verify --deep --strict' as the gate. The notes app proved the flow (TeamIdentifier HKZ326A8Y3, keychain on station03, unlocked via vault item hasna/office/apple03/sudo/password (consumed via secrets exec) — the ship lane handles the keychain unlock; your job is the script support: identity env, verify gate, fail loudly if signing is requested but no identity is found — never silently ad-hoc when a Developer ID is requested).
5. Keep the bar artifact named per the fleet naming rule: HasnaRecordingsBar.app? NO — check the naming rule (knowledge k_msxd5rz3_jfvl3i: Hasna<Name>.app). The bar-only artifact should be HasnaRecordings.app (the app's name under the rule; the 'bar' is the variant, not a separate app name). Coordinate the bundle naming with the rule: bundle id stays com.hasna.recordings (TCC grants key on it), display name 'Hasna Recordings'.
6. Validation you can run on Linux: bash -n on the scripts, the JS/TS test suites (bun test apps/recordings), the new bash regressions; list exactly what must be proven on macOS (swift build, windowless launch, menu bar presence, fn-hold, TCC).
7. Do NOT bump the npm version unless the fix requires package.json changes (the 0.3.1 package is published); if you must touch package.json, add a changeset (patch) and say so.
Return (JSON): { prUrl, headSha, branch, changed: [string], tests: {lanes, passed, failed}, regressionTests: [string], changeset: boolean, macosProofs: [string], followUps: [string] }
`

const REVIEW_BAR = CONST + `
ROLE: adversarial reviewer (Fable). You have NOT done this work; review it adversarially. PR: {PR_BLOCK}.
Frozen scope: the successor addresses the three named P1 classes (run_swift empty-array abort; windowless-branch runtime smoke; variant wiring + release rejection) + Developer ID signing support + their direct regressions. Review that scope adversarially; do not expand the review to unrelated pre-existing findings (those are already tracked elsewhere).
Verdict format: post as a PR comment first line '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: bar-successor+signing, reviewer recordings-bar-review (1 of 1)', plus a post to #${CHANNEL}.
Scope checks: (a) each of the three P1 classes has a regression test that fails-before/passes-after (run the bash regressions + the JS/TS suites in a scratch worktree; name what can only run on macOS and whether it blocks GO); (b) the bar-only launch path is genuinely windowless with a live menu bar (read the scene graph — the real launch path must pass the variant; a flag that no launch uses is the exact cycle-0 defect — reject it); (c) release-mode bar builds without an explicit mark are rejected; (d) signing: Developer ID support is env-driven, fails loudly when signing is requested but no identity exists, never silently ad-hoc; no credential material in the diff; (e) secrets scan clean on the diff; changes confined to ${APP}. Block ONLY concrete, evidence-backed, currently reachable, in-scope P0/P1 defects. P2/P3 non-blocking. Name exactly what must be proven at ship/live-test time and whether it blocks GO.
Return (JSON): { verdict: 'GO'|'NO_GO', prUrl, sha, findings: [{severity, title, detail}], shipProofsNeeded: [string] }
`

const SHIP_BAR = CONST + `
ROLE: ship + install + live test (Sonnet). You act only after the review returns GO (below). If the lane is exhausted/NO_GO, DO NOT build/install — report and stop.
Order of operations (all mandatory):
1. Merge the PR at its exact reviewed head: gh pr merge <n> --squash --body-file <file whose LAST line is 'Agent: recordings-bar-ship'>. Record the merged sha. If a changeset was added, run 'bunx changeset version' in ${MONOREPO} and commit via a worktree PR (same trailer); announce on git-publishing BEFORE any publish and confirm after (only if the version changed — the 0.3.1 package is already published; if the successor did not touch package.json there is nothing to publish).
2. station03 (macOS, reachable): (a) ssh hasna@station03: git -C ~/workspace/repos/hasna/apps pull (sync first); (b) BACKUP + REMOVE the full app FIRST, per the owner directive (hasna/backup: 'backup sources add /Applications/Recordings.app --name recordings-macos-app-station03' + 'backup run' + 'backup reconcile' verify, then remove the bundle — the deploy flow or a direct removal; also probe station06/station07 (bounded: ssh with 10s timeout; earlier probes were permission-denied — record '?' with the exact error if unreachable) and do the same where reachable; if the app is NOT installed on a station, say exactly that); (c) BUILD the bar on station03: cd ~/workspace/repos/hasna/apps/apps/recordings; run the build script with the bar variant + Developer ID signing: unlock the keychain with the notes-proven flow (vault item hasna/office/apple03/sudo/password (consumed via secrets exec) — secrets exec, never print; verify the identity 'security find-identity -v -p codesigning' shows the Developer ID Application identity, TeamIdentifier HKZ326A8Y3); install the bar bundle to /Applications/HasnaRecordings.app; verify codesign --verify --deep --strict rc=0 + the TeamIdentifier; (d) LIVE TEST (declared stop condition): the bar process is up after 60s, the menu bar item exists (process + accessibility evidence), the app's log shows no workspace window (windowless), 'recordings --version' matches (0.3.1), and a recording attempt via the fn-hold shortcut starts (record via the CLI against the store as the fallback proof: 'recordings record' or a saved test). TCC: Microphone + Accessibility prompts may appear (owner approves — record pending-approval, do NOT count as FAIL). PASS = all green; FAIL = crash, missing bar, window present, version mismatch; on FAIL fix (root cause) and re-test — at most 3 fix-retest cycles; on exhaustion STOP and report the live failure verbatim.
3. station04 (macOS, now reachable): same backup/remove (if the full app is installed there — probe first) + build/install the bar. If any step fails with a real blocker, record and file the follow-up rather than burning cycles.
4. Todos: comment final state on ${TASK} (merged sha, build+sign evidence, backup receipts, live-test evidence, TCC state); mementos; posts to #${CHANNEL} and the git-publishing thread if anything published.
Return (JSON): { mergedShas: [string], publishedVersion: string|null, stations: [{id, state, version, evidence}], backup: {foundWhere: [string], backedUp: [string], removed: [string]}, liveTest: {state: pass|fail|pending, detail}, tcc: {state: string}, followUps: [string] }
Review: {REVIEW_BAR}
`

const HARVEST_BAR = CONST + `
ROLE: harvest (Opus, independent — you did not do the work). Create your harvest row in the open-recordings project (task ${TASK}'s project), comment each of the five categories on it the moment it is decided (skills/todos/mementos/knowledge/files — create/update/none + reason; dedupe first; 'none' is complete). Read the record: ${TASK} comments, the PR + review, the ship report (below), #${CHANNEL}.
Categories:
- SKILLS: repeated procedures worth a skill (Developer-ID macOS app build+sign+install recipe — proven twice now (notes + recordings); bar-only variant build)?
- TODOS: what surfaced nobody filed (station06/07 app removal, TCC state, naming rule render 70931686, contract conformance 32336d85)?
- MEMENTOS: what the next agent would re-learn at full cost?
- KNOWLEDGE: ratifiable doctrine (bar-only architecture as-built, Developer ID keychain flow, signing contract resolution)?
- FILES: artefacts for hasna/files rather than scratch (investigation reports, backup receipts)?
Close the row completed only after all five categories are commented.
Return (JSON): { categories: {skills: {decision, reason, rowId|null}, todos: {...}, mementos: {...}, knowledge: {...}, files: {...}} }
Ship report: {SHIP_BAR}
`

const FIX_SCHEMA = {
  type: 'object',
  properties: {
    prUrl: { type: 'string' }, headSha: { type: 'string' }, branch: { type: 'string' },
    changed: { type: 'array', items: { type: 'string' } },
    tests: { type: 'object', properties: { lanes: { type: 'array', items: { type: 'string' } }, passed: { type: 'integer' }, failed: { type: 'integer' } } },
    regressionTests: { type: 'array', items: { type: 'string' } },
    changeset: { type: 'boolean' },
    macosProofs: { type: 'array', items: { type: 'string' } },
    followUps: { type: 'array', items: { type: 'string' } },
  },
  required: ['prUrl', 'headSha', 'branch', 'changed', 'tests', 'followUps'],
}
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['GO', 'NO_GO'] },
    prUrl: { type: 'string' }, sha: { type: 'string' },
    findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string' }, title: { type: 'string' }, detail: { type: 'string' } }, required: ['severity', 'title', 'detail'] } },
    shipProofsNeeded: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdict', 'prUrl', 'sha', 'findings'],
}
const SHIP_SCHEMA = {
  type: 'object',
  properties: {
    mergedShas: { type: 'array', items: { type: 'string' } },
    publishedVersion: { type: ['string', 'null'] },
    stations: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, state: { type: 'string' }, version: { type: 'string' }, evidence: { type: 'string' } }, required: ['id', 'state', 'evidence'] } },
    backup: { type: 'object', properties: { foundWhere: { type: 'array', items: { type: 'string' } }, backedUp: { type: 'array', items: { type: 'string' } }, removed: { type: 'array', items: { type: 'string' } } } },
    liveTest: { type: 'object', properties: { state: { type: 'string' }, detail: { type: 'string' } } },
    tcc: { type: 'object', properties: { state: { type: 'string' } } },
    followUps: { type: 'array', items: { type: 'string' } },
  },
  required: ['mergedShas', 'stations', 'backup', 'liveTest', 'followUps'],
}
const HARVEST_SCHEMA = {
  type: 'object',
  properties: {
    categories: {
      type: 'object',
      properties: {
        skills: { type: 'object', properties: { decision: { type: 'string' }, reason: { type: 'string' }, rowId: { type: ['string', 'null'] } } },
        todos: { type: 'object', properties: { decision: { type: 'string' }, reason: { type: 'string' }, rowId: { type: ['string', 'null'] } } },
        mementos: { type: 'object', properties: { decision: { type: 'string' }, reason: { type: 'string' }, rowId: { type: ['string', 'null'] } } },
        knowledge: { type: 'object', properties: { decision: { type: 'string' }, reason: { type: 'string' }, rowId: { type: ['string', 'null'] } } },
        files: { type: 'object', properties: { decision: { type: 'string' }, reason: { type: 'string' }, rowId: { type: ['string', 'null'] } } },
      },
      required: ['skills', 'todos', 'mementos', 'knowledge', 'files'],
    },
  },
  required: ['categories'],
}

phase('Fix')
let fix = await agent(FIX_BAR, { label: 'fix-bar', phase: 'Fix', schema: FIX_SCHEMA, model: 'sonnet' })
let lastReview = null
let exhausted = false
if (fix) {
  for (let cycle = 0; cycle < 3; cycle++) {
    lastReview = await agent(REVIEW_BAR.replace('{PR_BLOCK}', JSON.stringify(fix)), {
      label: `review-bar:cycle-${cycle}`, phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable',
    })
    if (!lastReview) { exhausted = true; break }
    if (lastReview.verdict === 'GO') break
    if (cycle === 2) { exhausted = true; break }
    const blocking = lastReview.findings.filter(f => f.severity === 'P0' || f.severity === 'P1')
    if (!blocking.length) break
    fix = await agent(FIX_BAR + `\nREVIEWER FINDINGS TO REMEDIATE (cycle ${cycle + 1}): address ONLY these named defects and their direct regressions: ${JSON.stringify(blocking)}. Return the same schema.`, {
      label: `fix-bar:remediate-${cycle + 1}`, phase: 'Fix', schema: FIX_SCHEMA, model: 'sonnet',
    })
    if (!fix) { exhausted = true; break }
  }
}
log(`bar lane: verdict=${lastReview ? lastReview.verdict : 'NO-VERDICT'} exhausted=${exhausted}`)

phase('Ship')
let ship = null
if (fix && lastReview && !exhausted && lastReview.verdict === 'GO') {
  ship = await agent(SHIP_BAR.replace('{REVIEW_BAR}', JSON.stringify(lastReview)), {
    label: 'ship-bar', phase: 'Ship', schema: SHIP_SCHEMA, model: 'sonnet',
  })
} else {
  log('SHIP SKIPPED — bar lane not GO')
}

phase('Harvest')
const harvest = await agent(HARVEST_BAR.replace('{SHIP_BAR}', JSON.stringify(ship || { ship: null })), {
  label: 'harvest-bar', phase: 'Harvest', schema: HARVEST_SCHEMA, model: 'opus',
})

return { fix, review: lastReview, exhausted, ship, harvest }
