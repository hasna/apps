export const meta = {
  name: 'build-and-ship-workflows-app',
  description: 'One-off build lane (owner-directed 2026-08-25, not durable): validate the hasna/workflows plan, file it in todos, build the @hasna/workflows app in the hasna/apps monorepo with a fix loop until green, verify it live locally, publish to npm, ship to oss-fleet-prod, then loop the full acceptance sweep until every command works. ALSO builds the 5 standing fleet workflow definitions (fix-deepsec, audit-apps-gaps, verify-apps-qa, generate-apps-docs-marketing, deploy-app-hasna-com) with authoring-skill validation (basename==meta.name, verb-first regex, no import(), no banned tokens) plus ONE adversarial review agent before each PR. While-loops used per owner amendment. Plan file: /tmp/workflows-plan-final.md',
  phases: [
    { title: 'PlanValidate', detail: 'read the plan, verify the build contract against repo laws + SDK pins' },
    { title: 'TodosFile', detail: 'create the todos plan + Build/Publish/Ship tasks in the hasna/apps todos project (args.project)' },
    { title: 'Build', detail: 'worktree scaffold + slice implementation, fix-loop until suite + check green' },
    { title: 'LocalVerify', detail: 'CLI live test, control surfaces, -serve live run, sdk import, interrupted-run resume' },
    { title: 'Publish', detail: 'release review, intent, npm publish, two-sided verify, install + smoke' },
    { title: 'Ship', detail: 'deploy intent, ECR, task def, update-service, live HTTPS test, confirm' },
    { title: 'FullValidate', detail: 'end-to-end acceptance sweep; loop back to the failing phase until all commands work' },
    { title: 'Harvest', detail: 'record + independent harvest' },
  ],
}


// Repo root (args-driven, 2026-08-26): args.repo overrides; default is the current
// clones layout (~/.hasna/repos/clones/hasna/apps). The legacy
// /home/hasna/.hasna/repos/clones/hasna/apps path is retired.
const MONOREPO = (args && args.repo) || '~/.hasna/repos/clones/hasna/apps'

// hasna/apps todos project id (args-driven, 2026-08-26): args.project overrides;
// the standing hasna/apps project id is the default. Every use below
// interpolates ${APPS_PROJECT} — no hardcoded id.
const APPS_PROJECT = (args && args.project) || '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'


