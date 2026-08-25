export const meta = {
  name: 'publish-all-apps',
  description: 'Ship every hasna/apps member that is ahead of the npm registry, drain-to-zero: 4 WIP release lanes (1 app each), codewith release review per candidate, npm publish, live install+smoke; re-census each pass and loop while the queue is non-empty (hard bound MAX_PASSES). HARDENED 2026-08-25 (owner-directed harden-lanes-review-gates, temporary): after each app\'s publish + two-sided verify and BEFORE any [PUBLISH-CONFIRM], TWO independent agents (publish-gate-1/publish-gate-2) live-verify the PUBLISHED package non-destructively — every bin, every non-destructive verb (--version, --help, validate, read, list, dry-run forms), actual commands with per-command GO/NO_GO evidence; [PUBLISH-CONFIRM] is posted only when BOTH return GO, otherwise the app is recorded RELEASE UNVERIFIED with a filed todos task and is never confirmed.',
  phases: [
    { title: 'Census', detail: 'repo version vs registry for every member -> the publish queue (ahead / not published), excluding in-flight-owned apps' },
    { title: 'Release', detail: 'waves of 4 lanes, one app per lane: codewith release review -> intent -> publish -> two-sided verify; then a 2-agent live gate (publish-gate-1/publish-gate-2, both must return GO) before the gated [PUBLISH-CONFIRM] -> live install + CLI smoke' },
    { title: 'Report', detail: 'per-app release evidence + live-test results' },
    { title: 'Harvest', detail: 'independent Opus harvest' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const TASK = '248f6ed8-d849-48ce-912c-1e7c5d8e69f0'
const CHANNEL = 'board'
const ACCOUNTS = ['account006', 'account025', 'account026', 'account030']

const CONST = `
You are a lane of the publish-all workflow (owner-authorized 2026-08-18, task ${TASK}). Mission: every app in the hasna/apps monorepo (${MONOREPO}) must be shipped to the hasna npm org as it gets updated. Max WIP: 4 lanes, ONE app per lane. Every release has a LIVE TEST step: install the published version and smoke the CLI. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first: git -C ${MONOREPO} pull (fast-forward; never discard local work). Work in task worktrees ~/.hasna/repos/worktrees/apps/release-<app> from origin/main. NEVER push to main; no commits unless a changeset/version commit is required (then commit with 'Agent: publish-all-<your-role>' — the ONLY attribution line).
- No secrets: never print/capture/commit credential values in any encoding; consume ONLY via 'secrets exec <key> --as VAR -- <cmd>'. No internal-infra strings in artifacts.
- Capture path: redirect to files, read both + $?; never pipe large reads. Paste literal output lines when reporting.
- Record as you go: comments on ${TASK}, mementos for non-obvious findings, posts to #${CHANNEL}. English. Register a lineage identity ('conversations agents register') named publish-all-<your-role>.
- Publish form (per the repo law): NPMRC="$(mktemp)"; chmod 600 "$NPMRC"; printf '//registry.npmjs.org/:_authToken=\${NODE_AUTH_TOKEN}\n' > "$NPMRC"; secrets exec hasna/npm/live/publish-token --as NODE_AUTH_TOKEN -- npm publish --userconfig "$NPMRC" --access public; rm -f "$NPMRC" — run from the app dir. Announce intent on git-publishing BEFORE, confirm in-thread AFTER TWO independent live gate agents (publish-gate-1/publish-gate-2) both return GO (the gates live-verify the PUBLISHED package — every bin, every non-destructive verb — before any [PUBLISH-CONFIRM]; a NO_GO means RELEASE UNVERIFIED and no confirm ever). Two-sided verify: 'npm view <pkg> version' shows the NEW version AND did NOT show it BEFORE (negative control at lane start).
- The 7-day quarantine: the LIVE TEST installs via bun — add the EXACT package name to ~/.bunfig.toml minimumReleaseAgeExcludes first (the sanctioned mechanism; never bypass the quarantine itself).
- The codewith release review is the ADVERSARIAL GATE (the npm-release rule: an independent agent verdict bound to repo+sha+package+version+registry): never publish without a GO. A failed/timed-out review run retried once, then SKIP the app (never publish unreviewed).
- FLEET INSTALL DISCIPLINE (owner ruling 2026-08-19): 'shipped' = published AND installed live on ALL AVAILABLE stations. Availability measured per pass via the tailnet (tailscale status/ping — never assumed): for every REACHABLE station, 'bun install -g @hasna/<pkg>@<v>' then verify the installed CLI --version against 'npm view @hasna/<pkg> version' (both must agree; MERGED != PUBLISHED != INSTALLED). Unreachable stations are NAMED in the pass report with their resume condition (e.g. 'station04: tailnet unreachable; @hasna/<pkg>@<v> install pending; resumes when reachable') — never silently skipped, never a blocker for the reachable set; each later pass retries the pending set.
- Distinguish measured vs inferred; state what you did not check. Plain register.
`

const CENSUS = CONST + `
FRESHNESS MARKER 2026-08-20T08:2xZ: this census must RE-READ the registry and origin/main LIVE — the prior pass (02:45Z marker) completed with loops 0.5.3 SHIPPED (05:02:40Z, fleet 15/16) and contracts 0.11.2 SKIPPED on a pre-reset review-gate failure (account006 usage-limit, retried once, pids 1756743/1799842). account006 reset passed 03:53Z — the contracts release review IS retryable now; contracts is the SOLE remaining ahead app (registry 0.11.1). Do not reuse any prior census numbers. — the prior census (02:20Z) is stale: hasna/apps#672 (contracts 0.11.2) MERGED 45399cf1b, so contracts is AHEAD on main (registry 0.11.1) and is the next publish candidate; test-guard 0.0.1 already published. Do not reuse any prior census numbers.: this census must RE-READ the registry and origin/main LIVE — the prior cached census (17:5xZ) is stale: hasna/apps#600 (machines 0.2.28) MERGED 18:27:57Z, so machines is AHEAD on main (registry 0.2.27) and must be in the publish queue. Do not reuse any prior census numbers.

ROLE: census (Opus). Build the publish queue. PRIORITY YIELD CHECK FIRST: todos list --project 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8 --status pending --json (redirect to a file, never pipe) — if any UNOWNED row's title starts with "HOTFIX:", the hotfix-drain lane owns the priority class: sleep 300 (bash), re-check once, return {queue: [], current: [], pendingPR: [], counts: {ahead: 0, current: 0, pendingPR: 0}, yielded: true, hotfixCount: N}. Do NOT enumerate the registry while yielding.
IF THE QUEUE IS EMPTY: sleep 300 (bash), re-run the census once, and return the RE-CHECK result — the lane waits ~5 min between passes while idle. NEVER return an empty queue without the sleep+re-check having run. Do:
IDEMPOTENCY CHECK FIRST: the registry at THIS moment is the only authority — npm view <pkg>@<version> (rc=0 = ALREADY PUBLISHED, do not republish; E404 is the ONLY publishable state); never re-run a release lane whose PR is merged or whose package is current; never reuse prior census numbers (they are stale by construction).
SCOPE GUARD: this phase reads ONLY the npm registry (npm view) and the repo (git/gh api). Do NOT enumerate conversations channels or page conversations — the channel id for posting is supplied; never drift into channel discovery (a prior census agent hung on paginating the channel list).
1. For every member of ${MONOREPO}/apps (a directory with a package.json): the repo version (python3 json read) and the registry latest ('npm view @hasna/<name> version' — 404 = never published).
2. Classify: AHEAD (repo version > registry latest OR never published) -> publish queue. CURRENT (repo == registry) -> skip. Note the git log recency for AHEAD apps (the owner ships as they get updated — a version bumped on main without a publish).
3. EXCLUDE apps owned by in-flight ship lanes (their workflows will publish): notes (the notes-cloud workflow owns its 0.2.0 publish). Also exclude any app whose version bump is still in an OPEN PR (not merged to main — check gh pr list --repo hasna/apps --search 'the app name' for open PRs carrying a version bump in package.json; if the bump is unmerged, the app is not publishable yet — record as pending-PR).
4. Also record, for each AHEAD app: whether a changeset is pending ('.changeset/*' files mentioning the app), whether the bump is a breaking minor per the package's pre-1.0 convention (0.x.0 = breaking — the changelog should say so), and the app's bin names (for the live smoke).
Comment the queue on ${TASK}.
Return (JSON): { queue: [{name, repoVersion, registryLatest: string|null, breaking: bool, bins: [string]}], current: [string], pendingPR: [{name, prNumber}], counts: {ahead, current, pendingPR} }
`

const RELEASE = CONST + `
RELEASE-GATE NOTE 2026-08-20T09:2xZ: the prior pass skipped ${'${APP}'} on TWO different gate failures: (1) usage-limit pre-reset, then (2) provider MODEL-CAPACITY on account006 — literal 'ERROR: Selected model is at capacity. Please try a different model.' x2 (sol xhigh 573k tok, terra xhigh 170k tok; account006 100% remaining). CAPACITY-SWITCH RULE (standing): do NOT retry into a capacity error on the same account — enumerate healthy accounts first (codewith usage --all --json, select a profile with ok==true AND health.status=='healthy'), pick a DIFFERENT account than account006 (e.g. account002) for the codewith release review of ${'${APP}'}; publish ONLY on [REVIEW] GO bound to the reviewed sha. Do NOT replay the prior skips.
ROLE: release lane for ${'${APP}'} (repo ${'${REPO_VER}'} vs registry ${'${REG_VER}'}, bins ${'${BINS}'}). Assigned codewith account: ${'${ACCT}'}. You own THIS ONE APP. Do:
1. Register identity 'publish-all-${'${TSHORT}'}' before any post. Sync ${MONOREPO}; worktree ~/.hasna/repos/worktrees/apps/release-${'${TSHORT}'} from origin/main.
2. Re-verify at lane start: the repo version is still ahead of the registry (negative control: npm view @hasna/${'${TSHORT}'} version must NOT already show the repo version — if it does, someone else published: STOP, record, and return skipped with 'already-published'). If a changeset is pending for the app ('bunx changeset status' or the .changeset files), run 'bunx changeset version' in a worktree, commit the version+changelog changes ('Agent: publish-all-${'${TSHORT}'}'), push via a PR (title 'release(${'${APP}'}): version <v>'), and let it merge BEFORE publishing (the PR needs a review — post the codewith release review on that PR instead; the review covers the release candidate).
3. RELEASE REVIEW via codewith exec: write release-brief-${'${TSHORT}'}.md: 'Adversarially review the release candidate for @hasna/${'${TSHORT}'}@<version>: repo hasna/apps, head <sha>, the diff since the last published version (git log + git diff), repo laws (AGENTS.md + .claude/rules), the npm release rule (independent agent verdict). Check: secrets/internal-infra strings in the packed content, the changelog accuracy, the version bump correctness, regression risk. FIRST LINE exactly: [REVIEW] GO|NO_GO — @hasna/${'${TSHORT}'}@<version> @ <sha> — registry npmjs. Then ONLY concrete P0/P1 blocking findings.' Run: codewith exec --auth-profile ${'${ACCT}'} -m gpt-5.6-sol -c model_reasoning_effort="xhigh" --sandbox read-only --skip-git-repo-check -C <worktree> -o <worktree>/release-review-${'${TSHORT}'}.md "$(cat release-brief-${'${TSHORT}'}.md)" < /dev/null > release-run-${'${TSHORT}'}.log 2>&1 &
   Wait: until [ -s release-review-${'${TSHORT}'}.md ] || ! kill -0 $! 2>/dev/null; do sleep 20; done — bounded 45 iterations; on timeout kill + RETRY ONCE; second failure = SKIP (never publish unreviewed). If the model 400s, re-run with gpt-5.6-terra and record the deviation. NO_GO: remediate ONLY the named P0/P1 findings (via a PR), re-review — bounded 2 cycles; third NO_GO: SKIP with the findings recorded.
4. GO: announce intent on git-publishing ('PUBLISH INTENT: @hasna/${'${TSHORT}'}@<version> — <one-line changelog>'). Note the intent post's message id (the send receipt, or conversations show <id> --json) as intentId — the gated confirm step needs it to reply IN-THREAD. Publish with the npmrc pairing from the app dir. Verify two-sided (npm view version = the new version; timestamp fresh). DO NOT post [PUBLISH-CONFIRM] here — the [PUBLISH-CONFIRM] reply is posted by a SEPARATE workflow step AFTER two independent live gate agents (publish-gate-1/publish-gate-2) verify the PUBLISHED package (every bin, every non-destructive verb, run live); the lane NEVER posts [PUBLISH-CONFIRM] unless BOTH gates return GO.
5. LIVE TEST (declared stop condition): add the exact name @hasna/${'${TSHORT}'} to ~/.bunfig.toml minimumReleaseAgeExcludes (sanctioned), then 'bun install -g @hasna/${'${TSHORT}'}@<version>' (rc=0). Smoke the installed binary: for the primary bin: '<bin> --version' prints the published version; '<bin> --help' exits 0; one read-only verb where sensible (bounded 5 min; for server/mcp bins: '<bin>-mcp --version' / '<bin>-serve --help' must answer WITHOUT binding (the recordings pattern) — if a bin binds-before-version, record it as a P1 finding (do NOT fail the release for it unless it blocks the smoke; file it). PASS = version match + help rc=0 + the read-only verb works. FAIL = any of those with evidence; fix (root cause) and re-test — at most 3 fix-retest cycles; on exhaustion STOP and report the live failure verbatim.
6. Record: comment ${TASK} (version, review sha, live-test evidence); mementos.
Return (JSON): { app, publishedVersion, reviewVerdict: string, reviewSha: string, mergedChangesetPr: string|null, intentId: string|null, liveTest: {state: pass|fail|pending, version, helpRc, smoke: string}, skipped: bool, reason: string|null }
`

const REPORT = CONST + `
ROLE: report. Aggregate the release lanes (below) + the census: per-app state (published/current/pending/skipped), live-test results, remaining queue as follow-ups. Comment the final state on ${TASK}, post the summary to #${CHANNEL}.
Return (JSON): { totals: {ahead, published, current, skipped, liveTestPassed, liveTestFailed}, apps: [{name, state, version, liveTest}], followUps: [string] }
Census: {CENSUS}
Lanes: {LANES}
`

const HARVEST = CONST + `
ROLE: harvest (Opus, independent). ROW-DEDUPE FIRST: before creating anything, search the oss-apps project for an existing open HARVEST row whose title carries this task's signature (title prefix 'HARVEST: publish-all' AND a reference to ${TASK}) — 12 such rows already exist for ${TASK} on 08-18/08-19 (defect 5f891a48). If one exists, comment the five categories on IT (the most recent open one) and DO NOT create a new row. Only when none exists, create your harvest row in the oss-apps project. Comment each of the five categories on it the moment it is decided (skills/todos/mementos/knowledge/files — create/update/none + reason; dedupe the ARTEFACT first per the harvest constraints; 'none' is complete). Read the record: ${TASK} comments, the census + release results, the report (below), #${CHANNEL}.
Categories:
- SKILLS: repeated procedures worth a skill (the per-app release-with-codewith-review + live-install recipe — this is now a repeatable pattern)?
- TODOS: what surfaced nobody filed (skipped apps + reasons, apps whose live smoke failed, pending-PR apps, quarantine excludes still missing)?
- MEMENTOS: what the next agent would re-learn at full cost?
- KNOWLEDGE: ratifiable doctrine (the release pipeline as-built, version-ahead census as of this run)?
- FILES: artefacts for hasna/files rather than scratch (the census matrix, release evidence)?
Close the row completed only after all five categories are commented.
Return (JSON): { categories: {skills: {decision, reason, rowId|null}, todos: {...}, mementos: {...}, knowledge: {...}, files: {...}} }
Report: {REPORT}
`

const CENSUS_SCHEMA = {
  type: 'object',
  properties: {
    queue: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, repoVersion: { type: 'string' }, registryLatest: { type: ['string', 'null'] }, breaking: { type: 'boolean' }, bins: { type: 'array', items: { type: 'string' } } }, required: ['name', 'repoVersion'] } },
    current: { type: 'array', items: { type: 'string' } },
    pendingPR: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, prNumber: { type: 'integer' } } } },
    counts: { type: 'object' },
    yielded: { type: 'boolean' },
    hotfixCount: { type: 'integer' },
  },
  required: ['queue', 'current', 'counts'],
}
const RELEASE_SCHEMA = {
  type: 'object',
  properties: {
    app: { type: 'string' }, publishedVersion: { type: ['string', 'null'] },
    reviewVerdict: { type: 'string' }, reviewSha: { type: 'string' },
    mergedChangesetPr: { type: ['string', 'null'] }, intentId: { type: ['string', 'null'] },
    liveTest: { type: 'object', properties: { state: { type: 'string' }, version: { type: 'string' }, helpRc: { type: ['integer', 'null'] }, smoke: { type: 'string' } } },
    skipped: { type: 'boolean' }, reason: { type: ['string', 'null'] },
  },
  required: ['app', 'skipped'],
}
const PUBLISH_GATE = { type: 'object', additionalProperties: false, required: ['verdict', 'perCommand'], properties: { verdict: { enum: ['GO', 'NO_GO'] }, perCommand: { type: 'array', items: { type: 'object' } }, failures: { type: 'array', items: { type: 'string' } } } }
const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    totals: { type: 'object' },
    apps: { type: 'array', items: { type: 'object' } },
    followUps: { type: 'array', items: { type: 'string' } },
  },
  required: ['totals', 'apps'],
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

