export const meta = {
  name: 'task-drain-apps',
  description: `Standing hasna/apps task drain, drain-to-zero: census unowned pending rows in project the hasna/apps todos project (args.project, default 3bbc22e0) — the BUG class executed via the fix-lane discipline (idempotency gate, worktree, PR-first, one independent reviewer-agent review on the default model, merge) and the live-gate UNVERIFIED class (RELEASE/SHIP/DEPLOY UNVERIFIED rows filed by the publish/deploy/ship lanes on gate NO_GO) driven through gate-remediation (two independent live gates re-verify the artifact; BOTH GO -> post the missing confirm + complete; ANY NO_GO -> record the verdict + route the defect to ONE deduped BUG row) — re-census each pass and loop while rows remain (hard bound MAX_PASSES), record at the end`,
  phases: [
    { title: 'Census' },
    { title: 'Execute' },
    { title: 'Record' },
  ],
}


// hasna/apps todos project id (args-driven, 2026-08-26): args.project overrides;
// the standing hasna/apps project id is the default. Every use below
// interpolates ${APPS} — no hardcoded id.
const APPS = (args && args.project) || '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'


// Parallelism (owner 2026-08-25): MULTIPLE fix agents per pass, each working a
// DIFFERENT row in its OWN task worktree via hasna/repos (repos CLI worktree
// verb; ~/.hasna/repos/worktrees/apps/<row.id>). Bounded by MAX_ROWS rows per
// pass and MAX_CONCURRENT agents per wave (default 3 each; args override).
// Safe parallel execution requires (a) rows-per-pass bounded, (b) a claim
// comment on each row at execution start (the census excludes active claims),
// and (c) each agent works ONLY in its own worktree — never the shared checkout.
const MAX_ROWS = (args && args.maxRows) || 3
const MAX_CONCURRENT = (args && args.maxConcurrent) || 3
// Pass bound (fleet ground truth 2026-08-26): the standing 'infinite' lane runs a
// BOUNDED pass loop — MAX_PASSES hard cap per run (~8 agents per pass at the
// default widths, so 40 passes is well inside the runtime's 1,000-agent run cap,
// which stays the outer guard). Standing continuity between runs comes from the
// COORDINATOR re-launching this workflow, never an unbounded in-script loop.
// args.maxPasses overrides.
const MAX_PASSES = Math.min(500, Math.max(1, Number(args && args.maxPasses) || 40))
// BOUNDED SESSION-SCOPED LOOP (owner 2026-08-25; bounded per fleet ground truth
// 2026-08-26): census -> execute -> wait the idle window when idle -> re-census,
// capped at MAX_PASSES per run. The idle wait lives INSIDE the census agent (bash
// sleep + re-check). PRIORITY YIELD: any HOTFIX: row yields this lane to
// hotfix-drain. Stop = the hard bound, owner stops the run, or the session ends.
const CLAIM_TAG = 'task-drain-apps claim'

// Idle window (owner 2026-08-25, args-driven): args.idleMinutes in MINUTES,
// default 30. The census sleeps IDLE_SLEEP seconds then re-checks once —
// min(idleMinutes, 300) bounds the in-agent wait; the existing 300s is the floor
// (the standing idle wait, also the safeAgent failure-banner sleep).
const IDLE_MINUTES = Math.min(((args && args.idleMinutes) || 30), 300)
const IDLE_SLEEP = Math.min(Math.max(300, IDLE_MINUTES * 60), 1800)

