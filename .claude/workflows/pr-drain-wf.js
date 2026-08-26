export const meta = {
  name: 'pr-drain',
  description: 'Standing PR review-fix-merge drain, drain-to-zero (owner-authorized 2026-08-18; WIDENED 2026-08-19 by owner: per-PR review lanes in waves of 12, census cap 45, merge width 6; LOOPED 2026-08-25 by owner: re-census each pass and restart while actionable PRs remain, hard bound MAX_PASSES): census open hasna/apps PRs, classify by state, rebase the conflicting, review the unreviewed at head, merge the GO\'d with base-movement gate, report residue',
  phases: [
    { title: 'Census', detail: 'open PRs -> mergeReady / needsRebase / needsReview / blocked / held-by-active-lane' },
    { title: 'Rebase', detail: 'conflicting PRs onto origin/main (unambiguous only)' },
    { title: 'Review', detail: 'adversarial review of unreviewed-at-head PRs — one independent reviewer agent per PR, run on the default model' },
    { title: 'Merge', detail: 'GO at head + base-movement gate, squash with attribution' },
    { title: 'Report', detail: 'per-PR state + residue' },
  ],
}

// hasna/apps todos project id (args-driven, 2026-08-26): args.project overrides;
// the standing hasna/apps project id is the default. Every use below
// interpolates ${APPS} — no hardcoded id.
const APPS = (args && args.project) || '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'
// Repo root (args-driven, 2026-08-26): args.repo overrides; default is the current
// clones layout (~/.hasna/repos/clones/hasna/apps). The superseded
// /home/hasna/.hasna/repos/clones/hasna/apps path is retired.
const MONOREPO = (args && args.repo) || '~/.hasna/repos/clones/hasna/apps'

// Pass bound (fleet ground truth 2026-08-26): the standing 'infinite' lane runs a
// BOUNDED pass loop — MAX_PASSES hard cap per run. Worst case ~20 agents per pass
// (1 census + up to 9 rebase batches + up to 4 review waves + up to 8 merge
// batches at the 45-PR cap), so 30 passes is ~600 agents — inside the runtime's
// 1,000-agent run cap, which stays the outer guard. Standing continuity comes
// from the COORDINATOR re-launching this workflow, never an unbounded in-script
// loop. args.maxPasses overrides.
const MAX_PASSES = Math.min(500, Math.max(1, Number(args && args.maxPasses) || 30))

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

