export const meta = {
  name: 'hotfix-drain',
  description: 'Standing hotfix lane (owner 2026-08-25): the PRIORITY class. Infinite session-scoped loop draining pending unowned rows titled "HOTFIX:" in todos project 3bbc22e0 via the fix-lane discipline (worktree, regression-first, PR, Fable review, merge, record). While any HOTFIX: row exists, every other standing lane YIELDS to this one (their census detects the rows and waits). Idle: census waits ~5 min between checks. Stop: owner stops the run or the session ends.',
  phases: [
    { title: 'Census', detail: 'pending unowned HOTFIX: rows in 3bbc22e0; exclude live fixers and active claims; wait ~5 min when empty' },
    { title: 'Execute', detail: 'one hotfix at a time via fix-lane discipline: worktree, regression-test-first, PR, one Fable review, merge, record' },
    { title: 'Record', detail: 'comment row, post #apps, memento' },
  ],
}

const APPS = '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'
const CLAIM_TAG = 'hotfix-drain claim'
const MAX_ROWS = (args && args.maxRows) || 1 // hotfixes are priority: one at a time, fast

const CENSUS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['candidates', 'hotfixCount'],
  properties: {
    candidates: { type: 'array', items: { type: 'object' } },
    hotfixCount: { type: 'integer' },
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

// INFINITE SESSION-SCOPED LOOP (owner 2026-08-25): census -> execute -> wait ~5 min
// when idle -> re-census, forever. Stop = owner stops the run or the session ends.
// Idle wait lives INSIDE the census agent (bash sleep 300 + re-check), so the run
// stays alive at ~1 agent per idle window, never burning tokens while waiting.
// Per-pass recording happens inside the loop (the exec agent comments + posts);
// there is no post-loop phase because the loop never exits by design.
let pass = 0
const allExecs = []
for (;;) {
  pass++
phase('Census')
const census = await safeAgent(censusPrompt(`Census the hotfix queue (todos project ${APPS}) — PASS ${pass} of the infinite loop. HOTFIX rows are the PRIORITY class: title starts with "HOTFIX:" (machine-greppable convention, owner 2026-08-25).

1. \`todos list --project ${APPS} --status pending --json\` (redirect to a file, never pipe). Select rows whose title starts with "HOTFIX:".
2. Filter to UNOWNED rows (no assigned_to). Exclude rows whose comments already record "FIXED AT HEAD"/"MERGED"/"DUPLICATE of".
3. Dedupe against live fixers: \`gh pr list --repo hasna/apps --state open --json number,title\` — an open PR naming the row's shortId or clearly targeting the same defect excludes the row (blocked: live fixer).
4. Exclude rows with an ACTIVE claim (a comment containing "${CLAIM_TAG}" younger than 90 min); claims older than 90 min are stale and the row is a candidate again.
5. Sort candidates by created_at ASC (oldest first — the priority queue).

IF THE QUEUE IS EMPTY: \`sleep 300\` (bash), re-run the census steps once, and return the re-check result — the lane waits ~5 min between checks while idle. NEVER return a fabricated empty-hotfix state: if the re-check found hotfixes, return them.
Return candidates (max ${MAX_ROWS + 1}), hotfixCount (pending unowned HOTFIX: rows), blocked (excluded with reasons).`, { label: 'hotfix-census:' + pass, phase: 'Census', schema: CENSUS_SCHEMA, model: 'opus' }))

const candidates = (census && census.candidates) || []
if (candidates.length === 0) {
  log('hotfix-drain pass ' + pass + ': queue empty (or yielded) — idle-waited inside the census; re-checking next pass')
  continue
}

phase('Execute')
const rowsToRun = candidates.slice(0, MAX_ROWS)
const execs = []
for (const row of rowsToRun) {
  log('hotfix-drain: executing ' + row.shortId + ' — ' + (row.title || '').slice(0, 80))
const exec = await safeAgent(`Execute ONE HOTFIX row via the fix-lane discipline — this is the PRIORITY class, move fast but correct. Row: ${JSON.stringify(row)}.

CLAIM FIRST: comment the row now — \`todos comment <row.id> "${CLAIM_TAG} — executing <shortId> $(date -u +%Y-%m-%dT%H:%MZ)"\`.

IDEMPOTENCY GATE — outcome 'idempotency-stop' if any holds: (a) the defect no longer reproduces at origin/main head (git fetch + reproduce or code-read the exact failure); (b) a live fixer/PR already exists (gh pr list --repo hasna/apps --state open — title names the shortId or clearly targets the defect); (c) the row is no longer pending.

Else implement in a task worktree at ~/.hasna/repos/worktrees/apps/<row.id> (branch from origin/main). Regression test FIRST (write the failing test, confirm it fails, then fix). Verify: the package suite green, bun run check rc=0 at repo root, secrets scan staged rc=0 with real bytes. Commit with a Conventional Commit message ending "Agent: hotfix-drain-<shortId>" (never Co-Authored-By). Push and open the PR (gh pr create, body = what/why + verification lines + task id, ending "Agent: hotfix-drain-<shortId>").

REVIEW: one Fable adversarial review of the exact PR head (bounded, at most two remediation cycles; a third NO_GO terminates the candidate with findings recorded — outcome 'skipped'). Fix concrete P0/P1 findings and re-review.

MERGE: on [REVIEW] GO — base-movement gate first: TREE=$(git merge-tree --write-tree origin/main <head>); git diff --quiet <reviewed-sha> "$TREE" must be rc=0 (or the only deltas are main-side files disjoint from the PR's files, measured). Then gh pr merge <n> --squash --body-file <file ending "Agent: hotfix-drain-<shortId>" as last line>. Verify the merge commit carries the trailer.

RECORD: comment the todos row with root cause, PR number, merge sha, acceptance line. Post one line to #apps: "HOTFIX SHIPPED: <shortId> — PR #<n> merged <sha>". Save a memento. Return the schema.

NEVER publish to npm (publish-all owns publishing). Never touch the shared checkout.`, { label: 'hotfix-exec:' + row.shortId, phase: 'Execute', schema: EXEC_SCHEMA, model: 'sonnet' })
  execs.push({ row, exec })
  allExecs.push({ row, exec })
}
log('hotfix-drain pass ' + pass + ': ' + execs.length + ' hotfix(es) executed, ' + (census ? census.hotfixCount : 0) + ' remain — next pass re-censuses')
}
