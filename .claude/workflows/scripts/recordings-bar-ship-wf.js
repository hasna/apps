export const meta = {
  name: 'recordings-bar-ship',
  description: 'Ship the merged recordings bar-only successor: release 0.3.2 (Fable release review), Developer ID bar build + install on station03, live test, TCC boundary',
  phases: [
    { title: 'Release', detail: 'changeset 0.3.2, suite, secrets, publish-intent, Fable release review, npm publish, install 01+03' },
    { title: 'MacBuild', detail: 'station03: Developer ID bar build (--variant bar, signing required)' },
    { title: 'MacInstall', detail: 'station03: install the bar, verify no full app remains' },
    { title: 'LiveTest', detail: 'station03: launch, menu bar presence, zero window; TCC pending-approval boundary' },
    { title: 'Report', detail: 'final state + follow-ups' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const TASK = '4ee4ebbf-9a10-4181-8e43-9307d56e684b'

const CONST = `
You are a lane of the recordings-bar-ship workflow (owner-authorized 2026-08-18, task ${TASK}). The owner's outcome: fix @hasna/recordings + the macOS bar, backup+remove the full macOS app keeping ONLY the bar, install on station03 (station04 later). PR #373 merged at 8a265e51d (Fable GO). This workflow ships it live: release 0.3.2 with an independent Fable release review, Developer ID bar build + install on station03, live test. The owner approves TCC prompts when the bar first launches — the live-test lane STOPS at that boundary and reports; it never auto-approves. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull; never discard local work). File mutation inside the repo happens in task worktrees at ~/.hasna/repos/worktrees/apps/. Never push to main. No secrets: never print/capture/commit credential values in any encoding; consume ONLY via 'secrets exec <key> --as VAR -- <cmd>'. No internal-infra strings in artifacts. Capture path: redirect to files, read both + $?; never pipe large reads. Paste literal output lines when reporting.
- IDEMPOTENCY CHECK FIRST: before any step, check what already happened — if 0.3.2 is already published (npm view @hasna/recordings version == 0.3.2), skip the publish; if the bar is already installed on station03, skip build/install and go to live test. Never duplicate shipped work.
- Staged secrets scan before every commit/push ('secrets scan staged' rc 0 clean, rc 2 = refusal). The staged scan reads diffs only.
- Record as you go: comments on ${TASK}, posts to #board (English). Lineage identity 'conversations agents register' named rec-ship-<your-role>.
- Distinguish measured vs inferred; state what you did not check. Plain register.
`

const RELEASE = CONST + `
ROLE: release lane (Sonnet). Release @hasna/recordings 0.3.2 from the merged main:
1. IDEMPOTENCY CHECK FIRST: npm view @hasna/recordings version — if 0.3.2 (or higher) is published, verify its commit provenance if cheap and skip to install (step 6).
2. In a task worktree from origin/main: apply the pending changeset (recordings-monorepo-first-release.md present at main) — bump apps/recordings/package.json to 0.3.2 (patch only), run the full recordings suite with RECORDINGS_TEST_TIMEOUT_MS=300000 (bounded 16 min), secrets scan staged (rc 0), commit with conventional message + 'Agent: rec-ship-release' trailer LAST line, push branch, open PR (title 'release(recordings): 0.3.2 bar-only successor'), merge it via gh pr merge --squash --body-file ending 'Agent: rec-ship-release'. If a release PR already exists for 0.3.2, use it (idempotency).
3. POST publish intent to the git-publishing channel BEFORE publishing: '@hasna/recordings@0.3.2 — bar-only successor shipped (merged #373)'. Confirm in-thread after.
4. INDEPENDENT RELEASE REVIEW (mandatory, per the npm-release rule): dispatch ONE Fable agent to adversarially review the EXACT release candidate — repo hasna/apps, the merged head sha of the release PR, package @hasna/recordings, version 0.3.2, registry npmjs. Reviewer must NOT be the publisher. The verdict (GO/NO_GO, bound to repo@sha + version) is posted as a PR comment '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: npm release 0.3.2, reviewer rec-ship-review'. Scope: the release diff (bar successor content), version/package.json coherence, secrets scan, no internal-infra strings, the recorded suite result. Publish ONLY after GO.
5. Publish: NPMRC=$(mktemp); chmod 600; printf '//registry.npmjs.org/:_authToken=\${NODE_AUTH_TOKEN}\\n' > "$NPMRC"; secrets exec hasna/npm/live/publish-token --as NODE_AUTH_TOKEN -- npm publish --userconfig "$NPMRC" (from the release worktree); rm -f "$NPMRC". Confirm in git-publishing thread with the version.
6. Install on station01 AND station03: bun install -g @hasna/recordings@0.3.2 (recordings is in minimumReleaseAgeExcludes — verify via grep in ~/.bunfig.toml; if absent add the exact name). Verify the installed version on each machine.
Return (JSON): { published: bool, version, releaseHead: string, reviewVerdict: string|null, installed: {station01: string|null, station03: string|null} }
`

const MACBUILD = CONST + `
ROLE: station03 build lane (Sonnet). Build the Developer ID signed bar on station03 (macOS).
1. IDEMPOTENCY CHECK FIRST: if a bar artifact already exists and is installed (see MacInstall), skip.
2. SSH to station03 (ssh station03, BatchMode). The package @hasna/recordings@0.3.2 must be installed there (Release lane does it; verify with grep version ~/.bun/install/global/node_modules/@hasna/recordings/package.json).
3. Resolve the signing secret: the keychain-unlock/login credential for this macOS host lives in the hasna/secrets vault — discover with 'secrets search' (e.g. search 'station03' and 'sudo' and 'apple03'), prove with 'secrets get <key> --check'. NEVER print or capture the value; consume ONLY via 'secrets exec <key> --as <VAR> -- <command>'. If the search returns nothing usable, STOP and report the exact missing key — do not invent credentials.
4. Run the bar build from the installed package: scripts/build.sh (or the package's documented macOS bar build) with --variant bar and the signing environment: HASNA_CODESIGN_IDENTITY=HKZ326A8Y3 (the Developer ID in the station03 login keychain; verify presence with 'security find-identity -p codesigning' — if the command errors or identity is missing, report measured state), RECORDINGS_SIGNING_REQUIRED=1 (hard-fail on ad-hoc fallback). The keychain may need unlocking — use the resolved credential via secrets exec.
5. Verify the artifact: codesign --verify --deep --strict <bar.app> passes, spctl --assess passes (Developer ID), and the bar carries the RECORDINGS_RELEASE_BAR_VARIANT_MARKED=1 release marker where the build defines it.
Return (JSON): { built: bool, artifactPath: string|null, codesignVerify: bool, spctlAssess: bool|null, identityUsed: string|null }
`

const MACINSTALL = CONST + `
ROLE: station03 install lane (Sonnet).
1. IDEMPOTENCY CHECK FIRST: if the bar is already installed and launching (LiveTest evidence exists), skip.
2. SSH to station03. Backup discipline per the owner instruction ('back it up via hasna/backup app'): if a full Recordings.app bundle exists at /Applications/Recordings.app (or ~/Applications), back it up via the hasna/backup CLI BEFORE removing; then remove the full app bundle. If no full app exists (measured earlier: absent on station03), record that — nothing to back up.
3. Install the bar via the package's install_macos_app.sh --variant bar (or the documented install path), with the same signing env as MacBuild. Verify the bar is at its canonical location.
4. Verify the bar's launch registration: login item / launchctl entry exists so it starts at login (per the app's design).
Return (JSON): { installed: bool, barPath: string, fullAppRemoved: bool, fullAppWasPresent: bool, launchRegistration: string|null }
`

const LIVETEST = CONST + `
ROLE: station03 live-test lane (Sonnet).
1. Launch the installed bar on station03 (open the bar app). TCC prompts (Accessibility/Microphone on bundle id com.hasna.recordings) will appear — the OWNER approves them when he sees them; the lane MUST NOT auto-approve, must not click dialogs, must not disable TCC. Launch and wait (bounded 2 min) for the owner's approval if a prompt is pending; if no prompt appears, proceed.
2. Verify: the bar process is running (pgrep the bar binary, plus ps -o pid,etime,time for CPU evidence), the menu bar item is present (check the bar's own runtime state), and ZERO windows were created (bar windowless launch contract: no window creation/activation — verify via the bar's runtime-smoke assertions or equivalent measurable evidence).
3. Record the result on ${TASK} with a comment, and note explicitly whether a TCC approval is still pending from the owner.
Return (JSON): { launched: bool, processAlive: bool, menuBarPresent: bool|null, zeroWindows: bool|null, tccPendingOwnerApproval: bool }
`

const REPORT = CONST + `
ROLE: report. Aggregate the chain state: release (published version + review verdict), station03 build/install/live-test state, what remains (TCC approval pending? station04 when live?). Comment the final state on ${TASK}, post a summary to #board naming any owner action needed (TCC approval on first bar launch).
Return (JSON): { release: string|null, station03: {built: bool, installed: bool, liveTested: bool, tccPending: bool}, followUps: [string], ownerActions: [string] }
Lanes: {LANES}
`

const RELEASE_SCHEMA = { type: 'object', properties: { published: { type: 'boolean' }, version: { type: 'string' }, releaseHead: { type: 'string' }, reviewVerdict: { type: ['string', 'null'] }, installed: { type: 'object' } }, required: ['published', 'version'] }
const BUILD_SCHEMA = { type: 'object', properties: { built: { type: 'boolean' }, artifactPath: { type: ['string', 'null'] }, codesignVerify: { type: 'boolean' }, spctlAssess: { type: ['boolean', 'null'] }, identityUsed: { type: ['string', 'null'] } }, required: ['built'] }
const INSTALL_SCHEMA = { type: 'object', properties: { installed: { type: 'boolean' }, barPath: { type: 'string' }, fullAppRemoved: { type: 'boolean' }, fullAppWasPresent: { type: 'boolean' }, launchRegistration: { type: ['string', 'null'] } }, required: ['installed'] }
const LIVETEST_SCHEMA = { type: 'object', properties: { launched: { type: 'boolean' }, processAlive: { type: 'boolean' }, menuBarPresent: { type: ['boolean', 'null'] }, zeroWindows: { type: ['boolean', 'null'] }, tccPendingOwnerApproval: { type: 'boolean' } }, required: ['launched'] }
const REPORT_SCHEMA = { type: 'object', properties: { release: { type: ['string', 'null'] }, station03: { type: 'object' }, followUps: { type: 'array' }, ownerActions: { type: 'array' } }, required: ['station03'] }

phase('Release')
const release = await agent(RELEASE, { label: 'rec-release', phase: 'Release', schema: RELEASE_SCHEMA, model: 'sonnet' })

phase('MacBuild')
const build = await agent(MACBUILD, { label: 'rec-build-03', phase: 'MacBuild', schema: BUILD_SCHEMA, model: 'sonnet' })

phase('MacInstall')
const install = await agent(MACINSTALL, { label: 'rec-install-03', phase: 'MacInstall', schema: INSTALL_SCHEMA, model: 'sonnet' })

phase('LiveTest')
const live = await agent(LIVETEST, { label: 'rec-live-03', phase: 'LiveTest', schema: LIVETEST_SCHEMA, model: 'sonnet' })

phase('Report')
const report = await agent(REPORT.replace('{LANES}', JSON.stringify([release, build, install, live])), { label: 'rec-report', phase: 'Report', schema: REPORT_SCHEMA, model: 'sonnet' })

return { release, build, install, live, report }