// RECORDING V2 (owner requirement): every workflow agent records while working.
// Interpolated into every agent prompt below.
const RECORDING = `
RECORD WHILE WORKING (required, every workflow agent):
(1) conversations: claim/post to #hasna-apps at start (create via 'conversations channel create hasna-apps' if missing), milestone after each phase, done at the end; deploy lane additionally posts [DEPLOY INTENT] to git-deployments BEFORE and [DEPLOY-CONFIRM] in-thread AFTER with the 2-live-gate GO.
(2) todos: one task per work item (todos add --project hasna-apps), todos comment with evidence as you go, status start/complete only with proof (merged PR / verified live).
(3) mementos: mementos save key apps-<topic> on every non-obvious root cause/decision.
(4) knowledge: on durable doctrine, file a follow-up task 'KNOWLEDGE: <item>' for the knowledge lane (never silent add).
(5) skills: on a repeated procedure, file 'SKILL: <name>' follow-up.
(6) instructions: only when the workflow itself changes rules (then file 'INSTRUCTIONS: <config>').
Cloud env: for f in todos conversations mementos knowledge; do [ -f "$HOME/.hasna/cloud/$f.env" ] && set -a && . "$HOME/.hasna/cloud/$f.env" && set +a; done.
NEVER print a credential value.
`

const CENSUS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['candidates', 'queueSize', 'blocked'],
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'shortId', 'title', 'createdAt', 'reason', 'kind'],
        properties: {
          id: { type: 'string' },
          shortId: { type: 'string' },
          title: { type: 'string' },
          createdAt: { type: 'string' },
          reason: { type: 'string' },
          kind: { type: 'string', enum: ['bug', 'unverified'] },
        },
      },
    },
    queueSize: { type: 'integer' },
    blocked: { type: 'array', items: { type: 'string' } },
    yielded: { type: 'boolean' },
    hotfixCount: { type: 'integer' },
  },
}

const EXEC_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['outcome', 'taskId'],
  properties: {
    outcome: { enum: ['fixed', 'idempotency-stop', 'skipped', 'failed'] },
    taskId: { type: 'string' },
    prNumber: { type: 'integer' },
    mergeSha: { type: 'string' },
    reason: { type: 'string' },
  },
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
    const r = await agent(prompt, opts)
    // A prose reply can come back as the agent's RAW RESULT (a string) instead
    // of the schema'd object — measured 2026-08-26 on wf_a3a29325-194: the
    // survey agent completed with prose and the run crashed at
    // `survey.deployable.length` (a truthy string passes !survey). When a
    // schema was requested, a non-object result is the SAME failure class as
    // the throw — treat it as one so the existing null-guards hold.
    if (opts && opts.schema && (typeof r !== 'object' || r === null)) {
      agentFailed = true
      const label = (opts && (opts.label || opts.phase)) || 'agent'
      log('AGENT-PROSE (' + label + '): schema requested but the agent returned a non-object result — treating as failure; next pass census sleeps 300s first')
      return null
    }
    return r
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

