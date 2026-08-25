export const meta = {
  name: 'deploy-internal-apps',
  description: 'Deploy @hasna/* app services (hasna/apps monorepo members) to the oss-fleet-prod ECS surface. Surveys deployable services (serve surfaces + Dockerfile + published/ECS-deployed version), verifies the provider-role table per service (source/registry/ECS surface/database/route), executes the ECS deployment convention (build native arm64 -> ECR push sha-tagged -> migrate one-shot -> register task def -> update-service -> wait stable -> live HTTPS test), fails closed where provider roles are unverified. CORRECTED 2026-08-24: the internalapps-prod-host docker-compose convention is LEGACY — all services run as ECS Fargate in oss-fleet-prod (measured: 32 services, virgilius lane deploys via task defs). Owner directive 2026-08-20.',
  phases: [
    { title: 'Survey', detail: 'enumerate deployable services, verify versions + ECS surface + routes, classify ready / blocked' },
    { title: 'Deploy', detail: 'one service at a time: build, ECR push, migrate, task def, update-service, live test' },
    { title: 'Record', detail: 'conversations + mementos' },
  ],
}

const SURVEY = { type: 'object', properties: { deployable: { type: 'array' }, blocked: { type: 'array' } }, required: ['deployable', 'blocked'] }
const DEPLOY = { type: 'object', properties: { deployed: { type: 'array' }, failed: { type: 'array' } }, required: ['deployed', 'failed'] }

phase('Survey')
const survey = await agent(`SURVEY the deployable @hasna/* app services (read-only, nothing modified). READ FROM origin/main, NEVER the stale local checkout (the shared checkout at /home/hasna/workspace/repos/hasna/apps is stale — git fetch origin main -q, then git show origin/main:<path> for every read).

THE DEPLOY SURFACE (measured 2026-08-24): services run as ECS Fargate in the oss-fleet-prod cluster (hasna-xyz-infra account 789877399345, us-east-1), service naming <name>-prod, behind the shared ALB; routes are <name>.hasna.xyz (or the app's own product domain). The internalapps-prod-host docker-compose channel is LEGACY and is NOT a deploy target — do not probe it.

1. Enumerate candidates: every apps/<name> directory at origin/main in the hasna/apps monorepo whose package.json exposes a -serve bin (the serving contract: HOST=0.0.0.0 + injected PORT, /health + /ready + /version) and that has a Dockerfile. Cross-check the ECS surface: aws ecs describe-services --cluster oss-fleet-prod --services <name>-prod (profile hasna-xyz-infra, region us-east-1; assert the account with sts get-caller-identity first — never trust the profile name alone). A candidate WITHOUT an ECS service is blocked, not deployable.
2. For EACH candidate verify the provider-role table (deployment-operator standard — never declare a blocker before the roles are known):
   - source: package.json at origin/main (apps/<name>/package.json) — package name, version, -serve bin, Dockerfile present (git ls-tree origin/main);
   - published: published version via the lane token (NPMRC temp file + secrets exec hasna/npm/live/publish-token --as NODE_AUTH_TOKEN -- npm view <name> version --userconfig "$NPMRC"; never print the token);
   - ECS surface: the <name>-prod service exists in oss-fleet-prod and is ACTIVE (describe-services); the deployed task def image digest resolves (read the current task-def's image from describe-task-definition --task-definition <name>-prod);
   - database: migrations exist at origin/main (migrations/ dir or in-code migrations per the app's pattern);
   - routing: https://<name>.hasna.xyz/health answers 200 (curl, one probe; a product app uses its own domain).
3. Classify: DEPLOYABLE = ECS surface exists AND the ECS-deployed image version (from the current task def image tag or the route /version) is BEHIND origin/main's src version (or the src version differs from what the ECS service runs); BLOCKED = any role missing or unverifiable, with the exact missing role named. Do NOT deploy anything.
Return {deployable: [{name, packageName, version, ecsService, taskDef, route}], blocked: [{name, missingRole, reason}]}.`, { label: 'survey-deploy', phase: 'Survey', schema: SURVEY })
if (!survey || survey.deployable.length === 0) return { status: 'deploy-survey-only', deployable: [], blocked: survey ? survey.blocked : [], deployed: [], failed: [] }
log(`deploy survey: ${survey.deployable.length} deployable, ${survey.blocked.length} blocked`)