const CONST = `
You are a lane of the pr-drain workflow (owner-authorized 2026-08-18, standing PR review-fix-merge drain). The drain keeps the hasna/apps PR queue moving: every pass takes the open PRs, classifies them, and advances each one — rebase the conflicting, review the unreviewed at head, merge the GO'd, record the blocked. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first: git -C ${MONOREPO} pull (fast-forward; never discard local work). Work in task worktrees ~/.hasna/repos/worktrees/apps/pr-drain-<n> from origin/main. Never push to main. Force-push (--force-with-lease) ONLY on the PR's own branch for a rebase. Merges ONLY via gh pr merge <n> --squash --body-file <file whose LAST line is 'Agent: pr-drain-<your-role>'>.
- IDEMPOTENCY FIRST: check state before acting (gh pr view <n> --json state,headRefOid,mergeable — projected fields). Merged/closed -> record and skip. A PR already carrying a [REVIEW] GO at its CURRENT head -> go to merge, never re-review.
- VERDICT DISCIPLINE: a merge requires a [REVIEW] GO at the CURRENT head sha (search 'conversations search "hasna/apps#<n>" --channel git-prs -j' AND the PR's comments; verdict sha must equal the current head). NO verdict at head -> REVIEW lane, not merge. NO_GO with open P0/P1 -> comment if not already, leave open, record as blocked.
- BASE-MOVEMENT GATE before every merge: TREE=$(git -C ${MONOREPO} merge-tree --write-tree origin/main <head>); git -C ${MONOREPO} diff --quiet <head> "$TREE" (equal OR the delta is disjoint from the PR's own files, verified with git diff --name-only). If main moved over the PR's own files -> needsRebase, never merge.
- ACTIVE-LANE RESPECT: a PR with a recent comment marker from an active workstream ([merge-open], 'modes-r3', 'contracts-r2', 'monitor-v2', 'backlog-', 'consolidate-r3', 'ship-latest') is HELD — do not touch it, record held. Never fight another lane over a PR. The version-wave PRs (label 'ship-latest' OR title 'Version Packages' OR head branch release/version-wave or version-wave-*) are EXCLUDED from this drain's review+merge set entirely — sole owner is the ship-latest workflow (Fable verdict A, 2026-08-19; measured 2026-08-19: the label does not exist on hasna/apps, so key on title+head branch too); record them as held, never review or merge them.
- No secrets: never print/capture/commit credential values; consume ONLY via 'secrets exec <key> --as VAR -- <cmd>'. Staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings in artifacts. Capture path: redirect to files, never pipe large reads. Paste literal output lines. NEVER run bash -x / set -x (trace mode) in this environment — the shell profile sources ~/.hasna/cloud/*.env (credential files) and trace echoed the sourced KEY=value lines into a transcript (measured: pr-drain-census, #incidents 736502, 2026-08-25).
- Authenticated API calls use 'gh api' ONLY. NEVER curl with an inline Bearer/token header — interpolating a token into a command argument records it in the transcript (measured: pr-drain-ship, #incidents 713084, 2026-08-19). gh api authenticates internally; there is no legitimate curl-with-token call in this lane.
${RECORDING}
- English. Lineage identity 'conversations agents register' named pr-drain-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const CENSUS = CONST + `
ROLE: census lane (execute). PRIORITY YIELD CHECK FIRST: todos list --project ${APPS} --status pending --json (redirect to a file, never pipe) — if any UNOWNED row's title starts with "HOTFIX:", the hotfix-drain lane owns the priority class: sleep 300 (bash), re-run the yield check once, and return {yielded: true, hotfixCount: N} with the per-class lists empty. Do NOT enumerate PRs while yielding.