// BOUNDED SESSION-SCOPED LOOP (owner 2026-08-25; bounded per fleet ground truth
// 2026-08-26): census -> execute -> wait ~5 min when idle -> re-census, capped at
// MAX_PASSES per run. Idle wait lives INSIDE the census agent (bash sleep +
// re-check). PRIORITY YIELD: any HOTFIX: row yields this lane to
// hotfix-drain. Stop = the hard bound, owner stops the run, or the session ends.
const passes = []
let pass = 0
for (pass = 1; pass <= MAX_PASSES; pass++) {
phase('Census')
const census = await safeAgent(censusPrompt(`${RECORDING}
Census the hasna/apps task-drain queue (todos project ${APPS}). PASS ${pass} of the bounded loop (max ${MAX_PASSES}) — re-census each pass; rows executed earlier in this run carry claims and are excluded.

PRIORITY YIELD CHECK FIRST: if any UNOWNED row's title starts with "HOTFIX:", the hotfix-drain lane owns the priority class: sleep 300 (bash), re-run the yield check once, and return {yielded: true, hotfixCount: N, candidates: [], queueSize: 0}. Do NOT enumerate BUG rows while yielding.

1. \`todos list --project ${APPS} --status pending --json\` (redirect to a file, never pipe). Select rows whose title starts with "BUG" OR rows whose title starts with "RELEASE UNVERIFIED:", "SHIP UNVERIFIED:", or "DEPLOY UNVERIFIED:" (the live-gate NO_GO rows filed by the publish/deploy/ship lanes — BOTH classes are drain candidates; a gate row is never drainable by the fix-lane alone). For each candidate record kind: "bug" for BUG rows, "unverified" for the UNVERIFIED gate rows.
2. Filter to UNOWNED rows (no assigned_to). For each, read the comments (rows carry comments in the list payload): a row whose comments already record "FIXED AT HEAD" or "MERGED" or "DUPLICATE of" or "VERIFIED" (gate row confirmed, both gates GO) or "NO_GO ROUTED" (gate row verdict recorded, defect routed to a BUG row) is NOT a candidate — exclude it.
3. Dedupe against live fixers: \`gh pr list --repo hasna/apps --state open --json number,title\` — if an open PR's title names the row's shortId or clearly targets the same defect, exclude the row (blocked: live fixer). For UNVERIFIED rows, a BUG row already filed for the exact defect class (its comments record "NO_GO ROUTED") is also a live fixer — exclude the gate row.
4. Exclude any row whose comments carry an ACTIVE claim marker: a comment containing "${CLAIM_TAG}" with a timestamp younger than 90 minutes (another task-drain instance is executing it — never duplicate). Comments carrying "${CLAIM_TAG}" older than 90 minutes are STALE claims (the instance died) and the row is a candidate again.
5. Sort candidates by created_at ASC (oldest first — queue order).
6. Return the ordered candidates. Include rows already covered by a fix-lane in flight ONLY if their fix-lane is provably dead (transcript older than 60 min); otherwise exclude them (a live lane is a live fixer — never duplicate).

IF THE QUEUE IS EMPTY (no unowned BUG rows AND no unowned UNVERIFIED rows): sleep ${IDLE_SLEEP} (bash — the args-driven idle window, ${IDLE_MINUTES} min default), re-run the census steps once, and return the RE-CHECK result — the lane waits the idle window between passes while idle. NEVER return an empty result without the sleep+re-check having run.
Return candidates (max ${MAX_ROWS + 2}), queueSize (unowned BUG + UNVERIFIED rows remaining), blocked (excluded rows with reasons), yielded (bool), hotfixCount (int).`), { label: 'census:' + pass, phase: 'Census', schema: CENSUS_SCHEMA })

const candidates = (census && census.candidates) || []
if (census && census.yielded) {
  log('task-drain-apps: pass ' + pass + ' YIELDED to hotfix-drain (' + (census.hotfixCount || 0) + ' HOTFIX: row(s)) — waited inside the census, re-checking next pass')
  continue
}
if (candidates.length === 0) {
  log('task-drain-apps: pass ' + pass + ' queue empty — the census waited ' + IDLE_SLEEP + 's and re-checked; re-checking next pass')
  continue
}

phase('Execute')
// Up to MAX_ROWS rows per pass, executed in CONCURRENT waves of MAX_CONCURRENT
// (owner 2026-08-25): each agent works a DIFFERENT row in its OWN task worktree
// via hasna/repos. Each row is claimed with a comment before execution so
// concurrent instances never double-pick it.
const rowsToRun = candidates.slice(0, MAX_ROWS)
const execs = []
for (let w = 0; w < rowsToRun.length; w += MAX_CONCURRENT) {
  const wave = rowsToRun.slice(w, w + MAX_CONCURRENT)
  const results = await parallel(wave.map((row) => () => {
    const isGateRow = row.kind === 'unverified' || /UNVERIFIED/.test(row.title || '')
    if (isGateRow) {
      return safeAgent(`${RECORDING}
GATE-REMEDIATION — this row is a live-gate UNVERIFIED row (title class "RELEASE/SHIP/DEPLOY UNVERIFIED", filed by the publish/deploy/ship lanes when the 2-agent live gates NO_GO'd), NOT a code bug: NO worktree, NO code changes, NO publish, NO deploy. Drive the artifact through re-verification and record the terminal verdict. Row: ${JSON.stringify(row)}. You are ONE OF ${Math.min(MAX_CONCURRENT, wave.length)} CONCURRENT agents — each works its OWN row; never touch another agent's worktree, never the shared checkout.

CLAIM FIRST: comment the row now — \`todos comment <row.id> "${CLAIM_TAG} — executing <shortId> $(date -u +%Y-%m-%dT%H:%MZ)"\` (a concurrent task-drain instance's census excludes rows with a claim younger than 90 min; your claim prevents double-picking).

1. Parse the artifact from the title/description: gate class (RELEASE | SHIP | DEPLOY), the package/service@version (or wave #N), and the gate evidence recorded in the description.
2. Re-verify the artifact LIVE and NON-DESTRUCTIVELY with TWO independent gate agents (labels <class>-gate-1 / <class>-gate-2, both must return GO) mirroring the original gate shape:
   - RELEASE rows: the PUBLISHED npm package — every bin, every non-destructive verb (--version, --help, validate, read, list, dry-run forms), actual commands with per-command GO/NO_GO evidence.
   - DEPLOY rows: the DEPLOYED service — every route (/health /ready /version 200 + identity + version match, one business read), per-route GO/NO_GO evidence.
   - SHIP rows: the shipped wave artifacts — install the published versions, every bin non-destructive.
3. BOTH return GO: FIRST check whether a confirm marker for this exact artifact already exists (conversations search in git-publishing / git-deployments for the artifact@version or the row's shortId) — a later lane pass may have confirmed it after this row was filed. If a confirm already exists, do NOT post a second one. Otherwise post the confirm marker the original lane never posted ([PUBLISH-CONFIRM] / [DEPLOY-CONFIRM] / ship confirm), replying IN-THREAD to the original intent post where the row's description or git-publishing/git-deployments carries it (never invent an id). Comment the row: "VERIFIED <artifact> — both gates GO (<one-line evidence>)". Complete the row (todos complete <row.id>). Outcome 'fixed'.
4. ANY NO_GO: comment the row with the exact per-command/per-route failing evidence and the verdict — "NO_GO at head — <artifact> still fails the gate". Route the underlying defect to ONE deduped BUG row: check for an existing row for this exact defect class (todos list --project ${APPS} --status pending --json, redirect to a file, never pipe; and gh pr list --repo hasna/apps --state open) — reuse it if it exists (add the evidence as a comment), otherwise file ONE BUG row in project ${APPS} carrying the exact failing evidence. Comment the gate row: "NO_GO ROUTED — fix routed to <BUG shortId or id>". Complete the gate row with that verdict (fail-closed preserved: no confirm was ever posted; the routed BUG row carries the repair). Outcome 'skipped' with reason naming the routed row.
5. NEVER post a confirm marker on a NO_GO. NEVER mutate code. NEVER publish or deploy. The confirm marker is posted ONLY when both gates return GO.

Return the schema.`, { label: 'exec-gate:' + row.shortId, phase: 'Execute', schema: EXEC_SCHEMA })
    }
    return safeAgent(`${RECORDING}
Execute ONE hasna/apps BUG row via the fix-lane discipline. Row: ${JSON.stringify(row)}. You are ONE OF ${Math.min(MAX_CONCURRENT, wave.length)} CONCURRENT fix agents — each works its OWN row in its OWN worktree; never touch another agent's worktree, never the shared checkout.

CLAIM FIRST: comment the row now — \`todos comment <row.id> "${CLAIM_TAG} — executing <shortId> $(date -u +%Y-%m-%dT%H:%MZ)"\` (a concurrent task-drain instance's census excludes rows with a claim younger than 90 min; your claim prevents double-picking).

WORKTREE (your own, via hasna/repos): create ~/.hasna/repos/worktrees/apps/<row.id> from origin/main with the repos CLI worktree verb (repos worktree add ... or git worktree add; run repos scan after). Branch named after the task. NEVER work in another agent's worktree and never in the shared checkout — each agent's worktree path is unique per row id, which is what makes concurrent execution safe.

IDEMPOTENCY GATE — stop with outcome 'idempotency-stop' if any holds:
(a) the defect no longer reproduces at origin/main head (git fetch + reproduce or code-read the exact failure);
(b) a live fixer/PR already exists for it (gh pr list --repo hasna/apps --state open — title names the shortId or clearly targets the defect);
(c) the row is no longer pending.
(An idempotency-stop still leaves your claim comment; the census treats claims older than 90 min as stale.)

Else: implement the fix in YOUR worktree. Regression test first (write the failing test, confirm it fails, then fix). Verify: the package's test suite green, bun run check rc=0 at your worktree root, secrets scan staged rc=0 with real bytes. Commit with a Conventional Commit message ending "Agent: fix-lane-<shortId>" (never Co-Authored-By). Push and open the PR (gh pr create, body = what/why + verification lines + task id, ending "Agent: fix-lane-<shortId>").

REVIEW: one adversarial review of the exact PR head by an independent reviewer agent run on the default model (bounded: at most two remediation cycles; a third NO_GO terminates the candidate with findings recorded — outcome 'skipped'). Fix concrete P0/P1 findings in the worktree and re-review.

MERGE: on [REVIEW] GO — verify the base-movement gate first: TREE=$(git merge-tree --write-tree origin/main <head>); git diff --quiet <reviewed-sha> "$TREE" must be rc=0 (or the only deltas are main-side files disjoint from the PR's files, measured). Then gh pr merge <n> --squash --body-file <file ending "Agent: fix-lane-<shortId>" as last line>. Verify the merge commit carries the trailer.

RECORD: comment the todos row with root cause, PR number, merge sha, acceptance line. Save a memento. Return the schema.

NEVER publish to npm (publish-all owns publishing).`, { label: 'exec-row:' + row.shortId, phase: 'Execute', schema: EXEC_SCHEMA })
  }))
  results.forEach((exec, i) => { if (exec) execs.push({ row: wave[i], exec }) })
  log('task-drain-apps: pass ' + pass + ' wave ' + (w / MAX_CONCURRENT + 1) + ' done — ' + results.filter(Boolean).length + '/' + wave.length + ' rows completed')
}
  passes.push({ pass, census, execs })
  log('task-drain-apps: pass ' + pass + ' done — ' + execs.length + ' rows executed, ' + (census ? census.queueSize : 0) + ' unowned BUG/UNVERIFIED rows remain — next pass re-censuses (bounded loop)')
}
if (pass > MAX_PASSES) log('task-drain-apps: MAX_PASSES reached (' + MAX_PASSES + ') — bounded run ends; the coordinator re-launches this workflow for standing continuity')

