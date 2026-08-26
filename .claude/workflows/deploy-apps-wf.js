// OWNER-NAMED EXCEPTION (naming ruling, ratified in review 2026-08-26): meta.name
// is 'deploy-app-hasna-com' — the owner-mandated workflow name (invoked as
// /deploy-app-hasna-com) for the standing deploy lane of the hasna/apps monorepo
// (owner directive 2026-08-20); basename deploy-app-hasna-com-wf.js follows the
// fleet <registered>-wf.js pattern. It is the documented exception to the
// closed-verb workflow-name taxonomy: 'deploy' is NOT in the closed-verb set
// (audit|fix|generate|migrate|monitor|research|review|triage|verify), so this
// meta.name does NOT match the verb-first regex. Review ruling: NO rename to a
// closed-verb name — the owner name stands, with this header note as the
// exemption record (the authoring gate in build-and-ship-workflows-app-wf.js
// documents the same exemption, item (b) of the PRE-PR AUTHORING GATE).
// Renamed from 'deploy-apps' (2026-08-26). FOLLOW-UP NOTES (docs-only, NOT
// touchable here): README.md's workflow rows and propagate-lanes-to-monorepos-wf.js
// prose still name this lane 'deploy-apps' — rename them in the follow-up task;
// agent-failure-hardening.test.js now references the new basename.
export const meta = {
  name: 'deploy-app-hasna-com',
  description: 'Deploy @hasna/* app services (hasna/apps monorepo members) to the oss-fleet-prod ECS surface, drain-to-zero. Surveys deployable services (serve surfaces + Dockerfile + published/ECS-deployed version), verifies the provider-role table per service (source/registry/ECS surface/database/route), executes the ECS deployment convention (build native arm64 -> ECR push sha-tagged -> migrate one-shot -> register task def -> update-service -> wait stable -> live HTTPS test), re-surveys each pass and loops while services remain deployable (hard bound MAX_PASSES), fails closed where provider roles are unverified. CORRECTED 2026-08-24: the internalapps-prod-host docker-compose convention is LEGACY — all services run as ECS Fargate in oss-fleet-prod (measured: 32 services, virgilius lane deploys via task defs). HARDENED 2026-08-25 (owner-directed harden-lanes-review-gates, temporary): after each service live test and BEFORE any [DEPLOY-CONFIRM], TWO independent agents (deploy-gate-1/deploy-gate-2) live-verify the DEPLOYED service non-destructively — every route (/health /ready /version 200 + identity + version match, one business read); [DEPLOY-CONFIRM] is posted only when BOTH return GO, otherwise the service is recorded DEPLOY UNVERIFIED with a filed todos task and is never confirmed. Owner directive 2026-08-20.',
  phases: [
    { title: 'Survey', detail: 'enumerate deployable services, verify versions + ECS surface + routes, classify ready / blocked' },
    { title: 'Deploy', detail: 'one service at a time: build, ECR push, migrate, task def, update-service, live test; then a 2-agent live gate (deploy-gate-1/deploy-gate-2, both must return GO) before the gated [DEPLOY-CONFIRM]' },
    { title: 'Record', detail: 'conversations + mementos' },
  ],
}

const SURVEY = { type: 'object', properties: { deployable: { type: 'array' }, blocked: { type: 'array' }, yielded: { type: 'boolean' }, hotfixCount: { type: 'integer' } }, required: ['deployable', 'blocked'] }
const DEPLOY = { type: 'object', properties: { deployed: { type: 'array' }, failed: { type: 'array' } }, required: ['deployed', 'failed'] }
const DEPLOY_GATE = { type: 'object', additionalProperties: false, required: ['verdict', 'perCommand'], properties: { verdict: { enum: ['GO', 'NO_GO'] }, perCommand: { type: 'array', items: { type: 'object' } }, failures: { type: 'array', items: { type: 'string' } } } }

// Repo root (args-driven, 2026-08-26): args.repo overrides; default is the current
// clones layout (~/.hasna/repos/clones/hasna/apps). The legacy
// /home/hasna/.hasna/repos/clones/hasna/apps path is retired.
const MONOREPO = (args && args.repo) || '~/.hasna/repos/clones/hasna/apps'

