export const meta = {
  name: 'deploy-subscriptions',
  description: 'Owner directive 2026-08-20: deploy @hasna-internal/subscriptions (renamed @hasna/accounts). Evidence: the pre-rename ECS deploy attempt today 12:25Z (accounts, /tmp/accounts-deploy.log) pushed the image to ECR but FAILED at the migration step (migration container exit 1, no [DEPLOY-CONFIRM]). The live deploy convention is ECS via /tmp/deploy-one.sh (oss-fleet-prod cluster, SSM manifest /hasna/deploy/<app>); the docker-compose-host convention surveyed by deploy-internal-apps is stale (host unresolvable, superseded by ECS). This lane: diagnose the migration failure, fix it, deploy subscriptions@0.2.46 via deploy-one.sh with intent/confirm gates, live verify.',
  phases: [
    { title: 'Diagnose', detail: 'why the 12:25Z accounts migration exited 1; resolve the subscriptions deploy manifest' },
    { title: 'Deploy', detail: 'deploy-one.sh with intent/confirm gates + live verify' },
    { title: 'Review', detail: 'Fable adversarial review' },
  ],
}

const CONST = `
You are the deploy-subscriptions lane (owner-authorized). Final text = machine-readable JSON.

Context (measured): @hasna-internal/subscriptions@0.2.46 published (rename of @hasna/accounts, PR #358 merge 2d265dd2). Pre-rename ECS deploy attempt 2026-08-20 12:25Z failed: /tmp/accounts-deploy.log shows ECR push OK (digest sha256:7cf093bd...), scan gate OK (critical=5 high=19, non-strict for this app), migration container exit 1 (FATAL: migration container exited 1). Driver: /tmp/deploy-one.sh <app> <version> <repo-key: hasna-apps|internal-apps> — SSM manifest /hasna/deploy/<app> (accounts may still be the manifest name; subscriptions may need a manifest or derive from the live service), cluster oss-fleet-prod, account 789877399345, region us-east-1. The old docker-compose-host convention is stale — do NOT use it.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: search todos + open PRs for an existing subscriptions/accounts deploy fixer; if one exists, verify and record, do NOT duplicate. Also check the git-deployments channel for any newer deploy attempt than 12:25Z.
- NEVER print/capture/commit credential values. AWS access via the hasna-xyz-infra profile; assert the account id (aws sts get-caller-identity) before touching resources. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- [DEPLOY INTENT] BEFORE the deploy and [DEPLOY-CONFIRM] AFTER it, in-thread on git-deployments (the deploy-intent-confirm protocol, knowledge k_mt1cuu2k_u91wsm): intent = '<app>@<version> -> oss-fleet-prod/<route> — <one-line changelog>'; confirm = '<app>@<version> -> oss-fleet-prod/<route> — <live-test evidence line: health 200 + version match>'. Never confirm a failed deploy.
- The migration step must exit 0; if the migration fails again, STOP and record the exact task logs (aws ecs describe-tasks stopped reason + container exit code; CloudWatch logs if reachable), do not bypass.
- Live verify: curl the service route /health (200 + identity) and /version (0.2.46), per deploy-one.sh STEP 6/7 evidence lines.
- Record as you go: comment the tracking row c82297eb-60cb-4081-9712-d23603b40b24 and post progress to #apps. English. Distinguish measured vs inferred; state what you did not check.
`

const DIAGNOSE = CONST + `
ROLE: diagnose (Opus). (1) Reconstruct the 12:25Z failure: read /tmp/accounts-deploy.log fully; query ECS for the stopped migration task (cluster oss-fleet-prod, started-by sweep-accounts-migrate or the task family from the SSM manifest /hasna/deploy/accounts; aws ecs list-tasks + describe-tasks for stoppedReason + container exit codes; CloudWatch log stream if reachable) — name the exact reason the migration container exited 1 (SQL error? missing secret? runtime-role? image entrypoint?). (2) Resolve the deploy targets for subscriptions: SSM manifest /hasna/deploy/subscriptions (or /hasna/deploy/accounts if that is the live name) — read it and name service/web_task_family/web_container/migration_task_family/migration_container/ecr_repository_url/subnets/security_groups; if no manifest, check whether an ECS service subscriptions-prod or accounts-prod exists. (3) Name the smallest owned fix for the migration failure (in the app source at origin/main apps/subscriptions, or the SSM manifest, or the task definition) — do NOT mutate anything in this phase. Return (JSON): { priorAttempt: {digest, scan, migrationExit, stoppedReason, containerExit, logEvidence}, manifest: {name, service, webFam, webCont, migFam, migCont, ecrRepo, subnets, sgs}, failureRootCause, smallestFix, notChecked: [string] }
`

const DEPLOY = CONST + `
ROLE: deploy (Opus). Apply the smallest owned fix for the migration failure (from the diagnose result) IF it is a manifest/task-def/source change you can land safely (worktree + PR for source changes in hasna-internal/internal-apps apps/subscriptions; SSM manifest update for manifest issues). Then run the deploy: post [DEPLOY INTENT] to git-deployments first, then bash /tmp/deploy-one.sh subscriptions 0.2.46 internal-apps (or the resolved app name if the manifest/service is still named accounts — use the exact resolved name), capturing evidence per step. On migration exit 0 + service update + rollout: live verify /health + /version on the route, then post [DEPLOY-CONFIRM] in-thread with the evidence line. If any step fails: record the exact failure, post the failure in-thread (never a confirm), leave the row pending with a resume condition. Return (JSON): { intentPosted, fixApplied, deployOutput: {steps: [{step, rc, evidence}], stoppedAt}, liveTest: {health, version, route}, confirmPosted, resumeCondition }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review: (a) the migration failure root cause is evidence-backed (task logs, not inference), (b) the fix is the smallest owned change, (c) intent before / confirm after with matching evidence lines, (d) no credential values in any output, (e) live verify actually ran (health 200 + version 0.2.46), (f) a failed deploy was never confirmed. Post '[REVIEW] <GO|NO_GO> — deploy-subscriptions @ <sha/version> — lens: ECS deploy, reviewer deploy-subscriptions-review' to #apps. Block ONLY concrete P0/P1 defects; two remediation cycles max. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const DIAG_SCHEMA = { type: 'object', properties: { priorAttempt: { type: 'object' }, manifest: { type: 'object' }, failureRootCause: { type: 'string' }, smallestFix: { type: 'string' }, notChecked: { type: 'array' } }, required: ['failureRootCause', 'smallestFix'] }
const DEPLOY_SCHEMA = { type: 'object', properties: { intentPosted: { type: 'boolean' }, fixApplied: { type: 'string' }, deployOutput: { type: 'object' }, liveTest: { type: 'object' }, confirmPosted: { type: 'boolean' }, resumeCondition: { type: 'string' } }, required: ['intentPosted'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }

phase('Diagnose')
const diag = await agent(DIAGNOSE, { label: 'deploy-subscriptions-diagnose', phase: 'Diagnose', schema: DIAG_SCHEMA, model: 'opus' })

phase('Deploy')
const dep = diag ? await agent(DEPLOY, { label: 'deploy-subscriptions-deploy', phase: 'Deploy', schema: DEPLOY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = dep ? await agent(REVIEW, { label: 'deploy-subscriptions-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' }) : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'deploy did not run', detail: 'diagnose failed' }] }

return { diag: diag && { failureRootCause: diag.failureRootCause, smallestFix: diag.smallestFix }, deploy: dep && { intentPosted: dep.intentPosted, liveTest: dep.liveTest, confirmPosted: dep.confirmPosted, resumeCondition: dep.resumeCondition }, review: review && review.verdict }
