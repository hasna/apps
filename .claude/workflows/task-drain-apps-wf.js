export const meta = {
  name: 'task-drain-apps',
  description: 'Standing hasna/apps task drain, drain-to-zero: census unowned pending BUG rows in project 3bbc22e0, execute rows via the fix-lane discipline (idempotency gate, worktree, PR-first, one Fable review, merge), re-census each pass and loop while rows remain (hard bound MAX_PASSES), record at the end',
  phases: [
    { title: 'Census' },
    { title: 'Execute' },
    { title: 'Record' },
  ],
}

// Parallelism (owner 2026-08-25): MULTIPLE fix agents per pass, each working a
// DIFFERENT row in its OWN task worktree via hasna/repos (repos CLI worktree
// verb; ~/.hasna/repos/worktrees/apps/<row.id>). Bounded by MAX_ROWS rows per
// pass and MAX_CONCURRENT agents per wave (default 3 each; args override).
// Safe parallel execution requires (a) rows-per-pass bounded, (b) a claim
// comment on each row at execution start (the census excludes active claims),
// and (c) each agent works ONLY in its own worktree — never the shared checkout.
const MAX_ROWS = (args && args.maxRows) || 3
const MAX_CONCURRENT = (args && args.maxConcurrent) || 3
// INFINITE SESSION-SCOPED LOOP (owner 2026-08-25): no pass bound. When the queue
// is empty the census agent itself sleeps ~5 min and re-checks once, so the run
// stays alive at ~1 agent per idle window. PRIORITY YIELD: when any HOTFIX: row
// exists in this project, the lane yields — the hotfix-drain lane owns it.
// Stop = owner stops the run or the session ends.
const CLAIM_TAG = 'task-drain-apps claim'

