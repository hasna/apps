export const meta = {
  name: 'propagate-lanes-to-monorepos',
  description: 'Standing propagation lane (owner 2026-08-25): 4 agents in parallel per phase — checks the internal-apps, harnesses, business-engines, and products monorepos, implements the applicable workflows from this store into each target\'s OWN .claude/workflows/ (parameterized per tree), each in its own worktree via hasna/repos, PR-first, independent adversarial GO/NO-GO gate per PR, merge on GO, then updates the ~/.hasna/repos/clones target clone and posts to the target\'s conversations channel. Infinite session-scoped loop; drift-check census (idle wait ~30 min); yields to hotfix-drain.',
  phases: [
    { title: 'Census', detail: 'resolve the 4 target repos via repos CLI; drift-check each target\'s .claude/workflows vs this store; yield + idle-wait' },
    { title: 'Propagate', detail: '4 agents in parallel, one per target: own worktree via hasna/repos, parameterize + write applicable workflows flat, open PR' },
    { title: 'Review', detail: '4 independent adversarial reviewers in parallel, one per PR: GO/NO-GO on mechanical scope' },
    { title: 'Land', detail: '4 agents in parallel: base-movement gate, merge on GO, pull the clone, post to the target channel' },
  ],
}

const SOURCE = '/home/hasna/.hasna/repos/clones/hasna/apps/.claude/workflows'
const CLONES = '/home/hasna/.hasna/repos/clones'
const TARGETS = ['internal-apps', 'harnesses', 'business-engines', 'products']
const APPS_PROJECT = '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'

const CONST = `
You are a phase of the propagate-lanes-to-monorepos workflow (owner-directed 2026-08-25). Mission: propagate the applicable standing workflows from the hasna/apps store (${SOURCE}) into each target monorepo's OWN .claude/workflows/ — parameterized for that tree (repo path, todos project, npm org, ECS surface, channels), NOT copied verbatim. Each target is handled by its own agent in its own worktree via hasna/repos, lands a PR, gets an independent adversarial GO/NO-GO, merges on GO, updates the clone, posts to the target channel. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- Work ONLY in your own task worktree at ~/.hasna/repos/worktrees/<repo>/<worktree> created via the repos CLI (repos worktree add ... or git worktree add; run repos scan after) from origin/main. Never the shared checkout, never main, never another agent's worktree.
- PR-first: branch from origin/main, commit with 'Agent: propagate-<target>-<your-role>' (the ONLY attribution line), open the PR, and NEVER merge without an independent [REVIEW] GO.
- PARAMETERIZE, never copy verbatim: replace the hasna/apps specifics (monorepo path, todos project 3bbc22e0, npm org @hasna, oss-fleet-prod ECS surface, #board/#apps channels) with the target's actual values — resolve them live (repos repo <target> --json for the exact path; todos projects list for the target's project id; the target's package.json scopes for npm orgs; the target's deploy surface or none). A lane that does NOT apply to the target (e.g. deploy-apps where the target has no service surface, publish-all where the target publishes no public packages) is SKIPPED with the reason recorded — never force-fit.
- Which lanes apply: the standing set from ${SOURCE} — pr-drain-wf.js, task-drain-<target>-wf.js (renamed per target), publish-<target>-wf.js, deploy-<target>-wf.js (only if the target has a deploy surface), hotfix-drain-wf.js, github-issues-to-todos-wf.js, stale-tasks-wf.js, stale-pr-drain-wf.js, fix-lane-wf.js, ship-latest-wf.js (only if the target does npm releases), move-app-to-internal-wf.js (only where relevant) — each parameterized. Keep the drain-to-zero/infinite-loop shape, the hotfix yield check, the 2-agent live GO/NO-GO gates on publish/deploy, and the idle-wait-inside-census pattern intact — the shape is the point.
- No secrets: never print/capture/commit credential values; staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings in published artifacts. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Gates before every commit/push: staged secrets scan rc=0 with real bytes.
- Record as you go: comments on the target's PRs, posts to the target's channel. English. Distinguish measured vs inferred; state what you did not check.
- NEVER run bash -x / set -x (trace mode) — the shell profile sources ~/.hasna/cloud/*.env and trace echoes credential lines into the transcript.
- PRIORITY YIELD: if any UNOWNED row in todos project ${APPS_PROJECT} has a title starting with "HOTFIX:", the hotfix-drain lane owns the priority class — sleep 1800 (bash), re-check once, return {yielded: true, hotfixCount: N}.
`