Otherwise enumerate the open PRs on hasna/apps (gh pr list --repo hasna/apps --state open --limit 200 --json number,title,headRefName,headRefOid,mergeable,updatedAt — redirect to a file, never pipe). For EACH PR classify: (a) mergeReady — has a [REVIEW] GO at the current head AND mergeable AND base-fresh (verify the merge-tree gate); (b) needsRebase — conflicting, or base moved over its own files, or head stale; (c) needsReview — no [REVIEW] line at the current head; (d) blocked — NO_GO with open P0/P1 at head (record the finding titles); (e) held — a recent comment marker names an active workstream (see CONST); (f) ownerHeld — the decisions row (dd06739c) or a 'owner decision' comment names it. Cap the pass: process the 45 most recently updated PRs across classes (a)-(c) (owner-widened 2026-08-19); list (d)/(e)/(f) as counts. IF THE QUEUE IS EMPTY (no mergeReady/needsRebase/needsReview): sleep ${IDLE_SLEEP} (bash — the args-driven idle window, ${IDLE_MINUTES} min default), re-run the census once, and return the RE-CHECK result — the lane waits the idle window between passes while idle. NEVER return an empty result without the sleep+re-check having run.
Return (JSON): { mergeReady: [{number, head}], needsRebase: [{number, head}], needsReview: [{number, head}], blocked: [{number, findings: [string]}], held: [number], ownerHeld: [number], totals: {open, processed}, yielded: bool, hotfixCount: int }
`

const REBASE = CONST + `
ROLE: rebase lane (execute). PRs: {PRS} (each: number). For EACH: fetch the head (git -C ${MONOREPO} fetch origin pull/<n>/head:pr-drain-<n>; worktree ~/.hasna/repos/worktrees/apps/pr-drain-<n>; checkout -B <THE ACTUAL headRefName> pr-drain-<n> — never guess a branch name). git rebase origin/main. Resolve ONLY unambiguous conflicts (single-sided deletions, non-overlapping hunks); ambiguous -> ABORT, leave the PR open with a comment naming the conflict, record. After a clean rebase: run the touched app's tests (bounded 8 min, record counts), secrets scan the diff, push --force-with-lease, re-fetch the head, verify the base-movement gate (merge-tree == head). Comment the rebase on the PR (new head, tests, secrets).
Return (JSON): { prs: [{number, newHead, rebased: bool, conflict: string|null, tests: {passed, failed}, secretsClean: bool}] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (an independent reviewer agent run on the default model). PRs: {PRS} (each: number). For EACH: state-check first (gh pr view <n> --json state,headRefOid — projected); merged/closed -> record and skip. Review the diff vs origin/main at the current head: substance matches the PR's title/description, tests green (verify or record), secrets clean, scope confined, no mode vocabulary regression. Post '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: PR drain, reviewer pr-drain-review ({I} of {N})'. Block ONLY concrete P0/P1 defects; P2/P3 non-blocking (list as follow-ups). Mechanical chores (version bumps, docs-only, display-name) may GO on a bounded review (diff scope + secrets + tests), with the review noted as mechanical.
Return (JSON): { prs: [{number, verdict: GO|NO_GO, findings: [{severity, title, detail}]}] }
`

const MERGE = CONST + `
ROLE: merge lane (execute). PRs: {BATCH} (each: number). For EACH: verify head unchanged since the verdict (gh pr view <n> --json headRefOid == the reviewed sha), base-movement gate at CURRENT origin/main (re-measure; if the delta is not disjoint, send back to rebase, do not merge), then gh pr merge <n> --squash --body-file <file ending 'Agent: pr-drain-ship'>. Record the merged sha. NO_GO or unverified: comment and leave open.
Return (JSON): { prs: [{number, merged: bool, mergedSha: string|null, reason: string|null}] }
`

const REPORT = CONST + `
ROLE: report (execute). Aggregate per-PR state (merged/rebased/reviewed/blocked/held/ownerHeld), residue (blocked with findings, rebase conflicts, PRs that moved between classes). Post the pass summary to #board. Return the residue as follow-up strings.
Return (JSON): { prs: [{number, state, mergedSha}], residue: [string] }
`

const CENSUS_SCHEMA = { type: 'object', properties: { mergeReady: { type: 'array', items: { type: 'object' } }, needsRebase: { type: 'array', items: { type: 'object' } }, needsReview: { type: 'array', items: { type: 'object' } }, blocked: { type: 'array', items: { type: 'object' } }, held: { type: 'array', items: { type: 'integer' } }, ownerHeld: { type: 'array', items: { type: 'integer' } }, totals: { type: 'object' }, yielded: { type: 'boolean' }, hotfixCount: { type: 'integer' } }, required: ['mergeReady', 'needsRebase', 'needsReview'] }
const PR_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REPORT_SCHEMA = { type: 'object', properties: { prs: { type: 'array' }, residue: { type: 'array' } }, required: ['prs'] }

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
// 2026-08-26): re-census each pass up to MAX_PASSES per run. When the census is
// empty the census agent itself sleeps the idle window and re-checks once, so a
// pass costs ~1 agent while idle. PRIORITY YIELD: when any HOTFIX: row exists in
// todos, this lane yields (waits) — the hotfix-drain lane owns the priority
// class. Standing continuity between runs comes from the coordinator
// re-launching this workflow; the run never loops past its hard bound.
const allRebase = []
const allReviews = []
const allMerges = []
let census = null
let pass = 0
for (pass = 1; pass <= MAX_PASSES; pass++) {
phase('Census')
census = await safeAgent(censusPrompt(CENSUS), { label: `pr-drain-census-${pass}`, phase: 'Census', schema: CENSUS_SCHEMA })
if (census && census.yielded) {
  log(`pass ${pass}: YIELDED to hotfix-drain (${census.hotfixCount || 0} HOTFIX: row(s)) — waited inside the census, re-checking next pass`)
  continue
}
const ready = (census && census.mergeReady) || []
const rebase = (census && census.needsRebase) || []
const review = (census && census.needsReview) || []
log(`pass ${pass} census: mergeReady ${ready.length}, rebase ${rebase.length}, review ${review.length}`)
if (!ready.length && !rebase.length && !review.length) {
  log(`pass ${pass}: census empty — the census waited ${IDLE_SLEEP}s and re-checked; re-checking next pass`)
  continue
}

phase('Rebase')
let rebaseResults = []
if (rebase.length) {
  const rebaseBatches = []
  for (let i = 0; i < rebase.length; i += 5) rebaseBatches.push(rebase.slice(i, i + 5))
  rebaseResults = await parallel(rebaseBatches.map((b, i) => () =>
    safeAgent(REBASE.replace('{PRS}', JSON.stringify(b)), { label: `pr-drain-rebase-${pass}-${i + 1}`, phase: 'Rebase', schema: PR_SCHEMA }),
  ))
  const rebased = rebaseResults.filter(Boolean).flatMap(r => r.prs || []).filter(p => p.rebased)
  for (const p of rebased) ready.push({ number: p.number, head: p.newHead })
}
allRebase.push(...rebaseResults.filter(Boolean))

phase('Review')
let reviewResults = []
// OWNER WIDENING 2026-08-19: one independent reviewer agent PER PR (run on the
// default model — no model field), waves of 12 concurrent (was one reviewer per
// batch of 4). Same bounded standard per PR, same verdict-at-head discipline.
// Peak concurrency stays within the 16-agent workflow cap; review phases are
// sequential with rebase/merge so the box never runs both at once.
const REVIEW_WIDTH = 12
for (let w = 0; w < review.length; w += REVIEW_WIDTH) {
  const wave = review.slice(w, w + REVIEW_WIDTH)
  const waveResults = await parallel(wave.map((p, wi) => () =>
    safeAgent(REVIEW.replace('{PRS}', JSON.stringify([p])).replace('{I}', String(w + wi + 1)).replace('{N}', String(review.length)), {
      label: `pr-drain-review-${p.number}`, phase: 'Review', schema: PR_SCHEMA,
    }),
  ))
  reviewResults.push(...waveResults)
}
if (reviewResults.length) {
  const verdictMap = {}
  for (const rv of reviewResults.filter(Boolean)) {
    for (const p of (rv.prs || [])) verdictMap[p.number] = p.verdict
  }
  for (const p of review) {
    if (verdictMap[p.number] === 'GO') ready.push(p)
  }
}
allReviews.push(...reviewResults.filter(Boolean))

phase('Merge')
let mergeResults = []
if (ready.length) {
  const mergeBatches = []
  for (let i = 0; i < ready.length; i += 6) mergeBatches.push(ready.slice(i, i + 6))
  mergeResults = await parallel(mergeBatches.map((b, i) => () =>
    safeAgent(MERGE.replace('{BATCH}', JSON.stringify(b)), { label: `pr-drain-merge-${pass}-${i + 1}`, phase: 'Merge', schema: PR_SCHEMA }),
  ))
}
allMerges.push(...mergeResults.filter(Boolean))
log(`pass ${pass} complete — next pass re-censuses`)
}
if (pass > MAX_PASSES) log(`MAX_PASSES reached (${MAX_PASSES}) — bounded run ends; the coordinator re-launches this workflow for standing continuity`)

phase('Report')
const report = await safeAgent(REPORT, { label: 'pr-drain-report', phase: 'Report', schema: REPORT_SCHEMA })

return { passes: pass, census, rebase: allRebase, reviews: allReviews, merges: allMerges, report }
