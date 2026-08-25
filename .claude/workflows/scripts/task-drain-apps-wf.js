export const meta = {
  name: 'task-drain-apps',
  description: 'Standing hasna/apps task drain, drain-to-zero: census unowned pending BUG rows in project 3bbc22e0, execute rows via the fix-lane discipline (idempotency gate, worktree, PR-first, one Fable review, merge), re-census each pass and loop while rows remain (hard bound MAX_PASSES), record at the end',
  phases: [
    { title: 'Census' },
    { title: 'Execute' },
    { title: 'Record' },
  ],
}

// Parallelism: this lane may run in up to 2 concurrent instances (owner-approved 2026-08-23).
// Safe parallel execution requires (a) rows-per-pass bounded (default 2, args.maxRows override)
// and (b) a claim comment on each row at execution start, which the census excludes.
const MAX_ROWS = (args && args.maxRows) || 2
const MAX_PASSES = (args && args.maxPasses) || 4 // drain-to-zero hard bound; the standing watchdog relaunches if the bound is hit
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

// DRAIN-TO-ZERO LOOP (owner design 2026-08-25): each pass re-censuses; while
// unowned BUG rows remain the pass restarts. The loop exits when the census
// returns no candidates (queue drained) or MAX_PASSES is hit (watchdog relaunches).
const passes = []
let pass = 0
for (pass = 1; pass <= MAX_PASSES; pass++) {
phase('Census')
const census = await agent(`Census the hasna/apps task-drain queue (todos project 3bbc22e0). PASS ${pass} of ${MAX_PASSES} — re-census each pass; rows executed earlier in this run carry claims and are excluded.

1. \`todos list --project 3bbc22e0 --status pending --json\` (redirect to a file, never pipe). Select rows whose title starts with "BUG".
2. Filter to UNOWNED rows (no assigned_to). For each, read the comments (rows carry comments in the list payload): a row whose comments already record "FIXED AT HEAD" or "MERGED" or "DUPLICATE of" is NOT a candidate — exclude it.
3. Dedupe against live fixers: \`gh pr list --repo hasna/apps --state open --json number,title\` — if an open PR's title names the row's shortId or clearly targets the same defect, exclude the row (blocked: live fixer).
4. Exclude any row whose comments carry an ACTIVE claim marker: a comment containing "${CLAIM_TAG}" with a timestamp younger than 90 minutes (another task-drain instance is executing it — never duplicate). Comments carrying "${CLAIM_TAG}" older than 90 minutes are STALE claims (the instance died) and the row is a candidate again.
5. Sort candidates by created_at ASC (oldest first — queue order).
6. Return the ordered candidates. Include rows already covered by a fix-lane in flight ONLY if their fix-lane is provably dead (transcript older than 60 min); otherwise exclude them (a live lane is a live fixer — never duplicate).

Return candidates (max ${MAX_ROWS + 2}), queueSize (unowned BUG rows remaining), blocked (excluded rows with reasons).`, { label: 'census:' + pass, phase: 'Census', schema: CENSUS_SCHEMA })

const candidates = (census && census.candidates) || []
if (candidates.length === 0) {
  log('task-drain-apps: pass ' + pass + ' drained — no unowned BUG rows remain')
  break
}

phase('Execute')
// Up to MAX_ROWS rows per pass, executed SEQUENTIALLY (one agent per row). Each row is
// claimed with a comment before execution so concurrent instances never double-pick it.
const rowsToRun = candidates.slice(0, MAX_ROWS)
const execs = []
for (const row of rowsToRun) {
  log('task-drain-apps: pass ' + pass + ' executing row ' + row.shortId + ' — ' + row.title.slice(0, 80))
const exec = await agent(`Execute ONE hasna/apps BUG row via the fix-lane discipline. Row: ${JSON.stringify(row)}.

CLAIM FIRST: comment the row now — \`todos comment <row.id> "${CLAIM_TAG} — executing <shortId> $(date -u +%Y-%m-%dT%H:%MZ)"\` (a concurrent task-drain instance's census excludes rows with a claim younger than 90 min; your claim prevents double-picking).

IDEMPOTENCY GATE — stop with outcome 'idempotency-stop' if any holds:
(a) the defect no longer reproduces at origin/main head (git fetch + reproduce or code-read the exact failure);
(b) a live fixer/PR already exists for it (gh pr list --repo hasna/apps --state open — title names the shortId or clearly targets the defect);
(c) the row is no longer pending.
(An idempotency-stop still leaves your claim comment; the census treats claims older than 90 min as stale.)

Else: implement the fix in a task worktree at ~/.hasna/repos/worktrees/apps/<row.id> (branch from origin/main, named after the task; repos CLI worktree verb preferred, git worktree add otherwise). Regression test first (write the failing test, confirm it fails, then fix). Verify: the package's test suite green, bun run check rc=0 at repo root, secrets scan staged rc=0 with real bytes. Commit with a Conventional Commit message ending "Agent: fix-lane-<shortId>" (never Co-Authored-By). Push and open the PR (gh pr create, body = what/why + verification lines + task id, ending "Agent: fix-lane-<shortId>").

REVIEW: one Fable adversarial review of the exact PR head (bounded, at most two remediation cycles; a third NO_GO terminates the candidate with findings recorded — outcome 'skipped'). Fix concrete P0/P1 findings in the worktree and re-review.

MERGE: on [REVIEW] GO — verify the base-movement gate first: TREE=$(git merge-tree --write-tree origin/main <head>); git diff --quiet <reviewed-sha> "$TREE" must be rc=0 (or the only deltas are main-side files disjoint from the PR's files, measured). Then gh pr merge <n> --squash --body-file <file ending "Agent: fix-lane-<shortId>" as last line>. Verify the merge commit carries the trailer.

RECORD: comment the todos row with root cause, PR number, merge sha, acceptance line. Save a memento. Return the schema.

NEVER publish to npm (publish-all owns publishing). Never touch the shared checkout.`, { label: 'exec-row:' + row.shortId, phase: 'Execute', schema: EXEC_SCHEMA })

  execs.push({ row, exec })
}
  passes.push({ pass, census, execs })
  log('task-drain-apps: pass ' + pass + ' done — ' + execs.length + ' rows executed, ' + (census ? census.queueSize : 0) + ' unowned BUG rows remain')
  if (!census || census.queueSize === 0) {
    log('task-drain-apps: queue drained at pass ' + pass)
    break
  }
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