const PLAN = MONOREPO + '/.claude/workflows/workflows-plan-final.md'
const CHANNEL = 'board'
const GITPUB = 'git-publishing'
const GITDEP = 'git-deployments'

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
Cloud env (fleet-env primary; legacy ~/.hasna/cloud removed 2026-10-01): for f in todos conversations mementos knowledge; do if [ -f "$HOME/.hasna/fleet-env/$f.env" ]; then set -a; . "$HOME/.hasna/fleet-env/$f.env"; set +a; elif [ -f "$HOME/.hasna/cloud/$f.env" ]; then set -a; . "$HOME/.hasna/cloud/$f.env"; set +a; fi; done.
NEVER print a credential value.
`

const CONST = `
You are a phase of the build-and-ship-workflows-app workflow (owner-directed 2026-08-25, one-off). Mission: build @hasna/workflows (the universal graph workflow app) in the hasna/apps monorepo, publish it, ship it, and loop until every command works. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Work in task worktrees ~/.hasna/repos/worktrees/apps/build-<slice> from origin/main (fetch first). NEVER push to main. Commits carry 'Agent: build-workflows-<your-role>' (the ONLY attribution line). PR-first landing.
- No secrets: never print/capture/commit credential values in any encoding; consume ONLY via 'secrets exec <key> --as VAR -- <cmd>'. No internal-infra strings in artifacts. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Gates before every commit/push: staged secrets scan rc=0 with real bytes; bun tooling/ci/check-secrets.ts --base origin/main rc=0; check-names rc=0.
${RECORDING}
- English. Distinguish measured vs inferred; state what you did not check.
- NEVER run bash -x / set -x (trace mode) — the shell profile sources the fleet env files (~/.hasna/fleet-env/*.env; legacy ~/.hasna/cloud/*.env until 2026-10-01) and trace echoes credential lines into the transcript.
- The while loop IS in v1 (owner amendment 2026-08-25): the graph language supports a while node; this workflow's own loops iterate with declared bounds and exit only on a verified green state.
- MAX 4 SUB-AGENTS PER STEP (owner 2026-08-25): no phase spawns more than 4 agents; a phase that needs more splits into sub-steps. Current phases use 1-2; never raise the cap.
- SOL VERDICT (gpt-5.6-sol advisory, 2026-08-25, binding on this workflow's shape): every invocation carries finite wall/agent-call/token/work-item/retry/concurrency budgets (this workflow's loops are bounded: build <=20 cycles, validation <=12, each cycle <=2 agents); EVERY phase returns a terminal receipt (status + evidence — the schemas below enforce it); every census/sweep reads COMPLETE paginated state, never a truncated read (a bounded read is a failure, not a pass); 'no monitors' does not mean 'no observation' — the run record is the observation surface.
`

const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['contract', 'gaps'],
  properties: {
    contract: {
      type: 'object', additionalProperties: false,
      required: ['packageName', 'surfaces', 'commands', 'sdkPins', 'schema', 'exitGates'],
      properties: {
        packageName: { type: 'string' },
        surfaces: { type: 'array', items: { type: 'string' } },
        commands: { type: 'array', items: { type: 'string' } },
        sdkPins: { type: 'array', items: { type: 'string' } },
        schema: { type: 'string' },
        exitGates: { type: 'array', items: { type: 'string' } },
      },
    },
    gaps: { type: 'array', items: { type: 'string' } },
    observations: { type: 'array', items: { type: 'string' } },
  },
}
const TODOS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['planId', 'tasks'],
  properties: {
    planId: { type: 'string' },
    tasks: { type: 'array', items: { type: 'object' } },
  },
}
const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['status', 'done'],
  properties: {
    status: { enum: ['built', 'partial', 'failed'] },
    done: { type: 'array', items: { type: 'string' } },
    prNumber: { type: 'integer' },
    failures: { type: 'array', items: { type: 'string' } },
  },
}
const VERIFY_BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['green', 'suite', 'check'],
  properties: {
    green: { type: 'boolean' },
    suite: { type: 'object', properties: { passed: { type: 'integer' }, failed: { type: 'integer' } } },
    check: { type: 'boolean' },
    failures: { type: 'array', items: { type: 'string' } },
  },
}
const LOCAL_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'perCommand', 'failures'],
  properties: {
    verdict: { enum: ['GO', 'NO_GO'] },
    perCommand: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['command', 'verdict', 'evidence'],
        properties: {
          command: { type: 'string' },
          verdict: { enum: ['GO', 'NO_GO'] },
          evidence: { type: 'string' },
        },
      },
    },
    failures: { type: 'array', items: { type: 'string' } },
  },
}
const PUBLISH_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['published', 'version'],
  properties: {
    published: { type: 'boolean' },
    version: { type: 'string' },
    reviewVerdict: { type: 'string' },
    reviewSha: { type: 'string' },
    installOk: { type: 'boolean' },
    installedVersion: { type: 'string' },
    failures: { type: 'array', items: { type: 'string' } },
  },
}
const SHIP_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['deployed', 'version'],
  properties: {
    deployed: { type: 'boolean' },
    version: { type: 'string' },
    healthOk: { type: 'boolean' },
    versionOk: { type: 'boolean' },
    intentId: { type: 'string' },
    confirmId: { type: 'string' },
    failures: { type: 'array', items: { type: 'string' } },
  },
}
const SWEEP_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'perCommand', 'failures'],
  properties: {
    verdict: { enum: ['GO', 'NO_GO'] },
    perCommand: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['command', 'verdict', 'evidence'],
        properties: {
          command: { type: 'string' },
          verdict: { enum: ['GO', 'NO_GO'] },
          evidence: { type: 'string' },
        },
      },
    },
    failures: { type: 'array', items: { type: 'string' } },
  },
}
const VERIFIER_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['lens', 'verdict', 'perCommand', 'failures'],
  properties: {
    lens: { type: 'string' },
    verdict: { enum: ['GO', 'NO_GO'] },
    perCommand: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['command', 'verdict', 'evidence'],
        properties: {
          command: { type: 'string' },
          verdict: { enum: ['GO', 'NO_GO'] },
          evidence: { type: 'string' },
        },
      },
    },
    taskId: { type: ['string', 'null'], description: 'todos task id filed for this NO_GO (null when GO)' },
    failures: { type: 'array', items: { type: 'string' } },
  },
}
const RECONCILE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['lens', 'finalVerdict', 'evidence', 'failures'],
  properties: {
    lens: { type: 'string' },
    finalVerdict: { enum: ['GO', 'NO_GO'] },
    evidence: { type: 'array', items: { type: 'string' } },
    failures: { type: 'array', items: { type: 'string' } },
  },
}
const PANEL_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'noGoLenses', 'failures'],
  properties: {
    verdict: { enum: ['GO', 'NO_GO'] },
    noGoLenses: { type: 'array', items: { type: 'string' } },
    failures: { type: 'array', items: { type: 'string' } },
  },
}

// --- safeAgent hardening (O15-00732) ---
// A subagent that completes WITHOUT calling StructuredOutput (prose reply) makes
// agent() throw; an uncaught throw kills the whole run (measured 2026-08-25:
// wf_b4894f28-d61 died after 37 agents / 2.7h — and 2026-08-26 on
// wf_a3a29325-194, where a schema'd prompt returned a truthy prose string).
// safeAgent catches, logs, and returns null so the run continues through the
// existing null-guards; the failure flag makes the next dispatched agent sleep
// 300s first (the established idle-wait primitive) instead of hot-looping.
let agentFailed = false
const safeAgent = async (prompt, opts) => {
  try {
    const r = await agent(prompt, opts)
    // A prose reply can come back as the agent's RAW RESULT (a string) instead
    // of the schema'd object — the SAME failure class as the throw.
    if (opts && opts.schema && (typeof r !== 'object' || r === null)) {
      agentFailed = true
      const label = (opts && (opts.label || opts.phase)) || 'agent'
      log('AGENT-PROSE (' + label + '): schema requested but the agent returned a non-object result — treating as failure; next agent sleeps 300s first')
      return null
    }
    return r
  } catch (err) {
    agentFailed = true
    const label = (opts && (opts.label || opts.phase)) || 'agent'
    log('AGENT-FAILURE (' + label + '): ' + (err && err.message ? err.message : String(err)) + ' — continuing; next agent sleeps 300s first')
    return null
  }
}
const waitBanner = (body) => {
  if (agentFailed) {
    agentFailed = false
    return "NOTE: a previous agent FAILED (a subagent returned prose instead of StructuredOutput, or another transient error). Sleep 300 (bash) FIRST, then continue exactly as instructed.\n\n" + body
  }
  return body
}
// --- /safeAgent ---

phase('PlanValidate')
const plan = await safeAgent(waitBanner(`${CONST}
ROLE: plan validation (Opus). READ the plan file ${PLAN} in full (it exists on disk — cat it). The plan file carries an 'OWNER AMENDMENTS — 2026-08-25' section at the end that SUPERSEDES the body where they conflict: (1) the while-loop IS in v1 (the body's 'No while-loop in v1' clause is overruled — the v1 language includes the while node with condition/maxIterations/exitOnVerifiedState); (2) verification is agent live-verification of EVERY CLI command as a real user with per-command GO/NO_GO — never just bun test; (3) the kai adapter plugin seam is defined (adapter load path, registration + version-pin manifest, publish-guard extended to check packed deps for the private scope); (4) the CLI surface is 14 verbs (sessions pull and lanes probe count as their own verbs); (5) the SDK integration scope is EXACTLY FOUR lanes for starters: codex (@openai/codex-sdk), claude code (@anthropic-ai/claude-agent-sdk — our own harness), cursor (@cursor/sdk, local mode), grok (xAI Grok SDK) — codewith/opencode/kai are NOT wired in the starter scope, only listed not-ready. Verify against the repo and the world:
1. Package: @hasna/workflows, apps/workflows directory, four surfaces (bin workflows, bin workflows-mcp, bin workflows-serve, ./sdk) — check the monorepo law (AGENTS.md + .claude/rules).
2. SDK pins re-verified live (npm view, not assumed): @anthropic-ai/claude-agent-sdk (0.3.x), @openai/codex-sdk (0.149.x), @cursor/sdk (1.0.28), and the xAI Grok SDK (grok — record the actual package + latest) — record actual latest for all four.
3. The 14-command CLI surface from the plan (init/validate/run/runs/nodes/sessions pull/daemon/machines/lanes probe/resume/graph/serve).
4. The exit gates: interrupted-run test, sessions pull mid-run, secrets write-gate fires on a synthetic fixture, while-node validate + execution.
5. A gap in the plan (missing command, broken pin, law violation, or the while-loop/14-verb/live-verification/four-lane contract absent from the build scope) is a GAP — return it, do not proceed. The amendments section satisfies the while-loop + 14-verb + live-verification + four-lane contract — verify the build scope in the plan actually includes them; do NOT report them as gaps if the amendments section covers them.
6. ENVIRONMENT OBSERVATIONS ARE NOT GAPS (measured 2026-08-25: a machine-hygiene observation in the gaps array stopped the whole build): anything about the local clone, residue dirs, stale files, or environment — NOT about the plan itself — goes in the 'observations' array, NEVER in 'gaps'. Only a defect IN THE PLAN blocks.
Return {contract, gaps, observations}.`, { label: 'plan-validate', phase: 'PlanValidate', schema: PLAN_SCHEMA, model: 'opus' }))
if (!plan || (plan.gaps || []).length > 0) {
  log('PLAN GAPS: ' + JSON.stringify(plan ? plan.gaps : ['plan agent failed']))
  return { status: 'plan-gaps', gaps: plan ? plan.gaps : ['plan agent failed'], observations: plan ? plan.observations : [] }
}
if (plan.observations && plan.observations.length) log('plan observations (non-blocking): ' + JSON.stringify(plan.observations))
log('plan validated: ' + plan.contract.packageName + ' — ' + plan.contract.commands.length + ' commands')

phase('TodosFile')
const todos = await safeAgent(`${CONST}
ROLE: todos filing. Create the plan in todos project ${APPS_PROJECT}: root plan title 'PLAN: hasna/workflows app — build, publish, ship (owner-directed 2026-08-25)'. Under it create the tasks (todos add --plan <planId> or the CLI's plan verb): scaffold apps/workflows + four surfaces; graph language v1 + validate (with while node per owner amendment); 3-table store + sessions WAL + torn-run repair + memoization + output secrets gate; daemon skeleton (claims, leases, reaper); claude adapter; codex adapter; CLI surface (14 commands); unit+integration suite; standing workflow definitions (fix-deepsec, audit-apps-gaps, verify-apps-qa, generate-apps-docs-marketing, deploy-app-hasna-com); local live-run verification; publish; deploy. Each task: status pending, description = the plan contract's exit gate for it. Comment the plan id + task ids on ${CHANNEL} post. Return {planId, tasks}.`, { label: 'todos-file', phase: 'TodosFile', schema: TODOS_SCHEMA })

// BUILD LOOP (owner amendment: while loop; exits ONLY on LIVE GO, never on the
// suite alone — measured 2026-08-25: the suite went green on slice 1 (scaffold)
// while the app was unimplemented; the real-user live verify caught it. So each
// cycle is: build -> suite+check -> LIVE VERIFY (real user, every command); the
// loop exits only when the live verify returns GO, and its NO_GO findings feed
// the next cycle's build prompt.)
phase('Build')
const MAX_BUILD = 20
let buildGreen = false
let buildResult = null
let verifyResult = null
let local = null
for (let b = 1; b <= MAX_BUILD && !buildGreen; b++) {
  log('build cycle ' + b + '/' + MAX_BUILD)
  buildResult = await safeAgent(`${CONST}
ROLE: build slice ${b} (Opus). Worktree ~/.hasna/repos/worktrees/apps/build-workflows from origin/main, branch build/workflows. CRASH-RESUME FIRST: if the worktree already exists, run the suite BEFORE implementing anything — slices already green stay green (never redo completed work); implement only the failing/missing slices. Contract status from previous cycle: ${JSON.stringify(verifyResult)}. LIVE-VERIFY FEEDBACK from the previous cycle (the real-user gate — these are the FAILURES the app must fix, not suggestions): ${JSON.stringify(local ? local.failures : [])}. Slice order: scaffold+surfaces -> graph language v1 + validate (while node included) -> 3-table store -> sessions WAL + torn-run repair + memoization + secrets write-gate -> daemon (claims/leases/reaper) -> FOUR LANE ADAPTERS (exactly these, per owner 2026-08-25): claude (@anthropic-ai/claude-agent-sdk) -> codex (@openai/codex-sdk) -> cursor (@cursor/sdk, local mode) -> grok (xAI Grok SDK) -> CLI (14 commands) -> STANDING WORKFLOW DEFINITIONS (the 5 new fleet workflow files in apps/.claude/workflows: fix-deepsec, audit-apps-gaps, verify-apps-qa, generate-apps-docs-marketing, deploy-app-hasna-com — the 5th keeps its owner-named basename with an explicit header note naming the exemption) -> tests. Regression-test-first per slice. Never fabricate a passing test.

PRE-PR AUTHORING GATE (before opening ANY PR that touches the standing workflow definitions): each of the 5 workflow files MUST pass the authoring-skill validation checks — (a) basename == meta.name; (b) meta.name matches ^(audit|fix|generate|migrate|monitor|research|review|triage|verify)-[a-z0-9]+(?:-[a-z0-9]+)*$ (deploy-app-hasna-com is the explicit owner-named exception, documented by the header note); (c) NO import() anywhere in the workflow script; (d) no banned tokens in the surface — no credential shapes, no internal-infra strings (*.hasna.xyz, @hasna-internal/*, ARNs, AWS account ids, /home/hasna/ paths). Then run ONE adversarial review agent (an independent reviewer agent run on the default model) over the workflow-definition changes at the exact head, with the 2-cycle cap: [REVIEW] GO|NO_GO at head; NO_GO at head -> fix within 2 cycles and re-review — NEVER open the PR while an unresolved head NO_GO stands.

Return {status, done, failures}.`, { label: 'build:' + b, phase: 'Build', schema: BUILD_SCHEMA, model: 'opus' })
  verifyResult = await safeAgent(`${CONST}
ROLE: build verification (Opus). In the worktree ~/.hasna/repos/worktrees/apps/build-workflows: run 'bun test' (or the app's suite) and 'bun run check' at the repo root (redirect to files, read $?). GREEN = suite passes AND bun run check rc=0 (names+secrets+manifests+publish-guard+deps) AND node --check clean on the app's bins. Report exact failures otherwise. Return {green, suite, check, failures}.`, { label: 'verify-build:' + b, phase: 'Build', schema: VERIFY_BUILD_SCHEMA, model: 'opus' })
  if (!(verifyResult && verifyResult.green)) {
    log('build cycle ' + b + ' suite not green: ' + JSON.stringify(verifyResult ? verifyResult.failures : ['verify failed']))
    continue
  }
  // Suite + check green is NECESSARY but NOT SUFFICIENT (measured 2026-08-25).
  // The real-user live verify is the exit gate: every command exercised live.
  phase('LocalVerify')
  local = await safeAgent(`${CONST}
ROLE: local live verification (Opus) — YOU ARE THE REAL USER. In a scratch dir (mktemp -d, never the repo), exercise EVERY CLI command live as a user actually would: real operations against the real store, real effects, real outputs read and checked — never --help-only, never rc=0-only. For EACH command return {command, verdict: GO|NO_GO, evidence} where evidence is the actual output line(s) that prove the behavior.

THE FULL COMMAND SET (14 verbs — every one verified live):
1. workflows init — creates ~/.hasna/workflows (workflows/ + sessions/ + workflows.db) in the scratch HOME; the store exists after.
2. workflows validate — on a GOOD graph (parallel lanes + a conditional edge + a WHILE node) accepts; on a BAD graph (unknown input ref, cycle, non-deterministic shape) rejects with the named reason. Both directions.
3. workflows run <file> [--input k=v] [--idempotency-key] — executes a real 2-3 node graph on SQLite, returns a real run id.
4. workflows runs list — shows the run; runs show <id> — run state; runs events <id> — append-only event history with real events; runs cancel <id> — cancels a live run.
5. workflows nodes show <run-id> <node-id> — per-node memoized output + result receipt.
6. workflows sessions pull <run-id> — MID-RUN (start a run with a slow node, pull while it runs) — returns real mid-run state; also after completion.
7. workflows daemon start|stop|status — starts the daemon, status shows it alive, stop stops it. (Bounded: start/status/stop in sequence.)
8. workflows machines list|status — daemon heartbeats visible.
9. workflows lanes list — executor registry: claude + codex wired, others not-ready with reason.
10. workflows lanes probe claude — live re-run of the four maturity checks.
11. workflows resume <run-id> — the interrupted-run test: kill a run mid-node (run in background, kill the daemon or the node's process), resume restores the exact graph position from memoized outputs — completed nodes return stored outputs WITHOUT re-executing.
12. workflows graph <file> — renders the DAG.
13. workflows serve — start it (HOST=0.0.0.0 + injected PORT), curl /health, /ready, /version — 200 + identity; one authenticated trigger call.
14. sdk: bun import of @hasna/workflows/sdk, one API call against the local server.

CONTROL SURFACES (part of the per-command set): workflows --version and --help answer BEFORE any bind; workflows-serve --version/--help answer without binding a port; workflows-mcp --version answers. A bind-before-version is a NO_GO.
SECRETS GATE (part of the set): a node whose structured output contains a synthetic secret fixture is REJECTED at the write-gate with a redaction instruction — the fixture never lands in nodes/*.json or events.jsonl.

Overall verdict: GO only when EVERY command in the set is GO with evidence. Any NO_GO -> return verdict NO_GO with the per-command table and exact failures. Return {verdict, perCommand, failures}.`, { label: 'local-verify:' + b, phase: 'LocalVerify', schema: LOCAL_SCHEMA, model: 'opus' })
  buildGreen = !!(local && local.verdict === 'GO')
  if (!buildGreen) log('build cycle ' + b + ' suite green but LIVE VERIFY NO_GO: ' + JSON.stringify(local ? local.failures : ['local verify failed']))
}
if (!buildGreen) return { status: 'build-failed-after-' + MAX_BUILD, plan: plan.contract, verify: verifyResult, local }
log('local verify: GO — ' + (local ? local.perCommand.length : 0) + ' commands verified live')

// PUBLISH
phase('Publish')
const pub = await safeAgent(`${CONST}
ROLE: publish (the npm-release rule: independent agent verdict bound to repo+sha+package+version+registry; never publish without a GO).
1. Version: patch bump per the publish law via changeset in the worktree; commit 'Agent: build-workflows-publish'; open the PR, get it reviewed and merged (bounded review, two-cycle cap).
2. RELEASE REVIEW: an independent adversarial review by a reviewer agent run on the default model of the exact release candidate (repo hasna/apps, head sha, diff since last published, packed content, changelog, version bump, regression risk). First line: [REVIEW] GO|NO_GO — @hasna/workflows@<v> @ <sha> — registry npmjs. NO_GO: remediate the named P0/P1 via PR, re-review — at most 2 cycles; third NO_GO = skip, never publish unreviewed.
3. INTENT: post to ${GITPUB}: 'PUBLISH INTENT: @hasna/workflows@<v> — <one-line changelog>' BEFORE publishing; note the message id.
4. PUBLISH from the app dir with the sanctioned form: NPMRC="\$(mktemp)"; chmod 600 "\$NPMRC"; printf '//registry.npmjs.org/:_authToken=\${NODE_AUTH_TOKEN}\n' > "\$NPMRC"; secrets exec hasna/npm/live/publish-token --as NODE_AUTH_TOKEN -- npm publish --userconfig "\$NPMRC" --access public; rm -f "\$NPMRC". NEVER the token value. Negative control first: npm view @hasna/workflows version must NOT already show the version being published — CRASH-RESUME: if it DOES already show it, the publish already happened in a prior run: skip the publish, verify the installed version matches, and return published:true with the note 'already-published'.
5. VERIFY two-sided: npm view @hasna/workflows version = the new version AND the negative control held; npm view time --json timestamp fresh. CONFIRM in-thread on ${GITPUB}.
6. INSTALL + SMOKE: add the exact name @hasna/workflows to ~/.bunfig.toml minimumReleaseAgeExcludes (sanctioned escape, never bypass), bun install -g @hasna/workflows@<v>, installed 'workflows --version' == npm view version.
Return {published, version, reviewVerdict, reviewSha, installOk, installedVersion, failures}.`, { label: 'publish', phase: 'Publish', schema: PUBLISH_SCHEMA, model: 'sonnet' })
if (!pub || !pub.published) return { status: 'publish-failed', failures: pub ? pub.failures : ['publish agent failed'] }
log('published @hasna/workflows@' + pub.version)

// SHIP
phase('Ship')
const ship = await safeAgent(`${CONST}
ROLE: ship (deploy-intent-confirm protocol; one service at a time). Deploy @hasna/workflows to oss-fleet-prod ECS (hasna-xyz-infra account 789877399345, us-east-1, service workflows-prod, route https://workflows.hasna.xyz). Source sha: the merged build PR head; version: ${pub.version}.
0. INTENT: post to ${GITDEP}: '[DEPLOY INTENT] workflows@${pub.version} -> https://workflows.hasna.xyz — <one-line changelog>'; note the message id.
1. BUILD: docker build --platform linux/arm64 -t workflows:<source-sha> from the app Dockerfile (in the worktree at the merged head).
2. REGISTRY: docker push to ECR (repo workflows in 789877399345, login via aws ecr get-login-password with the hasna-xyz-infra profile); resolve the immutable digest.
3. DATABASE: run the one-shot migrate task if the app's deploy config has one (check SSM /hasna/deploy/workflows first); a failing migration stops the deploy with the exact error.
4. TASK DEF: register a new revision of workflows-prod with the new digest; do not change env/secrets.
5. UPDATE: aws ecs update-service --cluster oss-fleet-prod --service workflows-prod --task-definition workflows-prod:<rev>; wait services-stable; PRIMARY deployment rolloutState=COMPLETED.
6. LIVE TEST: curl https://workflows.hasna.xyz/health (200 + identity), /version (deployed version == ${pub.version}). CRASH-RESUME: if /health already answers 200 with version == ${pub.version} before you build anything, the deploy already happened in a prior run — record the evidence, skip the redeploy, and return deployed:true with the note 'already-deployed'.
7. CONFIRM: reply IN-THREAD to the intent: '[DEPLOY-CONFIRM] workflows@${pub.version} -> https://workflows.hasna.xyz — <live-test evidence>'. On failure the thread gets the failure, never a confirm.
Return {deployed, version, healthOk, versionOk, intentId, confirmId, failures}.`, { label: 'ship', phase: 'Ship', schema: SHIP_SCHEMA, model: 'sonnet' })
if (!ship || !ship.deployed) return { status: 'ship-failed', failures: ship ? ship.failures : ['ship agent failed'] }
log('deployed workflows@' + ship.version + ' at https://workflows.hasna.xyz')

// FULL VALIDATION LOOP — 4-AGENT PANEL (owner 2026-08-25): four independent
// verifiers, one lens each, each returns GO/NO_GO with live evidence; they
// then COMMUNICATE (each sees the other three's verdicts and reconciles);
// the adjudicator requires ALL FOUR GO. Any NO_GO files a todos task and
// posts to #apps. Loop back to the failing phase until the panel is all-GO.
phase('FullValidate')
const MAX_SWEEP = 12
let allGreen = false
let panel = null
for (let s = 1; s <= MAX_SWEEP && !allGreen; s++) {
  log('validation cycle ' + s + '/' + MAX_SWEEP + ' — 4-agent panel')

  // ROUND 1: four independent verifiers, one lens each, live as a real user (4 agents — the step cap)
  const LENSES = [
    { key: 'cli', lens: 'CLI COMMANDS LIVE',
      brief: `Exercise EVERY one of the 14 CLI verbs live against the installed package (bun install -g @hasna/workflows@${pub.version}) as a real user would: real store, real runs, real outputs, actual output lines as evidence. Per-command GO/NO_GO. Control surfaces: all three bins answer --version/--help BEFORE any bind (a bind-before-version is NO_GO). sdk: bun import of @hasna/workflows/sdk + one API call against the local server.` },
    { key: 'graph', lens: 'GRAPH LANGUAGE + WHILE + RESUME',
      brief: `Graph language semantics: validate a GOOD fixture (parallel lanes + conditional edges + a WHILE node) accepts AND runs end-to-end (the while loop executes its body and terminates on the declared maxIterations or verified exit); validate a BAD fixture (unknown input ref, cycle, non-deterministic shape) rejects with the named reason. sessions pull returns real mid-run state; resume restores the exact graph position after an interrupted run — completed nodes return stored outputs WITHOUT re-executing (memoized).` },
    { key: 'daemon', lens: 'DAEMON / LEASES / REAPER + SECURITY',
      brief: `Daemon: start/status/stop live; machines list/status shows heartbeats; lanes list shows the FOUR wired lanes (claude, codex, cursor, grok) and others not-ready with reason; lanes probe claude re-runs the four maturity checks live. Crash resilience: kill a run mid-claim — the reaper reclaims and the fence rejects the old worker's result. Security: the secrets write-gate fires on a synthetic secret fixture (node output rejected + redaction instruction; fixture never lands in nodes/*.json or events.jsonl); the published tarball carries no internal-infra strings and no @hasna-internal/* deps (npm pack --dry-run inspection).` },
    { key: 'harness', lens: 'OUR OWN HARNESS (claude lane via Agent SDK) + LIVE ROUTE',
      brief: `Our own harness: the claude lane drives Claude Code through @anthropic-ai/claude-agent-sdk — one real node executes via the Agent SDK and its transcript mirrors into sessions/<run>/agent/. A drain-shaped workflow (our standing-lane shape: census -> drain -> loop) executes end-to-end through the app. Live route: https://workflows.hasna.xyz/health + /version return 200 with the published version (${pub.version}) matching npm.` },
  ]
  const round1 = await parallel(LENSES.map((l, i) => () =>
    safeAgent(`${CONST}
ROLE: independent verifier ${i + 1} of 4 — lens: ${l.lens}. You are the REAL USER of the published + deployed product. ${l.brief}
Return {lens, verdict: GO|NO_GO, perCommand: [{command, verdict, evidence}], failures}. GO only when every item in YOUR lens is GO with evidence.
POST your verdict to #${CHANNEL}: '[VERIFY] ${l.lens}: GO|NO_GO — <one-line evidence>'. If your verdict is NO_GO, FILE a todos task in project ${APPS_PROJECT} ('BUILD-VERIFY NO_GO: ${l.lens} — <symptom>', description = the exact failure lines + evidence) and return its taskId.`, { label: 'verify-' + l.key + ':' + s, phase: 'FullValidate', schema: VERIFIER_SCHEMA, model: 'opus' }),
  ))

  // ROUND 2: communication — each verifier sees the other three's verdicts and reconciles
  const round2 = await parallel(LENSES.map((l, i) => () =>
    safeAgent(`${CONST}
ROLE: reconciliation ${i + 1} of 4 — lens: ${l.lens}. YOUR OWN round-1 verdict: ${JSON.stringify(round1[i])}. THE OTHER THREE VERIFIERS' VERDICTS (communicate with them by reading their evidence): ${JSON.stringify(round1.filter((_, j) => j !== i))}.
Decide your FINAL verdict: keep or change it based on their evidence. A NO_GO stands unless another verifier's evidence refutes it. A GO may become NO_GO if another verifier's evidence reveals a defect in your lens you missed. Post your final verdict to #${CHANNEL}: '[VERIFY-FINAL] ${l.lens}: GO|NO_GO — <reason>'. Return {lens, finalVerdict, evidence: [string], failures}.`, { label: 'reconcile-' + l.key + ':' + s, phase: 'FullValidate', schema: RECONCILE_SCHEMA, model: 'opus' }),
  ))

  // ROUND 3: adjudicator — GO only when ALL FOUR final verdicts are GO
  panel = await safeAgent(`${CONST}
ROLE: panel adjudicator. The four verifiers' FINAL verdicts after communication: ${JSON.stringify(round2)}.
Overall verdict: GO only when ALL FOUR are GO. If ANY is NO_GO: for EACH NO_GO lens, ensure a todos task exists in project ${APPS_PROJECT} (title 'BUILD-VERIFY NO_GO: <lens> — <symptom>' — dedupe: reuse the round-1 taskId if the verifier filed one, else file it now with the evidence). Post the panel outcome to #${CHANNEL}: '[PANEL] validation cycle ${s}: GO|NO_GO — <per-lens verdicts>'. Return {verdict: GO|NO_GO, noGoLenses: [string], failures: [string]}.`, { label: 'panel:' + s, phase: 'FullValidate', schema: PANEL_SCHEMA, model: 'opus' })
  allGreen = !!(panel && panel.verdict === 'GO')
  if (!allGreen) {
    log('validation cycle ' + s + ' panel NO_GO on: ' + JSON.stringify(panel ? panel.noGoLenses : ['panel agent failed']))
    // Loop back into the failing phase: fix the NO_GO lenses' failures, re-publish patch if the tarball/install broke, re-ship if the route broke.
    const fix = await safeAgent(`${CONST}
ROLE: remediation cycle ${s} (Opus). The panel failed on lenses: ${JSON.stringify(panel ? panel.noGoLenses : [])}. Failures: ${JSON.stringify(panel ? panel.failures : [])} (see the filed todos tasks in project ${APPS_PROJECT} for the full evidence). For EACH failure: locate the owning phase (build/local-verify/publish/ship), fix the root cause in the appropriate worktree (regression-test-first), land via PR (reviewed, merged), and if the fix changes the published artifact: bump patch, re-run the publish phase form (intent -> review -> publish -> two-sided verify -> install), and if it changes the deployed artifact: re-run the ship phase form (intent -> ECR -> task def -> update -> live test -> confirm). Comment the filed todos tasks with the fix + merge sha. Return {fixed: [string], changedArtifact: bool}.`, { label: 'remediate:' + s, phase: 'FullValidate', schema: { type: 'object', additionalProperties: false, required: ['fixed', 'changedArtifact'], properties: { fixed: { type: 'array', items: { type: 'string' } }, changedArtifact: { type: 'boolean' } } }, model: 'opus' })
    log('remediation ' + s + ': ' + JSON.stringify(fix))
  }
}
if (!allGreen) return { status: 'validation-failed-after-' + MAX_SWEEP, plan: plan.contract, build: buildResult, local, publish: pub, ship, panel }

phase('Harvest')
const harvest = await safeAgent(`${CONST}
ROLE: harvest (Opus, independent). ROW-DEDUPE FIRST: search todos project ${APPS_PROJECT} for an open HARVEST row carrying this run's signature before creating one. Comment each category on the row the moment it is decided: SKILLS / TODOS / MEMENTOS / KNOWLEDGE / FILES (create/update/none + reason; 'none' is complete). Complete the todos plan: mark every task completed with evidence (published version ${pub.version}, installed version ${pub.installedVersion}, deployed version ${ship.version}, live-test lines). Save mementos. Post the final state to #${CHANNEL}. Return {categories: {skills: {decision}, todos: {decision}, mementos: {decision}, knowledge: {decision}, files: {decision}}, planDone: bool}.`, { label: 'harvest', phase: 'Harvest', model: 'opus' })

return {
  status: 'built-published-shipped-verified',
  plan: plan.contract,
  todos: todos ? todos.planId : null,
  buildCycles: buildResult,
  localVerify: local,
  publish: pub,
  ship,
  validationCycles: panel,
  harvest,
}