const allExecs = passes.flatMap(p => p.execs)

phase('Record')
const record = await safeAgent(`${RECORDING}
Record the task-drain-apps run (${passes.length} pass(es)). Post one line to #apps: "task-drain-apps: ${allExecs.map(e => e.row.shortId + ' ' + (e.exec ? e.exec.outcome : 'unknown') + (e.exec && e.exec.prNumber ? ' PR #' + e.exec.prNumber : '') + (e.exec && e.exec.mergeSha ? ' merged ' + e.exec.mergeSha : '')).join('; ')}". Save mementos: mementos save 'task-drain-apps-2026-08-23' '<two-sentence summary>'. Return {posted: true}.`, { label: 'record', phase: 'Record' })

return {
  status: allExecs.length === 0 ? 'task-drain-apps-empty' : (allExecs.length === 1 ? ('task-drain-apps-' + allExecs[0].exec.outcome) : 'task-drain-apps-multi'),
  rows: allExecs.map(e => ({ id: e.row.id, shortId: e.row.shortId })),
  execs: allExecs.map(e => e.exec),
  passes: passes.map(p => ({ pass: p.pass, queueSize: p.census ? p.census.queueSize : 0 })),
  queueSize: passes.length ? (passes[passes.length - 1].census ? passes[passes.length - 1].census.queueSize : 0) : 0,
  record,
}