phase('Deploy')
const d = await agent(`DEPLOY the surveyed services ONE AT A TIME (the owner's one-at-a-time rule) to the oss-fleet-prod ECS surface (hasna-xyz-infra 789877399345, us-east-1). Deployable set: ${JSON.stringify(survey.deployable)}.

For EACH service, in this exact order, from a task worktree cut at origin/main (git -C ~/.hasna/repos/worktrees/apps/skeleton fetch origin main; worktree add ~/.hasna/repos/worktrees/apps/deploy-<name> -b deploy/<name> origin/main):
0. GATE POST (the deploy-intent-confirm protocol, knowledge k_mt1cuu2k_u91wsm): before the deploy, post to the git-deployments channel: [DEPLOY INTENT] <name>@<version> -> https://<name>.hasna.xyz — <one-line changelog>. Note the message id. Every deploy carries the gate; a deploy without the intent post is a protocol violation.
1. BUILD: docker build --platform linux/arm64 -t <ecr-repo>:<source-sha> the app image (the Dockerfile in the app dir at the worktree; ECR repo <name> in 789877399345). A build failure STOPS that service with the exact error.
2. REGISTRY: docker push the image to ECR (aws ecr get-login-password + docker login with the hasna-xyz-infra profile); resolve the immutable image digest (aws ecr describe-images --repository-name <name> --image-ids imageTag=<source-sha>).
3. DATABASE: run the app's one-shot migrate task if one exists (task-def family <name>-prod-migrate or the migrate pattern the app's deploy config uses — check SSM /hasna/deploy/<name> for the deploy config first; if a migrate one-shot exists, aws ecs run-task --cluster oss-fleet-prod --task-definition <name>-prod-migrate and wait for exit 0; a migration that FAILS stops that service with the exact error, like the accounts-prod-migrate IAM gap — never bypass).
4. TASK DEF: register a new revision of the <name>-prod task-def family with the new image digest (describe the current task definition, replace the image, register-task-definition). Do not change env, secrets, or other config.
5. UPDATE: aws ecs update-service --cluster oss-fleet-prod --service <name>-prod --task-definition <name>-prod:<new-revision> (or --force-new-deployment if the image is referenced by digest); aws ecs wait services-stable; verify the PRIMARY deployment rolloutState=COMPLETED (describe-services).
6. LIVE TEST: curl https://<name>.hasna.xyz/health (expect 200 + the app's identity), https://<name>.hasna.xyz/version (expect the deployed version), and one business route with a valid API key if one exists. A live test that fails STOPS that service and records it as failed with the exact response.
7. GATE CONFIRM (the deploy-intent-confirm protocol): after a successful live test, reply IN-THREAD to the intent post in git-deployments (conversations send --channel git-deployments --reply-to <intent-message-id>): [DEPLOY-CONFIRM] <name>@<version> -> https://<name>.hasna.xyz — <live-test evidence line: health 200 + version match>. On failure, the thread gets the failure instead of a confirm — never confirm a failed deploy.
Record: {name, version, imageDigest, route, healthOk, versionOk, intentId, confirmId}.
A per-service failure stops that service and is recorded in failed — the rest continue one at a time.

TRACKING RULE (corrected 2026-08-25 — a run cited 4 fabricated task ids with zero todos invocations): EVERY failure reason MUST cite a REAL todos row. Before recording a failure: todos list --project 3bbc22e0 --status pending --limit 500 --json AND --status in_progress (redirect to a file, never pipe) and check whether a row for this exact defect class exists (match by title/package/symptom, not by invented id). If none exists, create it with todos add in project 3bbc22e0: title 'BUG: @hasna/<name> — <symptom, blocks <name> deploys>', description carrying the exact error line + service + task-def revision + intent/thread ids from this run. Cite ONLY the short id of a row you just created or just verified. NEVER cite a task id that has not been created or verified in this run.

Return {deployed: [{name, version, imageDigest, route, healthOk, versionOk}], failed: [{name, reason}]}.`, { label: 'deploy-services', phase: 'Deploy', schema: DEPLOY })

phase('Record')
const record = await agent(`RECORD step. Post to the internal-apps conversations channel (#internal-apps): deploy run — deployed ${d ? d.deployed.length : 0} (${d ? d.deployed.map(x => x.name + '@' + x.version + ' ' + x.route).join('; ') : 'none'}), failed ${d ? d.failed.length : 0} (${d ? d.failed.map(f => f.name + ': ' + f.reason).join('; ') : 'none'}), blocked ${survey.blocked.length}. Save mementos: mementos save 'deploy-internal-apps-2026-08-24' '<two-sentence summary>'. Return {posted: true, channel: 'internal-apps', mementoKey: 'deploy-internal-apps-2026-08-24'}.`, { label: 'record-deploy', phase: 'Record', model: 'sonnet' })

return { status: 'deploy-run-complete', deployable: survey.deployable, blocked: survey.blocked, deployed: d ? d.deployed : [], failed: d ? d.failed : [], record }
