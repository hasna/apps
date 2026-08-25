export const meta = {
  name: 'secrets-chrome-extension',
  description: 'SHIP the Chrome extension password manager in apps/secrets (owner ask 2026-08-19, task 43288442): LastPass-like vault access in Google Chrome, reuses local auth (never re-asks when the local session exists), detects the active website, per-site password labels; merged PR, packaged extension, live-tested in a real browser, install path for the owner',
  phases: [
    { title: 'Architect', detail: 'inspect the existing apps/secrets/extension dir first; design MV3 + native-messaging host protocol (secrets CLI verbs), TDD plan' },
    { title: 'Build', detail: 'TDD: host protocol + site-detection/form-fill tests first, implement, bun run check, PR-first' },
    { title: 'Review', detail: 'Fable adversarial review' },
    { title: 'Ship', detail: 'merge reviewed PR, package the extension, resolve a real browser, install native host' },
    { title: 'LiveTest', detail: 'declared stop condition: load, auth-reuse, site detection, add-login, autofill — 3 fix-retest cycles bound' },
    { title: 'Report', detail: 'owner install path + task 43288442 + #board + mementos' },
  ],
}

const TASK = '43288442-9ade-4b7f-a981-f1a1d3976fdf'
const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const SECRETS = MONOREPO + '/apps/secrets'