const CENSUS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['targets'],
  properties: {
    targets: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'path', 'remote', 'needsPropagation'],
        properties: {
          name: { type: 'string' },
          path: { type: 'string' },
          remote: { type: 'string' },
          needsPropagation: { type: 'boolean' },
          reason: { type: 'string' },
          channel: { type: 'string' },
          openPropagatePr: { type: ['integer', 'null'] },
        },
      },
    },
    yielded: { type: 'boolean' },
    hotfixCount: { type: 'integer' },
  },
}
const PROPAGATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['target', 'prNumber', 'status'],
  properties: {
    target: { type: 'string' },
    prNumber: { type: ['integer', 'null'] },
    status: { enum: ['pr-opened', 'nothing-to-do', 'failed'] },
    worktree: { type: 'string' },
    lanesWritten: { type: 'array', items: { type: 'string' } },
    lanesSkipped: { type: 'array', items: { type: 'string' } },
    reasons: { type: 'array', items: { type: 'string' } },
    failures: { type: 'array', items: { type: 'string' } },
  },
}
const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['target', 'verdict'],
  properties: {
    target: { type: 'string' },
    verdict: { enum: ['GO', 'NO_GO'] },
    findings: { type: 'array', items: { type: 'object' } },
  },
}
const LAND_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['target', 'merged'],
  properties: {
    target: { type: 'string' },
    merged: { type: 'boolean' },
    mergedSha: { type: ['string', 'null'] },
    cloneUpdated: { type: 'boolean' },
    postId: { type: ['string', 'null'] },
    failures: { type: 'array', items: { type: 'string' } },
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

// INFINITE SESSION-SCOPED LOOP (owner 2026-08-25): census -> propagate (4 parallel)
// -> review (4 parallel) -> land (4 parallel) -> wait ~30 min when nothing drifted
// -> re-census, forever. Idle wait lives INSIDE the census agent (bash sleep 1800
// + re-check). Stop = owner stops the run or the session ends.
let pass = 0
for (;;) {
  pass++
phase('Census')
const census = await safeAgent(censusPrompt(`${CONST}
ROLE: census (Opus). PASS ${pass} of the infinite loop.
PRIORITY YIELD CHECK FIRST: todos list --project ${APPS_PROJECT} --status pending --json (redirect to a file, never pipe) — if any UNOWNED row's title starts with "HOTFIX:", sleep 1800 (bash), re-check once, return {targets: [], yielded: true, hotfixCount: N}.

STEP 1 — RESOLVE the 4 targets (${TARGETS.join(', ')}): for EACH, 'repos repo <name> --json' (redirect to a file, never pipe) -> {name, path, remote}. Record the EXACT canonical path and remote. If a name is ambiguous or missing, record it as needsPropagation: false with the reason — never guess a path.
STEP 2 — DRIFT-CHECK each target: list ${SOURCE}/*.js (the source store); list <target-path>/.claude/workflows/*.js (if the dir exists). A target needsPropagation when: its .claude/workflows/ is missing ANY source lane that applies to it, OR any present lane differs materially from the source shape (parameterized values are expected — the drift check is on the SHAPE: infinite-loop pattern, hotfix yield, 2-agent gates, idle-wait; a lane that is absent where it applies = drift). Resolve the target's conversations channel name (conversations channels list, bounded; or the target's project row via projects CLI) for the Land phase.
IN-FLIGHT CHECK (measured 2026-08-25 — a target whose propagate PR is open must NOT be re-propagated, or every pass opens a duplicate PR): gh pr list --repo <org>/<target> --state open --json number,headRefName (redirect to a file, never pipe). If an OPEN PR carries a branch named 'propagate/lanes-<target>', FORCE needsPropagation: false with reason 'open propagate PR #N in flight — no duplicate' and record openPropagatePr: N.
STEP 3 — IDLE WAIT: if NO target needsPropagation, sleep 1800 (bash — 30 min), re-run steps 1-2 once, and return the RE-CHECK result. NEVER return all-false needsPropagation without the sleep+re-check having run.
Return {targets: [{name, path, remote, needsPropagation, reason, channel}], yielded, hotfixCount}.`, { label: 'propagate-census:' + pass, phase: 'Census', schema: CENSUS_SCHEMA, model: 'opus' }))
if (census && census.yielded) {
  log('propagate pass ' + pass + ': YIELDED to hotfix-drain (' + (census.hotfixCount || 0) + ' HOTFIX: row(s)) — waited 30 min inside the census, re-checking next pass')
  continue
}
const targets = (census && census.targets) || []
const toPropagate = targets.filter(t => t.needsPropagation)
if (toPropagate.length === 0) {
  log('propagate pass ' + pass + ': no target drifted — the census waited 30 min and re-checked; re-checking next pass')
  continue
}
log('propagate pass ' + pass + ': ' + toPropagate.length + ' target(s) need propagation: ' + toPropagate.map(t => t.name).join(', '))

// PROPAGATE — 4 agents in parallel, one per target (the step cap)
phase('Propagate')
const propagated = await parallel(toPropagate.map((t) => () =>
  safeAgent(`${CONST}
ROLE: propagate ${t.name} (path ${t.path}, remote ${t.remote}). You own THIS ONE target.
0. NO-DUPLICATE GUARD: if an open PR with a branch named 'propagate/lanes-${t.name}' already exists on ${t.remote} (gh pr list --repo <org>/<target> --state open --json number,headRefName), DO NOT open another — return {target, prNumber: <the existing PR number>, status: 'nothing-to-do', reason: 'open PR #<n> in flight — no duplicate'}. Only proceed when no such PR exists.
1. OWN WORKTREE via hasna/repos: create ~/.hasna/repos/worktrees/<repo-name>/propagate-lanes from origin/main with the repos CLI worktree verb (repos worktree add ... or git worktree add; run repos scan after). Branch propagate/lanes-<target>. NEVER the shared checkout, never another agent's worktree.
2. PARAMETERIZE + WRITE the applicable lanes from ${SOURCE} into <worktree>/.claude/workflows/ (flat — NO scripts/ subdirectory): read each source lane, replace the hasna/apps specifics with ${t.name}'s actual values (resolve live: the target's todos project id, npm orgs from its package.json scopes, its deploy surface or none, its channel), keep the infinite-loop shape, the hotfix yield check, the 2-agent live GO/NO-GO publish/deploy gates, and the idle-wait-inside-census pattern INTACT. Rename per target (task-drain-<target>, publish-<target>, deploy-<target> where applicable). SKIP lanes that do not apply, with the reason recorded. If the target already has .claude/workflows/ lanes, merge the shape (parameterize what exists, add what's missing) — never clobber a target's own lane.
3. VERIFY before commit: node --check on every written lane; grep that each standing lane carries the infinite loop, the yield check, and its gates; staged secrets scan rc=0 with real bytes.
4. PR-FIRST: commit ('Agent: propagate-${t.name}-build'), push, open the PR: title 'chore(workflows): propagate standing lanes into ${t.name} .claude/workflows', body = the lane table (written/skipped + reasons) + the parameterization notes + verification lines, ending 'Agent: propagate-${t.name}-build'.
Return {target, prNumber, status, worktree, lanesWritten, lanesSkipped, reasons, failures}.`, { label: 'propagate-' + t.name + ':' + pass, phase: 'Propagate', schema: PROPAGATE_SCHEMA, model: 'sonnet' }),
))
const prs = propagated.filter(Boolean).filter(p => p.prNumber)
log('propagate pass ' + pass + ': ' + prs.length + ' PR(s) opened: ' + prs.map(p => p.target + '#' + p.prNumber).join(', '))

// REVIEW — 4 independent adversarial reviewers in parallel, one per PR
phase('Review')
const reviews = await parallel(prs.map((p) => () =>
  safeAgent(`${CONST}
ROLE: adversarial reviewer (Fable) for ${p.target} PR #${p.prNumber}. Review the PR at its CURRENT head (gh pr view ${p.prNumber} --json headRefOid,state): the diff is workflow files ONLY under .claude/workflows/ (any other tree touched is a P0 NO_GO); the lanes are PARAMETERIZED for ${p.target} (repo path, todos project, npm org, deploy surface — no hasna/apps hardcodes left); the infinite-loop shape, hotfix yield check, 2-agent live GO/NO-GO gates, and idle-wait-inside-census pattern are INTACT in every standing lane; naming is bare kebab-case with no scripts/ subdirectory; no secrets, no internal-infra strings; node --check clean on every lane; skipped lanes carry reasons. Post '[REVIEW] <GO|NO_GO> — ${p.target}#${p.prNumber} @ <sha> — lens: workflow propagation, reviewer propagate-review' on the PR. Block ONLY concrete P0/P1 defects; at most two remediation cycles (the propagate agent fixes the named findings, same reviewer re-reviews only those). Return {target, verdict, findings}.`, { label: 'review-' + p.target + ':' + pass, phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' }),
))
const goPrs = prs.filter((p, i) => reviews[i] && reviews[i].verdict === 'GO')
const noGoPrs = prs.filter((p, i) => !(reviews[i] && reviews[i].verdict === 'GO'))
log('review pass ' + pass + ': GO ' + goPrs.length + ', NO_GO ' + noGoPrs.length + (noGoPrs.length ? ' (' + noGoPrs.map(p => p.target + '#' + p.prNumber).join(', ') + ' — remediation next pass)' : ''))

// LAND — 4 agents in parallel, one per GO'd PR
phase('Land')
const landed = await parallel(goPrs.map((p) => () =>
  safeAgent(`${CONST}
ROLE: land ${p.target} PR #${p.prNumber}. Per the CONST:
1. Verify head unchanged since the verdict (gh pr view ${p.prNumber} --json headRefOid == the reviewed sha) and the base-movement gate: TREE=$(git -C <target-path> merge-tree --write-tree origin/main <head>); git diff --quiet <head> "$TREE" must be rc=0 (or the only deltas are main-side files disjoint from the PR's files, measured).
2. MERGE: gh pr merge ${p.prNumber} --squash --body-file <file ending 'Agent: propagate-${p.target}-ship' as last line>. Verify the merge commit carries the trailer.
3. UPDATE THE CLONE: git -C ${CLONES}/<org>/<repo> pull --ff-only (the target's canonical clone under ${CLONES}) — verify the pull landed (git -C <clone> rev-parse HEAD == the merged sha on the remote).
4. POST to the target's channel (${'${CHANNEL}'} — the channel the census resolved): 'propagate-lanes: ${p.target} — standing lanes installed into .claude/workflows (PR #${p.prNumber} merged <sha>)' with the lane list.
Return {target, merged, mergedSha, cloneUpdated, postId, failures}.`, { label: 'land-' + p.target + ':' + pass, phase: 'Land', schema: LAND_SCHEMA, model: 'sonnet' }),
))
log('land pass ' + pass + ': ' + landed.filter(Boolean).filter(l => l.merged).length + ' merged, clones updated, channels posted')

if (noGoPrs.length) {
  log('propagate pass ' + pass + ': NO_GO PRs (' + noGoPrs.map(p => p.target + '#' + p.prNumber).join(', ') + ') stay open with the review findings on them — the propagate agent remediates the named findings on the next pass')
}
}
