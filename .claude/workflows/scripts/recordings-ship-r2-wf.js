export const meta = {
  name: 'recordings-ship-r2',
  description: 'Remediation for the recordings bar ship: fix the hardcoded hasna.xyz URL bug (21a3b267), re-review, publish 0.3.2, Developer ID bar build+install on station03, legacy bundle backup+remove, live test at the TCC boundary',
  phases: [
    { title: 'Fix', detail: 'client.ts:62 config-driven URL resolution, regression test, same-reviewer re-review' },
    { title: 'Release', detail: 'publish @hasna/recordings@0.3.2 (intent 710489 stands), install 01+03' },
    { title: 'MacBuild', detail: 'station03 Developer ID bar build (login keychain identity, record deviation from _recordingsbuild requirement)' },
    { title: 'MacInstall', detail: 'backup+remove the legacy 0.1.0 full bundle via hasna/backup, install the bar' },
    { title: 'LiveTest', detail: 'windowless launch, menu bar, Fn-hold; stops at TCC boundary' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const TASK = '4ee4ebbf-9a10-4181-8e43-9307d56e684b'

const CONST = `
You are a lane of the recordings-ship-r2 workflow (task ${TASK}). The owner's outcome: fix @hasna/recordings + the macOS bar, backup+remove the full macOS app keeping ONLY the bar, install on station03 (station04 later). PR #373 merged; the first ship lane hit one P1: apps/recordings/src/http/client.ts:62 hardcodes 'https://\${name}.hasna.xyz' (an internal-infra URL pattern) and it ships in the published 0.3.1 tarball (bug 21a3b267). This lane: fix that bug (config-driven URL resolution, no internal-infra string), same-reviewer re-review (rec-ship-review), publish 0.3.2, then the Developer ID bar build on station03 using the VERIFIED-present login keychain identity (Developer ID Application: VASILE ANDREI HASNA (HKZ326A8Y3) — the same flow that shipped HasnaNotes.app; the build's isolated _recordingsbuild identity does not exist on station03, record that deviation), backup+remove the legacy 0.1.0 full bundle (~/.hasna/recordings/Recordings.app) via hasna/backup, install the bar, live test stopping at the TCC boundary. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull; never discard local work). Work in the task worktree ~/.hasna/repos/worktrees/apps/recordings-ship-r2 from origin/main. Never push to main. Force-push (--force-with-lease) ONLY on the PR's own branch. Merge ONLY via gh pr merge --squash --body-file <file whose LAST line is 'Agent: rec-ship-r2-<your-role>'>.
- IDEMPOTENCY CHECK FIRST: npm view @hasna/recordings version — if 0.3.2 (or higher) is published AND the client.ts fix is on record (bug 21a3b267 closed), skip to install. If the bar is already installed on station03 with live-test evidence, skip build/install.
- No secrets: never print/capture/commit credential values; consume ONLY via 'secrets exec <key> --as VAR -- <cmd>'. No internal-infra strings in artifacts — THIS IS THE BUG CLASS: after the fix, grep the diff and the packed tarball for 'hasna.xyz' — zero occurrences. Staged secrets scan before every commit/push (rc 0 clean).
- Capture path: redirect to files, read both + $?; never pipe large reads. Paste literal output lines when reporting.
- Record as you go: comments on ${TASK}, posts to #board. English. Lineage identity 'conversations agents register' named rec-ship-r2-<your-role>.
- Remediation discipline: fix ONLY the named bug and its direct regressions; do not re-litigate reviewed content.
`

const FIX = CONST + `
ROLE: remediation fixer (Sonnet). Fix bug 21a3b267 in a worktree from origin/main (branch fix/recordings-url-resolution):
1. apps/recordings/src/http/client.ts:62 hardcodes the URL pattern 'https://\${name}.hasna.xyz'. Replace with config-driven resolution: a base-URL env var (follow the app's existing config conventions — check how the app resolves its API URL elsewhere, e.g. HASNA_RECORDINGS_API_URL or the existing config module) with a documented default that contains NO internal-infra string. Update any code that depends on the hardcoded shape.
2. Regression test FIRST: write the failing test (the URL must come from config; the source must contain no 'hasna.xyz'), see it fail, then fix.
3. Run the affected tests (bounded 8 min). Secrets scan staged (rc 0). Grep the FULL source tree for 'hasna.xyz' — zero occurrences outside test fixtures that assert its absence (or none at all). Commit (conventional, 'Agent: rec-ship-r2-fix' trailer LAST), push, open the PR, merge it (--body-file trailer). Verify the merged head sha.
4. Also verify the PACKED tarball is clean: npm pack --dry-run and grep the packed file list/content for 'hasna.xyz' — zero.
Return (JSON): { pr: {number, mergedSha}, urlConfig: string, sourceClean: bool, tarballClean: bool, tests: {passed, failed} }
`

const RELEASE = CONST + `
ROLE: release lane (Sonnet). Release @hasna/recordings 0.3.2 (the merged fix is on main):
1. IDEMPOTENCY CHECK FIRST (see CONST).
2. In a worktree from origin/main: apply the changeset (patch bump 0.3.1 -> 0.3.2), run the recordings suite with RECORDINGS_TEST_TIMEOUT_MS=300000 (bounded 16 min), secrets scan staged (rc 0), commit ('Agent: rec-ship-r2-release' trailer LAST), push, open the release PR, merge (--body-file trailer).
3. Publish intent ALREADY STANDS (git-publishing 710489, held at 710501) — confirm in-thread with the final version before publishing.
4. INDEPENDENT RELEASE REVIEW (mandatory): dispatch ONE Fable agent to adversarially review the EXACT 0.3.2 candidate — repo hasna/apps, merged head sha, package @hasna/recordings, version 0.3.2, registry npmjs. Reviewer must NOT be the publisher. Verdict posted as a PR comment '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: npm release 0.3.2, reviewer rec-ship-review' (same reviewer role as the first ship lane). Scope: the release diff (URL-resolution fix + version bump), package.json coherence, secrets scan, ZERO 'hasna.xyz' in source and packed tarball, suite result. Publish ONLY after GO.
5. Publish: NPMRC=$(mktemp); chmod 600; printf '//registry.npmjs.org/:_authToken=\${NODE_AUTH_TOKEN}\\n' > "$NPMRC"; secrets exec hasna/npm/live/publish-token --as NODE_AUTH_TOKEN -- npm publish --userconfig "$NPMRC" --access public; rm -f "$NPMRC". Two-sided verify: npm view @hasna/recordings version == 0.3.2; npm view time --json fresh. Negative control first: 0.3.2 was NOT published before.
6. Add @hasna/recordings to minimumReleaseAgeExcludes in ~/.bunfig.toml if absent (exact name), then bun install -g @hasna/recordings@0.3.2 on station01 AND station03. Verify the installed version on each.
Return (JSON): { version: '0.3.2', published: bool, reviewVerdict: string|null, releaseHead: string, installed: {station01: string|null, station03: string|null} }
`

const MACBUILD = CONST + `
ROLE: station03 build lane (Sonnet). Build the Developer ID signed bar on station03:
1. IDEMPOTENCY CHECK FIRST: if the bar is already installed (MacInstall evidence), skip.
2. SSH to station03 (ssh station03, BatchMode). The package @hasna/recordings@0.3.2 must be installed there (Release lane; verify with grep version ~/.bun/install/global/node_modules/@hasna/recordings/package.json).
3. Signing: the Developer ID 'Developer ID Application: VASILE ANDREI HASNA (HKZ326A8Y3)' is VERIFIED present in the station03 login keychain. The build's release mode wants an isolated '_recordingsbuild' identity which does NOT exist on station03 — use the login keychain identity instead (the same flow that shipped HasnaNotes.app) and RECORD THE DEVIATION in the task comment. The keychain may need unlocking — resolve the station's login credential via 'secrets search' (masked discovery) and consume ONLY via 'secrets exec <key> --as <VAR> -- <command>'. Never print the value. If no usable credential resolves, STOP and report the exact missing key.
4. Run the bar build: the package's scripts/build.sh with --variant bar, HASNA_CODESIGN_IDENTITY=HKZ326A8Y3, RECORDINGS_SIGNING_REQUIRED=1 (hard-fail on ad-hoc fallback).
5. Verify: codesign --verify --deep --strict <bar.app> passes; spctl --assess passes; the bar carries the RECORDINGS_RELEASE_BAR_VARIANT_MARKED=1 release marker where the build defines it.
Return (JSON): { built: bool, artifactPath: string|null, codesignVerify: bool, spctlAssess: bool|null, identityUsed: string, deviation: string }
`

const MACINSTALL = CONST + `
ROLE: station03 install lane (Sonnet).
1. IDEMPOTENCY CHECK FIRST: if the bar is already installed and launching, skip.
2. Backup discipline (owner instruction: 'back it up via hasna/backup app'): the legacy 0.1.0 full bundle sits at ~/.hasna/recordings/Recordings.app (data-dir state). Back it up via the hasna/backup CLI FIRST, then remove it. If any /Applications/Recordings.app exists, back that up too, then remove. Record what was backed up and where.
3. Install the bar via the package's install_macos_app.sh --variant bar (same signing env as MacBuild). Verify the bar at its canonical location.
4. Verify launch registration: login item / launchctl entry exists (per the app's design).
Return (JSON): { installed: bool, barPath: string, legacyBackedUp: bool, legacyBackupLocation: string|null, fullAppRemoved: bool, launchRegistration: string|null }
`

const LIVETEST = CONST + `
ROLE: station03 live-test lane (Sonnet).
1. Launch the installed bar on station03 (open the bar app). TCC prompts (Accessibility/Microphone on com.hasna.recordings) will appear — the OWNER approves them; the lane MUST NOT auto-approve, must not click dialogs, must not disable TCC. Launch and wait (bounded 2 min) for the owner's approval if a prompt is pending; if none appears, proceed.
2. Verify: bar process running (pgrep + ps -o pid,etime,time), menu bar item present (the bar's own runtime state), ZERO windows (windowless launch contract).
3. Record on ${TASK}: launch evidence + whether a TCC approval is still pending from the owner.
Return (JSON): { launched: bool, processAlive: bool, menuBarPresent: bool|null, zeroWindows: bool|null, tccPendingOwnerApproval: bool }
`

const FIX_SCHEMA = { type: 'object', properties: { pr: { type: 'object' }, urlConfig: { type: 'string' }, sourceClean: { type: 'boolean' }, tarballClean: { type: 'boolean' }, tests: { type: 'object' } }, required: ['sourceClean'] }
const RELEASE_SCHEMA = { type: 'object', properties: { version: { type: 'string' }, published: { type: 'boolean' }, reviewVerdict: { type: ['string', 'null'] }, releaseHead: { type: 'string' }, installed: { type: 'object' } }, required: ['published'] }
const BUILD_SCHEMA = { type: 'object', properties: { built: { type: 'boolean' }, artifactPath: { type: ['string', 'null'] }, codesignVerify: { type: 'boolean' }, spctlAssess: { type: ['boolean', 'null'] }, identityUsed: { type: 'string' }, deviation: { type: 'string' } }, required: ['built'] }
const INSTALL_SCHEMA = { type: 'object', properties: { installed: { type: 'boolean' }, barPath: { type: 'string' }, legacyBackedUp: { type: 'boolean' }, legacyBackupLocation: { type: ['string', 'null'] }, fullAppRemoved: { type: 'boolean' }, launchRegistration: { type: ['string', 'null'] } }, required: ['installed'] }
const LIVETEST_SCHEMA = { type: 'object', properties: { launched: { type: 'boolean' }, processAlive: { type: 'boolean' }, menuBarPresent: { type: ['boolean', 'null'] }, zeroWindows: { type: ['boolean', 'null'] }, tccPendingOwnerApproval: { type: 'boolean' } }, required: ['launched'] }

phase('Fix')
const fix = await agent(FIX, { label: 'rec-r2-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'sonnet' })

phase('Release')
const release = await agent(RELEASE, { label: 'rec-r2-release', phase: 'Release', schema: RELEASE_SCHEMA, model: 'sonnet' })

phase('MacBuild')
const build = await agent(MACBUILD, { label: 'rec-r2-build', phase: 'MacBuild', schema: BUILD_SCHEMA, model: 'sonnet' })

phase('MacInstall')
const install = await agent(MACINSTALL, { label: 'rec-r2-install', phase: 'MacInstall', schema: INSTALL_SCHEMA, model: 'sonnet' })

phase('LiveTest')
const live = await agent(LIVETEST, { label: 'rec-r2-live', phase: 'LiveTest', schema: LIVETEST_SCHEMA, model: 'sonnet' })

return { fix, release, build, install, live }