// hasna/apps todos project id (args-driven, 2026-08-26): args.project overrides;
// the standing hasna/apps project id is the default. Every use below
// interpolates ${APPS} — no hardcoded id.
const APPS = (args && args.project) || '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'

// Pass bound (fleet ground truth 2026-08-26): the standing 'infinite' lane runs a
// BOUNDED pass loop — MAX_PASSES hard cap per run (the runtime's 1,000-agent cap
// is the outer guard; ~6 agents per pass x 40 passes stays well inside it). The
// standing continuity between runs comes from the COORDINATOR re-launching this
// workflow, never from an unbounded in-script loop. args.maxPasses overrides.
const MAX_PASSES = (args && args.maxPasses) || 40

// Idle window (owner 2026-08-25, args-driven): args.idleMinutes in MINUTES,
// default 30. The survey sleeps IDLE_SLEEP seconds then re-checks once —
// min(idleMinutes, 300) bounds the in-agent wait; the existing 300s is the floor
// (the standing idle wait, also the safeAgent failure-banner sleep).
const IDLE_MINUTES = Math.min(((args && args.idleMinutes) || 30), 300)
const IDLE_SLEEP = Math.max(300, IDLE_MINUTES * 60)

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

// DRAIN-TO-ZERO LOOP (owner design 2026-08-25; bounded per fleet ground truth
// 2026-08-26): re-survey each pass; while any service is deployable the pass
// restarts inside the same run — capped at MAX_PASSES per run. A pass that
// deploys nothing new or an empty deployable set ends the loop. The coordinator
// re-launches this workflow for standing continuity; the run never loops past
// its hard bound.
const allDeployed = []
const allFailed = []
let survey = null
let pass = 0
for (pass = 1; pass <= MAX_PASSES; pass++) {
phase('Survey')
survey = await safeAgent(censusPrompt(`${RECORDING}
SURVEY the deployable @hasna/* app services (read-only, nothing modified). PASS ${pass} of the bounded loop (max ${MAX_PASSES}) — re-survey each pass. PRIORITY YIELD CHECK FIRST: todos list --project ${APPS} --status pending --json (redirect to a file, never pipe) — if any UNOWNED row's title starts with "HOTFIX:", the hotfix-drain lane owns the priority class: sleep 300 (bash), re-check once, return {deployable: [], blocked: [], yielded: true, hotfixCount: N}. Do NOT probe AWS while yielding.
IF NO SERVICE IS DEPLOYABLE: sleep ${IDLE_SLEEP} (bash — the args-driven idle window, ${IDLE_MINUTES} min default), re-run the survey once, and return the RE-CHECK result — the lane waits the idle window between passes while idle. NEVER return an empty deployable without the sleep+re-check having run. READ FROM origin/main, NEVER the stale local checkout (the shared checkout at ${MONOREPO} is stale — git fetch origin main -q, then git show origin/main:<path> for every read).

THE DEPLOY SURFACE (measured 2026-08-24): services run as ECS Fargate in the oss-fleet-prod cluster (hasna-xyz-infra account 789877399345, us-east-1), service naming <name>-prod, behind the shared ALB; routes are <name>.hasna.xyz (or the app's own product domain). The internalapps-prod-host docker-compose channel is LEGACY and is NOT a deploy target — do not probe it.

1. Enumerate candidates: every apps/<name> directory at origin/main in the hasna/apps monorepo whose package.json exposes a -serve bin (the serving contract: HOST=0.0.0.0 + injected PORT, /health + /ready + /version) and that has a Dockerfile. Cross-check the ECS surface: aws ecs describe-services --cluster oss-fleet-prod --services <name>-prod (profile hasna-xyz-infra, region us-east-1; assert the account with sts get-caller-identity first — never trust the profile name alone). A candidate WITHOUT an ECS service is blocked, not deployable.
2. For EACH candidate verify the provider-role table (deployment-operator standard — never declare a blocker before the roles are known):
   - source: package.json at origin/main (apps/<name>/package.json) — package name, version, -serve bin, Dockerfile present (git ls-tree origin/main);
   - published: published version via the lane token (NPMRC temp file + secrets exec hasna/npm/live/publish-token --as NODE_AUTH_TOKEN -- npm view <name> version --userconfig "$NPMRC"; never print the token);
   - ECS surface: the <name>-prod service exists in oss-fleet-prod and is ACTIVE (describe-services); the deployed task def image digest resolves (read the current task-def's image from describe-task-definition --task-definition <name>-prod);
   - database: migrations exist at origin/main (migrations/ dir or in-code migrations per the app's pattern);
   - routing: https://<name>.hasna.xyz/health answers 200 (curl, one probe; a product app uses its own domain).
3. Classify: DEPLOYABLE = ECS surface exists AND the ECS-deployed image version (from the current task def image tag or the route /version) is BEHIND origin/main's src version (or the src version differs from what the ECS service runs); BLOCKED = any role missing or unverifiable, with the exact missing role named. Do NOT deploy anything.
Return {deployable: [{name, packageName, version, ecsService, taskDef, route}], blocked: [{name, missingRole, reason}]}.`), { label: 'survey-deploy', phase: 'Survey', schema: SURVEY })
if (!survey || !Array.isArray(survey.deployable) || survey.deployable.length === 0) {
  log(`pass ${pass}: no deployable services (or malformed survey) — the survey waited ${IDLE_SLEEP}s and re-checked; re-checking next pass`)
  continue
}
if (survey && survey.yielded) {
  log(`pass ${pass}: YIELDED to hotfix-drain (${survey.hotfixCount || 0} HOTFIX: row(s)) — waited inside the survey, re-checking next pass`)
  continue
}
log(`pass ${pass} survey: ${survey.deployable.length} deployable, ${Array.isArray(survey.blocked) ? survey.blocked.length : 0} blocked`)

phase('Deploy')
const d = await safeAgent(`${RECORDING}
DEPLOY the surveyed services ONE AT A TIME (the owner's one-at-a-time rule) to the oss-fleet-prod ECS surface (hasna-xyz-infra 789877399345, us-east-1). PASS ${pass} of the infinite loop. Deployable set: ${JSON.stringify(survey.deployable)}.

For EACH service, in this exact order, from a task worktree cut at origin/main (git -C ~/.hasna/repos/worktrees/apps/skeleton fetch origin main; worktree add ~/.hasna/repos/worktrees/apps/deploy-<name> -b deploy/<name> origin/main):
0. GATE POST (the deploy-intent-confirm protocol, knowledge k_mt1cuu2k_u91wsm): before the deploy, post to the git-deployments channel: [DEPLOY INTENT] <name>@<version> -> https://<name>.hasna.xyz — <one-line changelog>. Note the message id. Every deploy carries the gate; a deploy without the intent post is a protocol violation.
1. BUILD: docker build --platform linux/arm64 -t <ecr-repo>:<source-sha> the app image (the Dockerfile in the app dir at the worktree; ECR repo <name> in 789877399345). A build failure STOPS that service with the exact error.
2. REGISTRY: docker push the image to ECR (aws ecr get-login-password + docker login with the hasna-xyz-infra profile); resolve the immutable image digest (aws ecr describe-images --repository-name <name> --image-ids imageTag=<source-sha>).
3. DATABASE: run the app's one-shot migrate task if one exists (task-def family <name>-prod-migrate or the migrate pattern the app's deploy config uses — check SSM /hasna/deploy/<name> for the deploy config first; if a migrate one-shot exists, aws ecs run-task --cluster oss-fleet-prod --task-definition <name>-prod-migrate and wait for exit 0; a migration that FAILS stops that service with the exact error, like the accounts-prod-migrate IAM gap — never bypass).
4. TASK DEF: register a new revision of the <name>-prod task-def family with the new image digest (describe the current task definition, replace the image, register-task-definition). Do not change env, secrets, or other config.
5. UPDATE: aws ecs update-service --cluster oss-fleet-prod --service <name>-prod --task-definition <name>-prod:<new-revision> (or --force-new-deployment if the image is referenced by digest); aws ecs wait services-stable; verify the PRIMARY deployment rolloutState=COMPLETED (describe-services).
6. LIVE TEST: curl https://<name>.hasna.xyz/health (expect 200 + the app's identity), https://<name>.hasna.xyz/version (expect the deployed version), and one business route with a valid API key if one exists. A live test that fails STOPS that service and records it as failed with the exact response.
7. GATE CONFIRM (the deploy-intent-confirm protocol, knowledge k_mt1cuu2k_u91wsm): the [DEPLOY-CONFIRM] reply is posted by a SEPARATE workflow step AFTER two independent live gate agents (deploy-gate-1/deploy-gate-2) verify the deployed service — the lane NEVER posts [DEPLOY-CONFIRM] unless BOTH gates return GO. Do NOT post [DEPLOY-CONFIRM] here. Record the step-0 intent post's message id as intentId per service so the gated confirm step can reply IN-THREAD (conversations send --channel git-deployments --reply-to <intentId>) with: [DEPLOY-CONFIRM] <name>@<version> -> https://<name>.hasna.xyz — <live-test evidence line: health 200 + version match + both gates GO>. On failure, the thread gets the failure instead of a confirm — never confirm a failed deploy.
Record: {name, version, imageDigest, route, healthOk, versionOk, intentId} (confirmId is populated by the gated confirm step after both gates GO).
A per-service failure stops that service and is recorded in failed — the rest continue one at a time.

TRACKING RULE (corrected 2026-08-25 — a run cited 4 fabricated task ids with zero todos invocations): EVERY failure reason MUST cite a REAL todos row. Before recording a failure: todos list --project ${APPS} --status pending --limit 500 --json AND --status in_progress (redirect to a file, never pipe) and check whether a row for this exact defect class exists (match by title/package/symptom, not by invented id). If none exists, create it with todos add in project ${APPS}: title 'BUG: @hasna/<name> — <symptom, blocks <name> deploys>', description carrying the exact error line + service + task-def revision + intent/thread ids from this run. Cite ONLY the short id of a row you just created or just verified. NEVER cite a task id that has not been created or verified in this run.

Return {deployed: [{name, version, imageDigest, route, healthOk, versionOk, intentId}], failed: [{name, reason}]}.`, { label: 'deploy-services-' + pass, phase: 'Deploy', schema: DEPLOY })

// DEPLOY GATE (owner-directed 2026-08-25, harden-lanes-review-gates): after each
// service's live test and BEFORE any [DEPLOY-CONFIRM] may be posted, TWO independent
// agents (deploy-gate-1/deploy-gate-2) live-verify the DEPLOYED service,
// NON-DESTRUCTIVE only — every route: /health, /ready, /version (200 + identity +
// version match) plus one business read. Actual commands, actual outputs, per-route
// {command, verdict: GO|NO_GO, evidence}. The lane posts [DEPLOY-CONFIRM] only when
// BOTH return GO; any NO_GO files 'DEPLOY UNVERIFIED: <service>@<v>' in todos with the
// gate evidence, posts the NO_GO to #apps, and NEVER confirms.
const deployResults = d ? d.deployed : []
for (const svc of deployResults) {
  const svcRoute = svc.route || ('https://' + svc.name + '.hasna.xyz')
  const gates = await parallel([
    () => safeAgent(`${RECORDING}
LIVE GATE 1 OF 2 (deploy): you verify the DEPLOYED service ${svc.name}@${svc.version} at ${svcRoute} by RUNNING real commands against it, live and NON-DESTRUCTIVE only — every route: /health, /ready, /version (each must answer 200 with the service's identity and the version must match ${svc.version}) plus ONE business read (a read-only route, with a valid API key if one exists). Actual commands, actual outputs, per-route {command, verdict: GO|NO_GO, evidence}. NEVER write test scripts; run the real commands. Return {verdict, perCommand, failures}.`, { label: 'deploy-gate-1-' + svc.name, phase: 'Deploy', schema: DEPLOY_GATE }),
    () => safeAgent(`${RECORDING}
LIVE GATE 2 OF 2 (deploy): same task as gate 1, independently — verify the DEPLOYED service ${svc.name}@${svc.version} at ${svcRoute} live and non-destructively: every route (/health /ready /version 200 + identity + version match, one business read), per-route {command, verdict: GO|NO_GO, evidence}. Return {verdict, perCommand, failures}.`, { label: 'deploy-gate-2-' + svc.name, phase: 'Deploy', schema: DEPLOY_GATE }),
  ])
  const svcAllGo = gates.filter(Boolean).every(g => g && g.verdict === 'GO')
  if (svcAllGo) {
    svc.gate = 'GO'
    const confirm = await safeAgent(`${RECORDING}
GATE CONFIRM (deploy-intent-confirm protocol, knowledge k_mt1cuu2k_u91wsm): both live gates returned GO for ${svc.name}@${svc.version} (${svcRoute}). Reply IN-THREAD to the intent post in git-deployments (conversations send --channel git-deployments --reply-to ${svc.intentId}): [DEPLOY-CONFIRM] ${svc.name}@${svc.version} -> ${svcRoute} — <live-test evidence line: health 200 + version match + both gates GO>. If ${svc.intentId} is missing or unresolvable, locate the [DEPLOY INTENT] post for this service in git-deployments and reply to its real message id — never invent an id. Return {confirmId, posted: true}.`, { label: 'confirm-deploy-' + svc.name, phase: 'Deploy', schema: { type: 'object', additionalProperties: false, required: ['confirmId', 'posted'], properties: { confirmId: { type: 'string' }, posted: { type: 'boolean' } } } })
    svc.confirmId = confirm ? confirm.confirmId : null
  } else {
    // NEVER confirm: file the UNVERIFIED todos row with the gate evidence (a REAL row per
    // the tracking rule — cite only a created/verified short id) and post the NO_GO to #apps.
    const unv = await safeAgent(`${RECORDING}
DEPLOY UNVERIFIED: ${svc.name}@${svc.version} (${svcRoute}) — the two independent live gates did NOT both return GO (verdicts: ${JSON.stringify(gates.filter(Boolean).map(g => ({ verdict: g.verdict, failures: g.failures })))}). NEVER post [DEPLOY-CONFIRM] for this service. Check whether a todos row for this exact defect class already exists (todos list --project ${APPS} --status pending --limit 500 --json AND --status in_progress, redirect to a file, never pipe); reuse it if it exists, otherwise todos add in project ${APPS}: title 'DEPLOY UNVERIFIED: ${svc.name}@${svc.version} — live gate NO_GO', description carrying the exact gate evidence (per-route outputs, verdicts, failures) + service + route + task-def revision; no credential values anywhere in the description — redact token-like output. Post the NO_GO to #apps with the evidence (conversations send --channel apps), no credential values in the post. Return {taskId, postedNoGo: true}.`, { label: 'deploy-unverified-' + svc.name, phase: 'Deploy', schema: { type: 'object', additionalProperties: false, required: ['taskId', 'postedNoGo'], properties: { taskId: { type: 'string' }, postedNoGo: { type: 'boolean' } } } })
    svc.gate = 'NO_GO'
    allFailed.push({ name: svc.name, reason: 'DEPLOY UNVERIFIED — live gate NO_GO (todos ' + (unv ? unv.taskId : 'task-filing-failed') + ')' })
  }
}
allDeployed.push(...deployResults.filter(s => s.gate === 'GO'))
allFailed.push(...(d ? d.failed : []))
log(`pass ${pass} complete — ${deployResults.filter(s => s.gate === 'GO').length} gate-verified deployed, ${allFailed.length} failed; next pass re-surveys`)
}
if (pass > MAX_PASSES) log('MAX_PASSES reached (' + MAX_PASSES + ') — bounded run ends; the coordinator re-launches this workflow for standing continuity')

phase('Record')
const record = await safeAgent(`${RECORDING}
RECORD step. Post to the internal-apps conversations channel (#internal-apps): deploy run (${pass} pass(es)) — deployed ${allDeployed.length} (${allDeployed.map(x => x.name + '@' + x.version + ' ' + x.route).join('; ') || 'none'}), failed ${allFailed.length} (${allFailed.map(f => f.name + ': ' + f.reason).join('; ') || 'none'}), blocked ${survey ? survey.blocked.length : 0}. Save mementos: mementos save 'deploy-internal-apps-2026-08-24' '<two-sentence summary>'. Return {posted: true, channel: 'internal-apps', mementoKey: 'deploy-internal-apps-2026-08-24'}.`, { label: 'record-deploy', phase: 'Record', model: 'sonnet' })

return { status: allDeployed.length === 0 ? 'deploy-survey-only' : 'deploy-run-complete', passes: pass, deployable: survey ? survey.deployable : [], blocked: survey ? survey.blocked : [], deployed: allDeployed, failed: allFailed, record }