const CENSUS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['candidates', 'queueSize', 'blocked'],
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['id', 'shortId', 'title', 'createdAt', 'reason'],
        properties: {
          id: { type: 'string' },
          shortId: { type: 'string' },
          title: { type: 'string' },
          createdAt: { type: 'string' },
          reason: { type: 'string' },
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

// INFINITE SESSION-SCOPED LOOP (owner 2026-08-25): census -> execute -> wait ~5 min
// when idle -> re-census, forever. Idle wait lives INSIDE the census agent (bash
// sleep 300 + re-check). PRIORITY YIELD: any HOTFIX: row yields this lane to
// hotfix-drain. Stop = owner stops the run or the session ends.
const passes = []
let pass = 0
for (pass = 1; ; pass++) {
phase('Census')
const census = await agent(`Census the hasna/apps task-drain queue (todos project 3bbc22e0). PASS ${pass} of the infinite loop — re-census each pass; rows executed earlier in this run carry claims and are excluded.

PRIORITY YIELD CHECK FIRST: if any UNOWNED row's title starts with "HOTFIX:", the hotfix-drain lane owns the priority class: sleep 300 (bash), re-run the yield check once, and return {yielded: true, hotfixCount: N, candidates: [], queueSize: 0}. Do NOT enumerate BUG rows while yielding.

1. \`todos list --project 3bbc22e0 --status pending --json\` (redirect to a file, never pipe). Select rows whose title starts with "BUG".
2. Filter to UNOWNED rows (no assigned_to). For each, read the comments (rows carry comments in the list payload): a row whose comments already record "FIXED AT HEAD" or "MERGED" or "DUPLICATE of" is NOT a candidate — exclude it.
3. Dedupe against live fixers: \`gh pr list --repo hasna/apps --state open --json number,title\` — if an open PR's title names the row's shortId or clearly targets the same defect, exclude the row (blocked: live fixer).
4. Exclude any row whose comments carry an ACTIVE claim marker: a comment containing "${CLAIM_TAG}" with a timestamp younger than 90 minutes (another task-drain instance is executing it — never duplicate). Comments carrying "${CLAIM_TAG}" older than 90 minutes are STALE claims (the instance died) and the row is a candidate again.
5. Sort candidates by created_at ASC (oldest first — queue order).
6. Return the ordered candidates. Include rows already covered by a fix-lane in flight ONLY if their fix-lane is provably dead (transcript older than 60 min); otherwise exclude them (a live lane is a live fixer — never duplicate).

IF THE QUEUE IS EMPTY (no unowned BUG rows): sleep 300 (bash), re-run the census steps once, and return the RE-CHECK result — the lane waits ~5 min between passes while idle. NEVER return an empty result without the sleep+re-check having run.
Return candidates (max ${MAX_ROWS + 2}), queueSize (unowned BUG rows remaining), blocked (excluded rows with reasons), yielded (bool), hotfixCount (int).`, { label: 'census:' + pass, phase: 'Census', schema: CENSUS_SCHEMA })

const candidates = (census && census.candidates) || []
if (census && census.yielded) {
  log('task-drain-apps: pass ' + pass + ' YIELDED to hotfix-drain (' + (census.hotfixCount || 0) + ' HOTFIX: row(s)) — waited inside the census, re-checking next pass')
  continue
}
if (candidates.length === 0) {
  log('task-drain-apps: pass ' + pass + ' queue empty — the census waited ~5 min and re-checked; re-checking next pass')
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
  const results = await parallel(wave.map((row) => () =>
    agent(`Execute ONE hasna/apps BUG row via the fix-lane discipline. Row: ${JSON.stringify(row)}. You are ONE OF ${Math.min(MAX_CONCURRENT, wave.length)} CONCURRENT fix agents — each works its OWN row in its OWN worktree; never touch another agent's worktree, never the shared checkout.

CLAIM FIRST: comment the row now — \`todos comment <row.id> "${CLAIM_TAG} — executing <shortId> $(date -u +%Y-%m-%dT%H:%MZ)"\` (a concurrent task-drain instance's census excludes rows with a claim younger than 90 min; your claim prevents double-picking).

WORKTREE (your own, via hasna/repos): create ~/.hasna/repos/worktrees/apps/<row.id> from origin/main with the repos CLI worktree verb (repos worktree add ... or git worktree add; run repos scan after). Branch named after the task. NEVER work in another agent's worktree and never in the shared checkout — each agent's worktree path is unique per row id, which is what makes concurrent execution safe.

IDEMPOTENCY GATE — stop with outcome 'idempotency-stop' if any holds:
(a) the defect no longer reproduces at origin/main head (git fetch + reproduce or code-read the exact failure);
(b) a live fixer/PR already exists for it (gh pr list --repo hasna/apps --state open — title names the shortId or clearly targets the defect);
(c) the row is no longer pending.
(An idempotency-stop still leaves your claim comment; the census treats claims older than 90 min as stale.)

Else: implement the fix in YOUR worktree. Regression test first (write the failing test, confirm it fails, then fix). Verify: the package's test suite green, bun run check rc=0 at your worktree root, secrets scan staged rc=0 with real bytes. Commit with a Conventional Commit message ending "Agent: fix-lane-<shortId>" (never Co-Authored-By). Push and open the PR (gh pr create, body = what/why + verification lines + task id, ending "Agent: fix-lane-<shortId>").

REVIEW: one Fable adversarial review of the exact PR head (bounded, at most two remediation cycles; a third NO_GO terminates the candidate with findings recorded — outcome 'skipped'). Fix concrete P0/P1 findings in the worktree and re-review.

MERGE: on [REVIEW] GO — verify the base-movement gate first: TREE=$(git merge-tree --write-tree origin/main <head>); git diff --quiet <reviewed-sha> "$TREE" must be rc=0 (or the only deltas are main-side files disjoint from the PR's files, measured). Then gh pr merge <n> --squash --body-file <file ending "Agent: fix-lane-<shortId>" as last line>. Verify the merge commit carries the trailer.

RECORD: comment the todos row with root cause, PR number, merge sha, acceptance line. Save a memento. Return the schema.

NEVER publish to npm (publish-all owns publishing).`, { label: 'exec-row:' + row.shortId, phase: 'Execute', schema: EXEC_SCHEMA }),
  ))
  results.forEach((exec, i) => { if (exec) execs.push({ row: wave[i], exec }) })
  log('task-drain-apps: pass ' + pass + ' wave ' + (w / MAX_CONCURRENT + 1) + ' done — ' + results.filter(Boolean).length + '/' + wave.length + ' rows completed')
}
  passes.push({ pass, census, execs })
  log('task-drain-apps: pass ' + pass + ' done — ' + execs.length + ' rows executed, ' + (census ? census.queueSize : 0) + ' unowned BUG rows remain — next pass re-censuses (infinite loop)')
}

const allExecs = passes.flatMap(p => p.execs)

phase('Record')
const record = await agent(`Record the task-drain-apps run (${passes.length} pass(es)). Post one line to #apps: "task-drain-apps: ${allExecs.map(e => e.row.shortId + ' ' + (e.exec ? e.exec.outcome : 'unknown') + (e.exec && e.exec.prNumber ? ' PR #' + e.exec.prNumber : '') + (e.exec && e.exec.mergeSha ? ' merged ' + e.exec.mergeSha : '')).join('; ')}". Save mementos: mementos save 'task-drain-apps-2026-08-23' '<two-sentence summary>'. Return {posted: true}.`, { label: 'record', phase: 'Record' })

return {
  status: allExecs.length === 0 ? 'task-drain-apps-empty' : (allExecs.length === 1 ? ('task-drain-apps-' + allExecs[0].exec.outcome) : 'task-drain-apps-multi'),
  rows: allExecs.map(e => ({ id: e.row.id, shortId: e.row.shortId })),
  execs: allExecs.map(e => e.exec),
  passes: passes.map(p => ({ pass: p.pass, queueSize: p.census ? p.census.queueSize : 0 })),
  queueSize: passes.length ? (passes[passes.length - 1].census ? passes[passes.length - 1].census.queueSize : 0) : 0,
  record,
}
