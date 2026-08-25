export const meta = {
  name: 'monitor-v2',
  description: 'Monitor v2: named slugs (monitor start|stop <slug>), agentic command definitions, native integrations (todos/conversations/mementos/knowledge/skills/hooks/loops/files). Plan: codewith sol xhigh. Execute: deepseek agents. Review: sol. Fix until shipped.',
  phases: [
    { title: 'Plan', detail: 'codewith exec gpt-5.6-sol xhigh designs monitor v2 (slug lifecycle, spec format, integrations, tasks)' },
    { title: 'Execute', detail: 'deepseek agents implement per the plan, TDD-first, PR-first (max 4 concurrent)' },
    { title: 'Review', detail: 'codewith exec sol xhigh per PR (capacity-switch rule)' },
    { title: 'Fix', detail: 'NO_GO -> executor remediates named findings, re-review (<=2 cycles)' },
    { title: 'Ship', detail: 'merge, changeset, publish intent, publish, install, live test (start/stop a slug), harvest' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const TASK = '6a43f43e'
const PLAN_DIR = '/home/hasna/workspace/scratch/monitor-v2-plan'

const CONST = `
You are a lane of the monitor-v2 workflow (owner-authorized 2026-08-18). The owner's spec: the monitor app (@hasna/monitor, apps/monitor) must support named slugs — 'monitor start <slug>' / 'monitor stop <slug>' — where a slug defines what to monitor in an AGENTIC-friendly declarative way (commands, checks, cadence, outputs), so agents can monitor all sorts of things; and it must have native integrations with todos, conversations, mementos, knowledge, skills, hooks, loops, and files — elegantly and scalably. The workflow chain is fixed: PLAN by codewith gpt-5.6-sol xhigh, EXECUTE by deepseek agents (this session's model), REVIEW by codewith sol xhigh, fix until GO, then ship live. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull; never discard local work). Work in task worktrees ~/.hasna/repos/worktrees/apps/monitor-v2-<n> from origin/main. Never push to main. Force-push (--force-with-lease) ONLY on the PR's own branch. Merges ONLY via gh pr merge <n> --squash --body-file <file whose LAST line is 'Agent: monitor-v2-<your-role>'>.
- IDEMPOTENCY CHECK FIRST: skip anything already merged/completed (gh pr view --json state; todos show).
- No secrets: never print/capture/commit credential values; consume ONLY via 'secrets exec <key> --as VAR -- <cmd>'. No internal-infra strings. Staged secrets scan before every commit/push (rc 0 clean).
- Capture path: redirect to files, read both + $?; never pipe large reads. Paste literal output lines when reporting.
- Record as you go: comments on the tracking task, posts to #board. English. Lineage identity 'conversations agents register' named monitor-v2-<your-role>.
- Distinguish measured vs inferred; state what you did not check. Plain register.
`

const PLAN = CONST + `
ROLE: plan lane (Sonnet). Run the codewith PLAN agent:
1. mkdir -p ${PLAN_DIR}. Write the plan brief to ${PLAN_DIR}/brief.md: the owner's spec (slug lifecycle monitor start|stop <slug>, agentic declarative command definitions, native integrations with todos/conversations/mementos/knowledge/skills/hooks/loops/files, elegant + scalable), the current monitor surface (apps/monitor 0.1.26: cli/, collectors/, integrations/, cron/, db/, mcp/, process-manager/, sync/, tmux/, tailscale/, status/, report/ — read the source to ground the design), the repo laws, and the deliverable: a complete v2 design + implementation task breakdown (~12-16 tasks, dependency-ordered, each with a gate) sized for this workflow's phases (Execute by deepseek agents, Review by sol xhigh, fix cycles <=2, then ship). DAEMON REQUIREMENT (owner): monitor must carry daemon semantics per the contracts standard — the daemon/worker-queue lifecycle from the fleet taxonomy: separate CONTROL (accepts start/stop/definition commands), EXECUTION (admitted slug runs leased to a bounded worker with a fencing token, heartbeat, expiry, stale-worker rejection) and OBSERVATION (status, run records, terminal receipts) planes; a successful 'monitor start' is control-plane only and never proof of execution; every slug run produces a terminal receipt linked to its attempt and lease generation. The contracts app is apps/contracts (@hasna/contracts) — the design must state how monitor's hasna.contract.json and daemon behavior conform to it (read apps/contracts source for the current daemon/queue contract shapes).
2. Run: codewith exec --auth-profile <healthy profile, sweep ~/.codewith/auth_profiles via 'codewith usage --auth-profile <p> | grep Healthy' and pick a fresh one> -m gpt-5.6-sol -c model_reasoning_effort="xhigh" --sandbox workspace-write --skip-git-repo-check -C ${PLAN_DIR} -o ${PLAN_DIR}/design.md "$(cat ${PLAN_DIR}/brief.md)" < /dev/null > ${PLAN_DIR}/plan.log 2>&1.
3. CRITICAL: prompt the agent to RETURN THE COMPLETE DESIGN AS ITS FINAL MESSAGE (do not attempt file writes — the sandbox write path is defectively blocked on this build; -o captures the final message). Verify ${PLAN_DIR}/design.md is non-empty and does NOT contain the known blocked-write plea ('Enable write access' or 'writing is blocked'); if it does, re-run once with the same brief + the explicit instruction 'output the design as your final message text only'. Capacity rule: 'Selected model is at capacity' -> switch profile, never retry into the same bucket.
4. Read the design, validate it covers: the slug lifecycle verbs, the monitor definition schema (agentic-friendly), the seven integrations with their package-owned surfaces, state persistence, and the task breakdown. Return the task list.
Return (JSON): { designPath, tasks: [{id, title, app, gate}], planVerified: bool }
`

const EXECUTE = CONST + `
ROLE: execute lane (deepseek — this session's model). Your task: {TID} '{TTITLE}'. Gate: {TGATE}. The design is at ${PLAN_DIR}/design.md — read the relevant section before implementing.
1. IDEMPOTENCY CHECK FIRST (see CONST).
2. Worktree ~/.hasna/repos/worktrees/apps/monitor-v2-{TSHORT} from origin/main, branch fix/monitor-v2-{TSHORT}.
3. TDD: regression tests FIRST (failing test, see it fail, then implement). Scope confined to apps/monitor unless the design says otherwise.
4. Run the app's suite (bounded 10 min) + 'bun run check' where available. Secrets scan staged (rc 0). Commit (conventional, 'Agent: monitor-v2-{TSHORT}' trailer LAST), push --force-with-lease, open the PR (body ending with the trailer).
5. Verify merge-tree equality at CURRENT origin/main: TREE=$(git -C ${MONOREPO} merge-tree --write-tree origin/main <head>); git -C ${MONOREPO} diff --quiet <head> "$TREE".
Return (JSON): { prs: [{number, app, tests: {passed, failed}, secretsClean: bool, mergeTreeEqual: bool}] }
`

const REVIEW = CONST + `
ROLE: review driver (Sonnet). Adversarial review via codewith exec gpt-5.6-sol xhigh for {PRS} (each: number). For EACH PR: write the review brief (the PR diff summary + the design section it implements + the verdict format '[REVIEW] GO|NO_GO — hasna/apps#<n> @ <sha>'), run codewith exec (healthy profile, capacity-switch rule, sol xhigh, read-only sandbox, -o capture, final-message-only instruction), parse the verdict + findings (quote the literal [REVIEW] line and the P0/P1 findings). Post the verdict as a PR comment. Block ONLY concrete P0/P1 defects. P2/P3 non-blocking.
Return (JSON): { prs: [{number, verdict: GO|NO_GO, findings: [{severity, title, detail}]}] }
`

const FIX = CONST + `
ROLE: fix lane (deepseek). Remediate the named findings for {PRS} (each: {number, findings}). For EACH NO_GO PR: fix ONLY the named P0/P1 findings (commit with the trailer, push --force-with-lease), re-run the affected tests, then the review driver re-runs the codewith sol review — cycle 1. At most TWO remediation cycles; a third NO_GO terminates the candidate (record, never weaken a finding).
Return (JSON): { prs: [{number, fixed: bool, newHead, tests: {passed, failed}}] }
`

const SHIP = CONST + `
ROLE: ship lane (Sonnet). Ship the merged monitor v2:
1. Changeset patch bump (0.1.x), suite, secrets scan, commit ('Agent: monitor-v2-ship' trailer LAST), release PR, merge.
2. PUBLISH INTENT on git-publishing BEFORE publishing: '@hasna/monitor@<version> — v2 slug lifecycle + agentic definitions + native integrations'. Confirm in-thread after.
3. INDEPENDENT RELEASE REVIEW (mandatory): dispatch ONE Fable agent to adversarially review the EXACT release candidate (repo hasna/apps, merged sha, package @hasna/monitor, version, registry npmjs). Verdict '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: npm release, reviewer monitor-v2-review'. Publish ONLY after GO.
4. Publish: NPMRC=$(mktemp); chmod 600; printf '//registry.npmjs.org/:_authToken=\${NODE_AUTH_TOKEN}\\n' > "$NPMRC"; secrets exec hasna/npm/live/publish-token --as NODE_AUTH_TOKEN -- npm publish --userconfig "$NPMRC" --access public; rm -f "$NPMRC". Two-sided verify (npm view version + time). Negative control first.
5. Add @hasna/monitor to minimumReleaseAgeExcludes in ~/.bunfig.toml if absent (exact name), bun install -g on station01 (+03 if reachable), verify installed version.
6. LIVE TEST: create a real slug definition (a smoke monitor watching a trivial command), 'monitor start <slug>', verify it runs + reports, 'monitor stop <slug>', verify it stops. Record the evidence.
7. HARVEST per the artefact-chain rule (skills/todos/mementos/knowledge/files decisions recorded as you go; comment on the task).
Return (JSON): { version, published: bool, reviewVerdict: string|null, liveTest: {slug, started: bool, stopped: bool}, harvest: {skills, todos, mementos, knowledge, files} }
`

const PLAN_SCHEMA = { type: 'object', properties: { designPath: { type: 'string' }, tasks: { type: 'array', items: { type: 'object' } }, planVerified: { type: 'boolean' } }, required: ['tasks'] }
const EXEC_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REVIEW_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const FIX_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const SHIP_SCHEMA = { type: 'object', properties: { version: { type: 'string' }, published: { type: 'boolean' }, reviewVerdict: { type: ['string', 'null'] }, liveTest: { type: 'object' }, harvest: { type: 'object' } }, required: ['published'] }

phase('Plan')
const plan = await agent(PLAN, { label: 'monitor-v2-plan', phase: 'Plan', schema: PLAN_SCHEMA, model: 'sonnet' })
const tasks = (plan && plan.tasks) || []
// owner mandate: daemon semantics per contracts are non-negotiable — append if the plan missed them
if (!tasks.some(t => /daemon|contract/i.test((t.title || '') + (t.id || '')))) {
  tasks.push({ id: 'daemon', title: 'Daemon semantics per contracts: control/execution/observation planes, leases+fencing, receipts; hasna.contract.json conformance to apps/contracts', gate: 'contracts-aligned daemon tests green' })
}
log(`plan: ${tasks.length} tasks`)

phase('Execute')
const execResults = await parallel(tasks.slice(0, 16).map((t, i) => () =>
  agent(EXECUTE.replace('{TID}', t.id || String(i + 1)).replace('{TTITLE}', t.title || 'task').replace('{TGATE}', t.gate || '').replace('{TSHORT}', (t.id || String(i + 1)).slice(0, 8)), { label: `mv2-exec-${i + 1}`, phase: 'Execute', schema: EXEC_SCHEMA }),
))
const executed = execResults.filter(Boolean).flatMap(r => r.prs || [])
log(`execute: ${executed.length} PRs`)

phase('Review')
const reviewBatches = []
for (let i = 0; i < executed.length; i += 4) reviewBatches.push(executed.slice(i, i + 4))
const reviewResults = await parallel(reviewBatches.map((rb, i) => () =>
  agent(REVIEW.replace('{PRS}', JSON.stringify(rb)), { label: `mv2-review-${i + 1}`, phase: 'Review', schema: REVIEW_SCHEMA, model: 'sonnet' }),
))
let verdicts = {}
for (const rv of reviewResults.filter(Boolean)) {
  for (const p of (rv.prs || [])) verdicts[p.number] = p
}
let nogo = Object.values(verdicts).filter(p => p.verdict === 'NO_GO')
log(`review: ${Object.keys(verdicts).length} verdicts, ${nogo.length} NO_GO`)

phase('Fix')
let fixResults = []
let cycle = 0
while (nogo.length && cycle < 2) {
  cycle++
  fixResults = await parallel(nogo.map((p, i) => () =>
    agent(FIX.replace('{PRS}', JSON.stringify([{ number: p.number, findings: p.findings }])), { label: `mv2-fix-c${cycle}-${i + 1}`, phase: 'Fix', schema: FIX_SCHEMA }),
  ))
  const fixed = fixResults.filter(Boolean).flatMap(r => r.prs || [])
  const re = await agent(REVIEW.replace('{PRS}', JSON.stringify(fixed.map(p => ({ number: p.number })))), { label: `mv2-re-review-c${cycle}`, phase: 'Review', schema: REVIEW_SCHEMA, model: 'sonnet' })
  for (const p of ((re && re.prs) || [])) verdicts[p.number] = p
  nogo = Object.values(verdicts).filter(p => p.verdict === 'NO_GO')
  log(`fix cycle ${cycle}: ${nogo.length} remaining NO_GO`)
}
const goPrs = Object.values(verdicts).filter(p => p.verdict === 'GO').map(p => p.number)

phase('Merge')
const merged = await agent(`ROLE: merge lane (Sonnet). ${CONST} Merge the GO'd PRs: {BATCH} (numbers). For EACH: head == reviewed sha; merge-tree equality at CURRENT origin/main (re-measure; if main moved, verify the delta is disjoint and proceed); gh pr merge <n> --squash --body-file <file ending 'Agent: monitor-v2-ship'>; record merged sha. Return (JSON): { prs: [{number, merged: bool, mergedSha: string|null, reason: string|null}] }`.replace('{BATCH}', JSON.stringify(goPrs)), { label: 'mv2-merge', phase: 'Ship', schema: { type: 'object', properties: { prs: { type: 'array' } }, required: ['prs'] }, model: 'sonnet' })

phase('Ship')
const ship = await agent(SHIP, { label: 'mv2-ship', phase: 'Ship', schema: SHIP_SCHEMA, model: 'sonnet' })

return { plan, execute: execResults.filter(Boolean), reviews: reviewResults.filter(Boolean), fixes: fixResults.filter(Boolean), merged, ship }
