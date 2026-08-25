export const meta = {
  name: 'terminal-release',
  description: 'Release @hasna/terminal 4.3.19: version bump past the registry-protected 4.3.18 slot, codewith review of the new candidate, publish, install, live test',
  phases: [
    { title: 'Release', detail: 'changeset 4.3.18 -> 4.3.19, suite, secrets, publish-intent, codewith release review, npm publish, install, live test' },
    { title: 'Report', detail: 'final state' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const TASK = '248f6ed8-d849-48ce-912c-1e7c5d8e69f0'

const CONST = `
You are a lane of the terminal-release workflow (task ${TASK}). The publish-all lane skipped @hasna/terminal 4.3.18: the npm registry slot is PROTECTED (the version was published in the standalone-repo era and fully unpublished 2026-08-15 — E400 'Cannot publish over previously published version' even though the package 404s). The review chain for 4.3.18 completed (GO at the merged head) but publishing a DIFFERENT version is a materially new candidate requiring its own review. This lane: bump to 4.3.19, review the exact 4.3.19 candidate, publish, install, live test. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull; never discard local work). Work in the task worktree ~/.hasna/repos/worktrees/apps/terminal-release from origin/main. Never push to main. Merge ONLY via gh pr merge --squash --body-file <file whose LAST line is 'Agent: terminal-release'>.
- IDEMPOTENCY CHECK FIRST: npm view @hasna/terminal version — if 4.3.19 (or higher) is published with a GO review on record, skip to install.
- CAPACITY RULE: if the codewith review run exits with 'Selected model is at capacity', do NOT retry the same account — sweep ~/.codewith/auth_profiles for a healthy profile (codewith usage --auth-profile <p> | grep Healthy) and re-run there (record the switch). Two capacity failures on different accounts = review-unavailable -> SKIP (never publish unreviewed).
- No secrets: never print/capture/commit credential values; consume ONLY via 'secrets exec <key> --as VAR -- <cmd>'. No internal-infra strings. Staged secrets scan before every commit/push (rc 0 clean).
- Capture path: redirect to files, read both + $?; never pipe large reads. Paste literal output lines.
- Record as you go: comments on ${TASK}, posts to #board. English. Lineage identity 'conversations agents register' named terminal-release.
`

const RELEASE = CONST + `
ROLE: release lane (Sonnet). Release @hasna/terminal 4.3.19:
1. IDEMPOTENCY CHECK FIRST (see CONST).
2. In a worktree from origin/main: apply the changeset — bump apps/terminal/package.json 4.3.18 -> 4.3.19 (patch only; the terminal app is a major-versioned app whose patch discipline is the app's own — 4.3.x is its current line, keep the patch bump). Run the terminal suite (bounded 10 min), secrets scan staged (rc 0), commit (conventional, 'Agent: terminal-release' trailer LAST), push, open the release PR, merge it (gh pr merge --squash --body-file trailer). Verify the merged head sha.
3. POST publish intent to git-publishing BEFORE publishing: '@hasna/terminal@4.3.19 — version bump past the registry-protected 4.3.18 slot' + one-line changelog. Confirm in-thread after.
4. INDEPENDENT RELEASE REVIEW (mandatory): dispatch ONE Fable agent to adversarially review the EXACT 4.3.19 candidate — repo hasna/apps, merged head sha, package @hasna/terminal, version 4.3.19, registry npmjs. Reviewer must NOT be the publisher. Verdict posted as a PR comment '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: npm release 4.3.19, reviewer terminal-release-review'. Scope: the release diff (version bump + changelog), package.json coherence, secrets scan, no internal-infra strings, suite result. Publish ONLY after GO.
5. Publish: NPMRC=$(mktemp); chmod 600; printf '//registry.npmjs.org/:_authToken=\${NODE_AUTH_TOKEN}\\n' > "$NPMRC"; secrets exec hasna/npm/live/publish-token --as NODE_AUTH_TOKEN -- npm publish --userconfig "$NPMRC" --access public; rm -f "$NPMRC". Two-sided verify: npm view @hasna/terminal version == 4.3.19; npm view time --json fresh. Negative control first: 4.3.19 was NOT published before.
6. Add @hasna/terminal to minimumReleaseAgeExcludes in ~/.bunfig.toml if absent (exact names only), then bun install -g @hasna/terminal@4.3.19 on station01 (+ 03/04 if reachable). Verify the installed version.
7. Live test: terminal --version == 4.3.19; terminal --help rc 0; one read-only verb smoke.
Return (JSON): { version: '4.3.19', published: bool, reviewVerdict: string|null, releaseHead: string, installed: {station01: string|null, station03: string|null}, liveTest: {state: string, version: string|null} }
`

const REPORT = CONST + `
ROLE: report. Final state: published version, review verdict, installs, live test. Comment on ${TASK}, post one line to #board.
Return (JSON): { version: string, published: bool, reviewVerdict: string|null, liveTestState: string|null, followUps: [string] }
`

const RELEASE_SCHEMA = { type: 'object', properties: { version: { type: 'string' }, published: { type: 'boolean' }, reviewVerdict: { type: ['string', 'null'] }, releaseHead: { type: 'string' }, installed: { type: 'object' }, liveTest: { type: 'object' } }, required: ['published'] }
const REPORT_SCHEMA = { type: 'object', properties: { version: { type: 'string' }, published: { type: 'boolean' }, reviewVerdict: { type: ['string', 'null'] }, liveTestState: { type: ['string', 'null'] }, followUps: { type: 'array' } }, required: ['published'] }

phase('Release')
const release = await agent(RELEASE, { label: 'terminal-release', phase: 'Release', schema: RELEASE_SCHEMA, model: 'sonnet' })

phase('Report')
const report = await agent(REPORT, { label: 'terminal-report', phase: 'Report', schema: REPORT_SCHEMA, model: 'sonnet' })

return { release, report }
