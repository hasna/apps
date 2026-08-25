export const meta = {
  name: 'pr-monitor-exec',
  description: 'Execute todos plan pr-monitor (16b442a5): build repos pr-monitor verb + loop in one PR, Fable review, merge, publish, wire the 5-min loop, live test, harvest',
  phases: [
    { title: 'Build', detail: 'T1-T10 sequential lanes on one branch plan/pr-monitor, each task TDD-first with commit + trailer' },
    { title: 'Review', detail: 'Fable adversarial review of the combined PR (bounded, <=2 cycles)' },
    { title: 'Merge', detail: 'squash merge with attribution' },
    { title: 'Ship', detail: 'changeset patch bump, publish intent, npm publish, install, verify' },
    { title: 'Live', detail: 'wire the durable 5-min loop, live test on hasna/apps, harvest' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PLAN = '16b442a5'
const DESIGN = '/home/hasna/workspace/scratch/pr-monitor-plan/reports/pr-monitor-design.md'

const CONST = `
You are a lane of the pr-monitor-exec workflow (owner-authorized 2026-08-18, todos plan ${PLAN} 'PR Monitor'). The design doc is at ${DESIGN} — READ IT FIRST (it is the spec: capability spec, migration v15 schema, classification table, JSON envelope, acceptance criteria). All 14 tasks are filed under the plan; the plan's tasks T1-T10 build ONE combined PR (branch plan/pr-monitor) implementing the repos pr-monitor verb; T11 reviews+merges; T12 releases; T13 wires the 5-minute loop; T14 live-tests + harvests. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull; never discard local work). Work in the task worktree ~/.hasna/repos/worktrees/apps/pr-monitor from origin/main, branch plan/pr-monitor. Never push to main. Force-push (--force-with-lease) ONLY on plan/pr-monitor. Merge ONLY via gh pr merge --squash --body-file <file whose LAST line is 'Agent: pr-monitor-<your-role>'>.
- IDEMPOTENCY CHECK FIRST: for each task, check its todos status (todos show <id>) — already completed means the work is done; verify the PR/merge state and skip. Never duplicate shipped work.
- TDD: regression tests FIRST (write the failing test, see it fail, then implement). Tests are the spec.
- No secrets: never print/capture/commit credential values; consume ONLY via 'secrets exec <key> --as VAR -- <cmd>'. No internal-infra strings in artifacts. Staged secrets scan before every commit/push (rc 0 clean; rc 2 = refusal).
- Capture path: redirect to files, read both + $?; never pipe large reads. Paste literal output lines when reporting.
- Record as you go: comments on the plan's tasks, posts to #board. English. Lineage identity 'conversations agents register' named pr-monitor-<your-role>.
- Distinguish measured vs inferred; state what you did not check. Plain register.
`

const BUILD = CONST + `
ROLE: build lane (Sonnet). Your task: {TID} '{TTITLE}'. Description: {TDESC}. The design doc at ${DESIGN} has the spec section (2.x) this task implements; the acceptance criteria are in section 5.
1. IDEMPOTENCY CHECK FIRST: todos show {TID} — if completed, verify the merged evidence on the task and SKIP (record completed).
2. Sync ${MONOREPO}; worktree ~/.hasna/repos/worktrees/apps/pr-monitor; checkout -B plan/pr-monitor origin/main. If the branch already exists with prior lanes' commits, pull/rebase onto it (git checkout plan/pr-monitor; git rebase origin/main if needed) — this branch accumulates the T1-T10 commits.
3. Implement per the design: tests first, then the code. Scope confined to apps/repos unless the design says otherwise.
4. Pre-checks: secrets scan the diff (redirect + 'secrets scan input' rc 0 clean), grep internal-infra strings, run the app's affected tests (bounded 10 min) + 'bun run check' if available.
5. Commit (conventional message, 'Agent: pr-monitor-build-{TSHORT}' trailer LAST line), push --force-with-lease origin plan/pr-monitor.
6. Comment the outcome on the task ({TID}): what landed, test counts, scan result. Do NOT complete the task (T11 completes the chain).
Return (JSON): { task: '{TID}', implemented: bool, skipped: bool, tests: {passed, failed}, secretsClean: bool, headSha }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the combined PR {PR} (number + headSha) — the repos pr-monitor implementation (T1-T10). Verify against the design doc at ${DESIGN} section 5 (acceptance criteria): (a) migration v15 pr_monitor_state + base_ref_oid correct (fresh+upgrade DB, no data loss); (b) the classification engine implements the decision table with the stated precedence; (c) dedupe/fingerprint idempotency (re-run reports nothing new); (d) verdict parser two-sided; (e) CLI --json shape + docs parity; (f) secrets scan clean, no internal-infra strings; (g) no mode-enum reintroduction; (h) scope confined to apps/repos. Post the verdict as a PR comment '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: pr-monitor spec conformance, reviewer pr-monitor-review'. Block ONLY concrete P0/P1 defects. P2/P3 non-blocking (list as follow-ups). At most two remediation cycles against the named findings.
Return (JSON): { prs: [{number, verdict: GO|NO_GO, findings: [{severity, title, detail}]}] }
`

const MERGE = CONST + `
ROLE: merge lane (Sonnet). {BATCH} (each: number). For EACH GO'd PR: (1) gh pr view <n> --json headRefOid == the reviewed sha; (2) merge-tree equality at CURRENT origin/main (TREE=$(git -C ${MONOREPO} merge-tree --write-tree origin/main <head>); git diff --quiet <head> "$TREE"); (3) gh pr merge <n> --squash --body-file <file ending 'Agent: pr-monitor-ship'>; (4) record merged sha. NO_GO: comment findings, leave open.
Return (JSON): { prs: [{number, merged: bool, mergedSha: string|null, reason: string|null}] }
`

const RELEASE = CONST + `
ROLE: release lane (Sonnet). Release the new @hasna/repos version with the pr-monitor verb:
1. IDEMPOTENCY CHECK FIRST: npm view @hasna/repos version — if a version carrying pr-monitor is already published (the merged PR's changeset applied), skip to install (step 5).
2. In a worktree from origin/main: apply the changeset (patch bump), run the app suite (bounded 10 min), secrets scan staged (rc 0), commit with 'Agent: pr-monitor-release' trailer LAST, push, open the release PR, merge it (--body-file trailer).
3. POST publish intent to git-publishing BEFORE publishing: '@hasna/repos@<version> — pr-monitor verb + 5-min loop' + one-line changelog. Confirm in-thread after.
4. Publish: NPMRC=$(mktemp); chmod 600; printf '//registry.npmjs.org/:_authToken=\${NODE_AUTH_TOKEN}\\n' > "$NPMRC"; secrets exec hasna/npm/live/publish-token --as NODE_AUTH_TOKEN -- npm publish --userconfig "$NPMRC" --access public; rm -f "$NPMRC". Two-sided verify: npm view @hasna/repos version == new; npm view time --json fresh. Negative control first: the version was NOT already published.
5. Add the exact name @hasna/repos to minimumReleaseAgeExcludes in ~/.bunfig.toml if absent (exact names only), then bun install -g @hasna/repos@<version> on station01 (+ stations 03/04 if reachable). Verify the installed version on each.
Return (JSON): { version, published: bool, installed: {station01: string|null, station03: string|null, station04: string|null}, reviewNote: string|null }
`

const LOOP = CONST + `
ROLE: loop wiring lane (Sonnet). Wire the durable 5-minute PR-monitor loop:
1. IDEMPOTENCY CHECK FIRST: check hasna/loops for an existing pr-monitor loop — if one exists with a verified firing, skip.
2. Declare the live-test command shape (the loop's spec): every firing runs 'repos pr-monitor --sync --json' against the configured org (hasna/apps), posts NEW/actionable events to the git-prs conversations channel (per the design section 3.3 format), and the PASS shape is 'rc=0 with zero NEW events on a no-change run'; the iteration bound is declared (e.g. 3 consecutive no-change firings before the loop reports idle).
3. Create the loop via the loops CLI (hasna/loops scheduled entry, 5-minute cadence, station01), with the command, the PASS/FAIL shape, and the iteration bound recorded in the loop spec.
4. Verify ONE real firing from the loop's own run record (the loop's run log shows a completed firing with rc=0) — arming is not continuity; firing is.
Return (JSON): { loopId: string|null, cadence: string, verifiedFiring: bool, runRecord: string|null }
`

const LIVE = CONST + `
ROLE: live test + harvest lane (Sonnet). Live-test the wired loop:
1. Confirm at least one firing landed a real event class on hasna/apps (NEW / CI_FAILING / READY_TO_MERGE / etc.) in the git-prs channel (search the channel for the monitor's post format) OR, if the fleet is momentarily quiet, a baseline firing with zero NEW events (rc=0) — that is the negative control PASS.
2. Re-run the verb manually: a second run posts nothing new (idempotency live check).
3. HARVEST (per the artefact-chain rule, decisions recorded as you go): SKILLS (none/create/update with reason), TODOS (anything surfaced unfiled), MEMENTOS (what the next agent would re-learn — save it), KNOWLEDGE (ratifiable doctrine? only if yes), FILES (artefacts worth keeping — the design doc at ${DESIGN} is one; say where it lives).
4. Comment the live-test evidence on the plan's T14 task and the plan row; post the outcome to #board.
Return (JSON): { liveTest: {fired: bool, eventLanded: bool|null, idempotent: bool}, harvest: {skills: string, todos: string, mementos: string, knowledge: string, files: string} }
`

const BUILD_SCHEMA = { type: 'object', properties: { task: { type: 'string' }, implemented: { type: 'boolean' }, skipped: { type: 'boolean' }, tests: { type: 'object' }, secretsClean: { type: 'boolean' }, headSha: { type: 'string' } }, required: ['task', 'implemented'] }
const REMEDIATE_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object', properties: { number: { type: 'integer' }, newHead: { type: 'string' }, fixed: { type: 'boolean' }, tests: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['number', 'fixed'] } } }, required: ['prs'] }
const REVIEW_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object', properties: { number: { type: 'integer' }, verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['number', 'verdict'] } } }, required: ['prs'] }
const MERGE_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const RELEASE_SCHEMA = { type: 'object', properties: { version: { type: 'string' }, published: { type: 'boolean' }, installed: { type: 'object' }, reviewNote: { type: ['string', 'null'] } }, required: ['version', 'published'] }
const LOOP_SCHEMA = { type: 'object', properties: { loopId: { type: ['string', 'null'] }, cadence: { type: 'string' }, verifiedFiring: { type: 'boolean' }, runRecord: { type: ['string', 'null'] } }, required: ['verifiedFiring'] }
const LIVE_SCHEMA = { type: 'object', properties: { liveTest: { type: 'object' }, harvest: { type: 'object' } }, required: ['liveTest'] }

const TASKS = [
  ['cece9787', 'T1 Migration v15: pr_monitor_state table + pull_requests.base_ref_oid column + indexes in src/db/database.ts with DB tests', 'BUILD/db. Gate: bun test db suite, fresh+upgrade DB, FK check.'],
  ['ce8779d0', 'T2 Extend sync capture: baseRefOid + statusCheckRollup.contexts in GraphqlPr/pullRequestFields/toPullRequestInput + client fixtures', 'BUILD/github. Gate: github-sync.test.ts green.'],
  ['403c7140', 'T3 pr-monitor lib: state accessors (read/upsert pr_monitor_state, comment cursor, fingerprint, prune)', 'BUILD/lib. Gate: unit tests.'],
  ['6f261624', 'T4 Verdict parser: [REVIEW] GO|NO_GO — repo#n @ sha — lens... comment parsing (sha match, reviewer, lens, malformed tolerance)', 'BUILD/lib. Gate: two-sided fixtures.'],
  ['a0bbaeec', 'T5 Classification engine: decision table + precedence + base/main freshness + merge-tree leg (degrade when objects absent)', 'BUILD/lib. Gate: fixture matrix per class.'],
  ['d851ecf0', 'T6 Delta emitter: baseline mode, NEW detection, event emission with fingerprint dedupe, idempotent re-run', 'BUILD/lib. Gate: no-change re-run test.'],
  ['bbdfdd7c', 'T7 CLI verb repos pr-monitor (--sync/--no-sync/--org/--repo/--baseline/--json/--verbose) + stdout conventions', 'BUILD/cli. Gate: --help smoke + --json shape.'],
  ['f653ca39', 'T8 Docs parity: docs/cli.md entry (commands+options), docs/configuration.md if any env var', 'BUILD/docs. Gate: docs-parity.test.ts green.'],
  ['75cbf256', 'T9 SDK export (src/index.ts, docs/sdk.md) + MCP tool pr_monitor (docs/mcp.md, count 36->37) + parity tests', 'BUILD/surfaces. Gate: parity tests green.'],
  ['f5215758', 'T10 Full test suite: positive control per class, negative control (empty/all-merged), idempotency, migration, secrets scan clean', 'BUILD/tests. Gate: bun test full green, secrets scan staged rc=0.'],
]

phase('Build')
const buildResults = []
for (const [tid, title, desc] of TASKS) {
  const r = await agent(
    BUILD.replace('{TID}', tid).replace('{TTITLE}', title).replace('{TDESC}', desc).replace('{TSHORT}', tid.slice(0, 8)),
    { label: `build-${tid.slice(0, 8)}`, phase: 'Build', schema: BUILD_SCHEMA, model: 'sonnet' },
  )
  buildResults.push(r)
  log(`build ${tid.slice(0, 8)}: ${r && r.implemented ? 'implemented' : r && r.skipped ? 'skipped' : 'failed'}`)
}

phase('Review')
const prNumber = await (async () => {
  // find or open the combined PR for branch plan/pr-monitor
  const existing = await agent(CONST + `ROLE: PR finder. Check if a PR exists for branch plan/pr-monitor on hasna/apps (gh pr list --repo hasna/apps --head plan/pr-monitor --state open --json number,headRefOid). If none exists, OPEN it: gh pr create --repo hasna/apps --base main --head plan/pr-monitor --title 'feat(repos): pr-monitor verb + 5-minute fleet loop' --body 'Implements todos plan 16b442a5 T1-T10 per the design doc. Body ends Agent: pr-monitor-build.' (body-file with the trailer last). Return (JSON): {number, headSha}`, { label: 'pr-open', schema: { type: 'object', properties: { number: { type: 'integer' }, headSha: { type: 'string' } }, required: ['number'] }, model: 'sonnet' })
  return existing.number
})()

const review = await agent(
  REVIEW.replace('{PR}', JSON.stringify({ number: prNumber, headSha: 'HEAD' })),
  { label: 'pr-monitor-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' },
)

const REMEDIATE = CONST + `
ROLE: remediation lane. PR: {PR}. The review returned NO_GO with these P1 findings: {P1S}. Fix EXACTLY those P1 findings and nothing else — bounded remediation, no scope expansion. The named P1: classifyPullRequest's READY_TO_MERGE branch (apps/repos/src/lib/pr-monitor-classify.ts) requires (input.mergeTree === null || input.mergeTree.ok), but the run layer's probeMergeTree returns {ok:false, reason:"objects-absent"} when the head/base objects are not in the local checkout — so READY_TO_MERGE can never fire for the busiest repos, contradicting design §2.4/§6 (the merge-tree leg runs only when objects are local; otherwise the monitor degrades to base_ref_oid == current_main_sha equality). Remedy: treat mergeTree.reason === "objects-absent" like mergeTree === null in the READY condition, AND add a classify-level two-sided fixture: objects-absent + GO + mergeable + fresh base -> READY_TO_MERGE; objects-absent + GO + stale base -> BASE_MOVED. TDD first: write the failing classify-level tests, see them fail, then implement. Work in a worktree ~/.hasna/repos/worktrees/apps/pr-monitor-fix on branch plan/pr-monitor (the PR's own branch — sync it: git -C ${MONOREPO} fetch origin plan/pr-monitor, checkout -B plan/pr-monitor origin/plan/pr-monitor, rebase origin/main). Run the pr-monitor tests (bounded 10 min), secrets scan, commit ('Agent: pr-monitor-remediate' trailer LAST), push --force-with-lease origin HEAD:plan/pr-monitor. Record the new head sha.
Return (JSON): { prs: [{number, newHead, fixed: bool, tests: {passed, failed}, secretsClean: bool, evidence: string}] }
`

const RE_REVIEW = CONST + `
ROLE: adversarial re-review (Fable, same reviewer identity pr-monitor-review). PR: {PR}. BOUNDED RE-REVIEW: the previous review returned NO_GO with one P1 (READY_TO_MERGE blocked when the merge-tree probe degrades to objects-absent — the §2.4/§6 degrade-to-equality missing for the READY branch). The remediation lane fixed exactly that: treat mergeTree.reason === "objects-absent" like mergeTree === null in the READY condition, plus the two-sided classify fixture. Re-review ONLY that named defect and its direct regressions at the CURRENT head sha — do NOT discover or relitigate unrelated issues (the 4 P3s from the prior review are known non-blocking follow-ups). Verify: (a) the objects-absent degrade is implemented in the READY branch; (b) the two-sided classify fixture exists and passes (objects-absent + GO + mergeable + fresh base -> READY_TO_MERGE; objects-absent + GO + stale base -> BASE_MOVED); (c) the pr-monitor tests pass; (d) secrets clean. Post '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <newHead> — lens: pr-monitor P1 re-review (cycle 1), reviewer pr-monitor-review'.
Return (JSON): { prs: [{number, verdict: GO|NO_GO, findings: [{severity, title, detail}]}] }
`

phase('Remediate')
let remediate = null
let rereview = null
if (review && (review.prs || []).some(p => p.verdict === 'NO_GO')) {
  const p1s = (review.prs || []).flatMap(p => (p.findings || []).filter(f => f.severity === 'P1'))
  remediate = await agent(
    REMEDIATE.replace('{PR}', JSON.stringify({ number: prNumber })).replace('{P1S}', JSON.stringify(p1s)),
    { label: 'pr-monitor-remediate', phase: 'Remediate', schema: REMEDIATE_SCHEMA, model: 'sonnet' },
  )
  rereview = await agent(
    RE_REVIEW.replace('{PR}', JSON.stringify({ number: prNumber })),
    { label: 'pr-monitor-rereview', phase: 'Remediate', schema: REVIEW_SCHEMA, model: 'fable' },
  )
}

phase('Merge')
let merge = null
const effectiveReview = rereview || review
if (effectiveReview) {
  const go = (effectiveReview.prs || []).filter(p => p.verdict === 'GO').map(p => p.number)
  if (go.length) merge = await agent(MERGE.replace('{BATCH}', JSON.stringify(go)), { label: 'pr-monitor-merge', phase: 'Merge', schema: MERGE_SCHEMA, model: 'sonnet' })
}

phase('Ship')
const release = await agent(RELEASE, { label: 'pr-monitor-release', phase: 'Ship', schema: RELEASE_SCHEMA, model: 'sonnet' })

phase('Live')
const loop = await agent(LOOP, { label: 'pr-monitor-loop', phase: 'Live', schema: LOOP_SCHEMA, model: 'sonnet' })
const live = await agent(LIVE, { label: 'pr-monitor-live', phase: 'Live', schema: LIVE_SCHEMA, model: 'sonnet' })

return { build: buildResults, pr: prNumber, review, remediate, rereview, merge, release, loop, live }