// DRAIN-TO-ZERO LOOP (owner design 2026-08-25): re-census each pass; while the
// publish queue is non-empty the pass restarts inside the same run. A pass that
// publishes nothing new (all current/skipped) or an empty queue ends the loop.
const allLanes = []
let census = null
let pass = 0
for (pass = 1; ; pass++) {
phase('Census')
census = await safeAgent(censusPrompt(CENSUS), { label: 'census-publish-' + pass, phase: 'Census', schema: CENSUS_SCHEMA, model: 'opus' })
if (census && census.yielded) {
  log(`pass ${pass}: YIELDED to hotfix-drain (${census.hotfixCount || 0} HOTFIX: row(s)) — waited inside the census, re-checking next pass`)
  continue
}
const queue = (census && census.queue) || []
log(`pass ${pass} census: ${census ? JSON.stringify(census.counts) : 'FAILED'} — queue ${queue.length}`)
if (!queue.length) {
  log(`pass ${pass}: publish queue empty — the census waited ~5 min and re-checked; re-checking next pass`)
  continue
}

phase('Release')
const lanes = []
for (let i = 0; i < queue.length; i += 4) {
  const wave = queue.slice(i, i + 4)
  const results = await parallel(wave.map((app, j) => () =>
    safeAgent(
      RELEASE
        .replaceAll('${APP}', app.name.replace('@hasna/', ''))
        .replaceAll('${REPO_VER}', app.repoVersion)
        .replaceAll('${REG_VER}', app.registryLatest || 'never-published')
        .replaceAll('${BINS}', JSON.stringify(app.bins || []))
        .replaceAll('${TSHORT}', app.name.replace('@hasna/', '').slice(0, 10))
        .replaceAll('${ACCT}', ACCOUNTS[(i + j) % ACCOUNTS.length]),
      { label: `release-${app.name.replace('@hasna/', '')}-p${pass}`, phase: 'Release', schema: RELEASE_SCHEMA, model: 'sonnet' },
    ),
  ))
  // PUBLISH GATE (owner-directed 2026-08-25, harden-lanes-review-gates): after each
  // app's publish + two-sided verify and BEFORE any [PUBLISH-CONFIRM] may be posted,
  // TWO independent agents (publish-gate-1/publish-gate-2) live-verify the PUBLISHED
  // package — every bin, every non-destructive verb (--version, --help, validate, read,
  // list, dry-run forms) — actual commands, actual outputs, per-command
  // {command, verdict: GO|NO_GO, evidence}. NEVER write test scripts; run the real
  // commands. NON-DESTRUCTIVE only. The lane posts [PUBLISH-CONFIRM] only when BOTH
  // return GO; any NO_GO files 'RELEASE UNVERIFIED: <pkg>@<v>' in todos with the gate
  // evidence, posts the NO_GO to #apps, and NEVER confirms.
  for (const r of results) {
    if (!r || !r.publishedVersion) continue
    const pkgName = '@hasna/' + (r.app || 'unknown')
    const gateV = r.publishedVersion
    const publishGates = await parallel([
      () => safeAgent(`LIVE GATE 1 OF 2 (publish): you verify the PUBLISHED package ${pkgName}@${gateV} by RUNNING its commands live — every bin, every non-destructive verb (--version, --help, validate, read, list, dry-run forms) — actual commands, actual outputs, per-command {command, verdict: GO|NO_GO, evidence}. NEVER write test scripts; run the real commands. NON-DESTRUCTIVE only. Return {verdict, perCommand, failures}.`, { label: 'publish-gate-1-' + (r.app || 'app'), phase: 'Release', schema: PUBLISH_GATE }),
      () => safeAgent(`LIVE GATE 2 OF 2 (publish): same task as gate 1, independently — run the published package's commands live, non-destructive, per-command GO/NO_GO with evidence. Return {verdict, perCommand, failures}.`, { label: 'publish-gate-2-' + (r.app || 'app'), phase: 'Release', schema: PUBLISH_GATE }),
    ])
    const publishAllGo = publishGates.filter(Boolean).every(g => g && g.verdict === 'GO')
    if (publishAllGo) {
      r.gate = 'GO'
      const confirm = await safeAgent(`GATE CONFIRM (publish gate protocol): both live gates returned GO for ${pkgName}@${gateV}. Reply IN-THREAD to the intent post in git-publishing (conversations send --channel git-publishing --reply-to ${r.intentId || 'MISSING'}): [PUBLISH-CONFIRM] ${pkgName}@${gateV} — <live-test evidence line: two-sided verify + live install/smoke + both gates GO>. If the intent id is missing or unresolvable, locate the [PUBLISH INTENT] post for this package in git-publishing and reply to its real message id — never invent an id. Return {confirmId, posted: true}.`, { label: 'confirm-publish-' + (r.app || 'app'), phase: 'Release', schema: { type: 'object', additionalProperties: false, required: ['confirmId', 'posted'], properties: { confirmId: { type: 'string' }, posted: { type: 'boolean' } } } })
      r.confirmId = confirm ? confirm.confirmId : null
    } else {
      // NEVER confirm: file the UNVERIFIED todos row with the gate evidence (a REAL row
      // per the tracking rule — cite only a created/verified short id) and post the NO_GO
      // to #apps.
      const unv = await safeAgent(`RELEASE UNVERIFIED: ${pkgName}@${gateV} — the two independent live gates did NOT both return GO (verdicts: ${JSON.stringify(publishGates.filter(Boolean).map(g => ({ verdict: g.verdict, failures: g.failures })))}). NEVER post [PUBLISH-CONFIRM] for this package. Check whether a todos row for this exact defect class already exists (todos list --project 3bbc22e0 --status pending --limit 500 --json AND --status in_progress, redirect to a file, never pipe); reuse it if it exists, otherwise todos add in project 3bbc22e0: title 'RELEASE UNVERIFIED: ${pkgName}@${gateV} — live gate NO_GO', description carrying the exact gate evidence (per-command outputs, verdicts, failures) + package + version; no credential values anywhere in the description — redact token-like output. Post the NO_GO to #apps with the evidence (conversations send --channel apps), no credential values in the post. Return {taskId, postedNoGo: true}.`, { label: 'publish-unverified-' + (r.app || 'app'), phase: 'Release', schema: { type: 'object', additionalProperties: false, required: ['taskId', 'postedNoGo'], properties: { taskId: { type: 'string' }, postedNoGo: { type: 'boolean' } } } })
      r.gate = 'NO_GO'
      r.unverifiedTaskId = unv ? unv.taskId : null
    }
  }
  lanes.push(...results)
  const published = lanes.filter(l => l && l.publishedVersion).length
  log(`pass ${pass} wave ${i / 4 + 1} done; published so far ${published}/${lanes.filter(Boolean).length}`)
}
allLanes.push(...lanes.filter(Boolean))
const publishedThisPass = lanes.filter(l => l && l.publishedVersion).length
const gateGoThisPass = lanes.filter(l => l && l.gate === 'GO').length
log(`pass ${pass} complete — ${publishedThisPass} published, ${gateGoThisPass} gate-verified (both gates GO), queue had ${queue.length}; next pass re-censuses`)
}

phase('Report')
const report = await safeAgent(
  REPORT
    .replace('{CENSUS}', JSON.stringify(census || {}))
    .replace('{LANES}', JSON.stringify(allLanes)),
  { label: 'report-publish', phase: 'Report', schema: REPORT_SCHEMA, model: 'sonnet' },
)

phase('Harvest')
const harvest = await safeAgent(HARVEST.replace('{REPORT}', JSON.stringify(report || { report: null })), {
  label: 'harvest-publish', phase: 'Harvest', schema: HARVEST_SCHEMA, model: 'opus',
})

return { passes: pass, census, lanes: allLanes, report, harvest }