const CONST = `
You are a lane of the secrets-chrome-extension workflow (2026-08-19, task ${TASK}, HIGH — OWNER SHIP ASK). Owner requirements, verbatim intent: a Chrome extension the owner installs in Google Chrome, acting like LastPass for his passwords — the passwords live in the secrets vault; it MUST check whether he is already authenticated locally and NOT ask him to authenticate again when he is (auth reuse); it MUST detect the website he is on (active tab URL); and he can add which website a password is for (per-site labels). DELIVERABLE: the extension ships — code merged in apps/secrets, packaged and installable, live-tested in a real browser, with the exact install path for the owner's Chrome. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/secrets-ext-<n> from origin/main. PR-first; never push to main. Commits end with 'Agent: secrets-ext-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: apps/secrets v0.3.0 ALREADY CONTAINS an 'extension/' directory — inspect it BEFORE designing/building (read its contents; reuse what exists; record what it is and what is missing). Check task ${TASK} comments and open PRs in hasna/apps touching apps/secrets for an existing extension lane before mutating anything.
- THE VAULT IS THE STORE: the secrets CLI already ships structured login items — 'secrets items add-login --title <t> --url <u> --username <u> --password <p>', 'items search', 'items get' — the extension is a UI over those, never a second password store.
- AUTH REUSE (the owner's core requirement): the extension reaches the vault through a NATIVE-MESSAGING HOST that shells the 'secrets' CLI with the user's own local session — so an already-authenticated local CLI means the extension never prompts. The host never holds, embeds, or echoes credential values; it forwards CLI stdout only through the message protocol. The extension bundle (manifest, JS, icons) MUST be credential-zero: no API keys, no tokens, no infra strings, no vault values, nothing that would fail a secrets scan of the packed artifact. If the CLI reports unauthenticated, the extension says so and offers the existing auth path — it does NOT invent its own auth.
- SITE DETECTION: the popup shows the active tab's origin; adding a login stores it with the URL (per-site label); autofill matches by origin. MV3 manifest (chrome.tabs, content script for form fill, popup UI). The content script fills only on explicit user action (click the fill button) — no silent auto-fill of forms.
- FAIL-CLOSED protocol: the native host answers bounded JSON messages (auth-status / search / get / add-login); any malformed message, unknown verb, or missing CLI yields an explicit error message to the popup, never silence. The host protocol is unit-tested.
- ${MONOREPO} repo laws: 'bun run check' passes (names + secrets + manifests + publish-guard + scope + deps gates); the extension dir carries no internal-infra strings (publish-guard scans the packed artifact).
- PUBLISH BOUNDARY: this workflow does NOT npm publish. If a @hasna/secrets version bump is needed for the native host, the Build phase prepares the changeset/version via PR and the report hands off to the publish-all lane (the ONLY publisher). 'bun install -g' of the host for the LIVE TEST may use the worktree build directly.
- No secrets: never print/capture/commit credential values; staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push — and scan the PACKED extension artifact before it is delivered. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on ${TASK}, posts to #board, mementos. English. Lineage 'conversations agents register' named secrets-ext-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const ARCHITECT = CONST + `
ROLE: architect lane (Opus). Per the CONST, DO NOT MUTATE. Establish:
1. INSPECT the existing ${SECRETS}/extension/ directory: list every file, read the manifest (if any), classify what exists (scaffold? working extension? docs?) and what is missing. Record the exact state.
2. DESIGN the deliverable: (a) MV3 extension structure (manifest.json, popup, content script, background service worker), (b) the native-messaging host: where it installs (the secrets package's own bin or a host dir under apps/secrets), its manifest registration (chrome-nativeMessaging registration file), and the exact host protocol (JSON messages: auth-status, search <term>, get <id>, add-login {title,url,username,password}; the host shells 'secrets items ...' and 'secrets get --check'-class verbs; values never leave the host protocol as logs), (c) auth-reuse flow: host auth-status verb maps to the CLI's authenticated state (name the exact CLI verb + rc that proves it) — when authenticated, the popup shows the vault list WITHOUT any prompt; when not, a clear 'not authenticated' state with the existing auth path, (d) site detection + autofill: chrome.tabs active-tab origin -> popup display + add-login URL field prefilled; content script fills username/password inputs only on explicit button click, (e) the TEST PLAN: which tests (host protocol unit tests, site-parsing tests, form-fill tests) and the LIVE TEST shape.
3. State any monorepo/manifest obligations (does hasna.contract.json need an extension surface entry? does 'bun run check' treat the extension dir?).
Return (JSON): { existingExtensionDir: {state: string, files: [string], manifest: string|null}, design: {extensionRoot: string, hostPath: string, hostProtocol: string, authStatusVerb: string, autofillModel: string}, testPlan: [string], manifestObligations: string, residue: [string] }
`

const BUILD = CONST + `
ROLE: build lane. Per the CONST + the architect's design: TDD FIRST — write the failing tests (host protocol: auth-status/search/get/add-login round-trips against a temp vault store; site parsing: origin extraction; form-fill: fills only on explicit action) — watch them fail, then implement in ${SECRETS}/extension (or the architect's named root) + the native host. Do NOT weaken: no silent auto-fill, no extension-local password storage, no embedded credentials. Run the app's suite + 'bun run check' in ${MONOREPO}. Secrets-scan the diff AND the packed artifact. If a @hasna/secrets version bump is owed for the host, prepare the changeset via PR. Commit ('Agent: secrets-ext-<your-role>'), push, open the PR referencing ${TASK}.
Return (JSON): { prNumber: number, diffSummary: string, regressionTests: [string], hostProtocolImplemented: bool, suiteCounts: {passed, failed}, checkPassed: bool, artifactScannedClean: bool, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review: (a) the extension is a UI over the secrets vault's login items (no second password store), (b) AUTH REUSE is real: authenticated-local means no prompt — via the native host shelling the CLI with the user's session, never embedded credentials, (c) the bundle is credential-zero and the packed artifact scanned clean, (d) site detection + per-site labels work as the owner asked, (e) autofill is explicit-action-only (no silent fill), (f) TDD proven (tests failed before the fix), (g) PR-first, monorepo checks pass, no direct pushes, (h) fail-closed host protocol. Post '[REVIEW] <GO|NO_GO> — secrets-chrome-extension @ <evidence> — lens: owner ship ask + credential-zero, reviewer secrets-ext-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship lane. Per the CONST + GO: 1. MERGE the reviewed PR (base-movement gate first: merge-tree vs head; then gh pr merge --squash --body-file ending 'Agent: secrets-ext-ship'). 2. PACKAGE the extension: zip the extension dir (deterministic name apps-secrets-vault-<version>.zip) into a delivery location under the monorepo dist/scratch and scan it (secrets scan input, rc 0). 3. RESOLVE A REAL BROWSER for the live test: try, in order — (a) chromium/chrome already installed here; (b) install chromium via apt (bounded 5 min); (c) a Chrome-bearing station over ssh (tailscale; station02 etc.). Record which route resolved. 4. INSTALL the native host: build the host from the worktree, place its registration in the resolved browser's native-messaging config path, verify 'secrets' CLI auth-status verb proves the local session. Deliver the extension load path (chrome://extensions -> Load unpacked -> <extension dir>) in the report.
Return (JSON): { mergedSha: string, artifactPath: string, artifactScanClean: bool, browserRoute: string, hostInstalled: bool, hostRegistrationPath: string, evidence: string }
`

const LIVETEST = CONST + `
ROLE: live-test lane. DECLARED STOP CONDITION (per the tier-1 phase model) — PASS requires ALL FIVE with literal evidence, FAIL names the failing one, bound 3 fix-retest cycles then STOP and report verbatim:
1. LOAD: the extension loads in the resolved browser with zero console errors (load unpacked, capture chrome://extensions + the popup opening).
2. AUTH-REUSE: with the local secrets CLI authenticated, the popup shows the vault list WITHOUT any authentication prompt (the owner's core requirement); negative control: with the CLI unauthenticated (temp env), the popup shows the clear not-authenticated state.
3. SITE DETECTION: on a test page (a local fixture page served on http://localhost:<port>), the popup displays the active tab's origin.
4. ADD-LOGIN: via the popup, add a login for the test site (title, url prefilled from detection, username, password) and confirm 'secrets items search' returns it.
5. AUTOFILL: the test page has a username/password form; clicking the fill button populates the fields from the vault entry; the form values match.
On PASS: record it. On FAIL: fix the root cause and re-test (same five), at most 3 cycles; on exhaustion STOP and report the live failure verbatim with what was tried.
Return (JSON): { loadOk: bool, authReuseOk: bool, siteDetectionOk: bool, addLoginOk: bool, autofillOk: bool, cyclesUsed: number, liveTestPassed: bool, resumeCondition: string|null, evidence: string }
`

const REPORT = CONST + `
ROLE: report. If GO + liveTestPassed: comment ${TASK} completed (merged sha, artifact path, live-test evidence, browser route), complete it, post the SHIP summary to #board (incl. the owner install path: the packaged zip + chrome://extensions Load-unpacked route + host install step), save a memento. If NO_GO or live test not passed: comment findings + resume condition, leave in_progress, post residue to #board.
Return (JSON): { taskState: string, installPath: string, residue: [string] }
`

const ARCH_SCHEMA = { type: 'object', properties: { existingExtensionDir: { type: 'object' }, design: { type: 'object' }, testPlan: { type: 'array' }, manifestObligations: { type: 'string' }, residue: { type: 'array' } }, required: ['existingExtensionDir', 'design', 'testPlan'] }
const BUILD_SCHEMA = { type: 'object', properties: { prNumber: { type: ['number', 'null'] }, diffSummary: { type: 'string' }, regressionTests: { type: 'array' }, hostProtocolImplemented: { type: 'boolean' }, suiteCounts: { type: 'object' }, checkPassed: { type: 'boolean' }, artifactScannedClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['diffSummary', 'hostProtocolImplemented'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { mergedSha: { type: 'string' }, artifactPath: { type: 'string' }, artifactScanClean: { type: 'boolean' }, browserRoute: { type: 'string' }, hostInstalled: { type: 'boolean' }, hostRegistrationPath: { type: 'string' }, evidence: { type: 'string' } }, required: ['mergedSha', 'artifactPath'] }
const LIVETEST_SCHEMA = { type: 'object', properties: { loadOk: { type: 'boolean' }, authReuseOk: { type: 'boolean' }, siteDetectionOk: { type: 'boolean' }, addLoginOk: { type: 'boolean' }, autofillOk: { type: 'boolean' }, cyclesUsed: { type: 'number' }, liveTestPassed: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['liveTestPassed'] }
const REPORT_SCHEMA = { type: 'object', properties: { taskState: { type: 'string' }, installPath: { type: 'string' }, residue: { type: 'array' } }, required: ['taskState'] }

phase('Architect')
const architect = await agent(ARCHITECT, { label: 'secrets-ext-architect', phase: 'Architect', schema: ARCH_SCHEMA, model: 'opus' })
log(`architect: ${architect && architect.existingExtensionDir ? 'existing dir state: ' + architect.existingExtensionDir.state.slice(0, 80) : 'FAILED'}`)

phase('Build')
let build = null
if (architect && architect.design && architect.design.extensionRoot) {
  build = await agent(BUILD, { label: 'secrets-ext-build', phase: 'Build', schema: BUILD_SCHEMA })
} else {
  build = { diffSummary: 'none — architect phase failed', hostProtocolImplemented: false }
}

phase('Review')
let review = null
if (build && build.diffSummary !== 'none — architect phase failed') {
  review = await agent(REVIEW, { label: 'secrets-ext-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P0', title: 'architect/build did not complete', detail: JSON.stringify({ architect, build }) }] }
}

phase('Ship')
let ship = null
if (review && review.verdict === 'GO') {
  ship = await agent(SHIP, { label: 'secrets-ext-ship', phase: 'Ship', schema: SHIP_SCHEMA })
} else {
  ship = { mergedSha: 'skipped — no GO', artifactPath: 'none' }
}

phase('LiveTest')
let livetest = null
if (ship && ship.mergedSha && ship.mergedSha !== 'skipped — no GO') {
  livetest = await agent(LIVETEST, { label: 'secrets-ext-livetest', phase: 'LiveTest', schema: LIVETEST_SCHEMA })
} else {
  livetest = { liveTestPassed: false, resumeCondition: 'ship did not complete', evidence: 'skipped' }
}

phase('Report')
const report = await agent(REPORT, { label: 'secrets-ext-report', phase: 'Report', schema: REPORT_SCHEMA })

return { architect, build, review, ship, livetest, report }
