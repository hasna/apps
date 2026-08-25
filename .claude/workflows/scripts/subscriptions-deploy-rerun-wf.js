export const meta = {
  name: 'subscriptions-deploy-rerun',
  description: 'Owner directive 2026-08-20 (deploy subscriptions): the migration-ledger fix merged (internal-apps PR #382, 11aba88c) — the deploy blocker is cleared. Resume line (posted on rows 0ec39e58/c82297eb): rerun the ECS deploy of @hasna-internal/subscriptions, verify the version live on accounts.hasna.xyz, [DEPLOY-CONFIRM] in-thread 716872. This lane: resolve the exact artifact that carries the fix (the 0.2.46 image may predate the merge), deploy it via /tmp/deploy-one.sh with intent/confirm gates, live verify, Fable review.',
  phases: [
    { title: 'Resolve', detail: 'which image carries the migration-ledger fix (build time vs merge 11aba88c); name the exact artifact' },
    { title: 'Deploy', detail: 'deploy-one.sh with [DEPLOY INTENT]/[DEPLOY-CONFIRM] gates + live verify' },
    { title: 'Review', detail: 'Fable adversarial review' },
  ],
}

const CONST = `
You are the subscriptions-deploy-rerun lane (owner-authorized, deploy of @hasna-internal/subscriptions to accounts.hasna.xyz). Final text = machine-readable JSON.

Context (measured): the deploy blocker is CLEARED — the migration-ledger fix merged (hasna-internal/internal-apps PR #382, 11aba88c41eeaca48aff0dc077e91a0605b29550): accounts-era applied ledger restored byte-exact (accounts_0001_accounts..0007_alias_records + 0005a; cmp-verified vs the 0.2.45 tarball whose migrate task passed the production ledger 2026-08-20T12:30Z), 0008_auth_status the only new ID with the schema cutover. CRITICAL QUESTION: @hasna-internal/subscriptions@0.2.46 was published BEFORE this merge — the ECR image staged in the SSM manifest / taskdefs (accounts-prod:9 / accounts-prod-migrate:7) may predate the fix and would reproduce the migration failure. The deploy must run the artifact that CARRIES THE FIX — resolve this from evidence before any deploy. accounts.hasna.xyz is currently LIVE at 0.2.45. Driver: /tmp/deploy-one.sh <app> <version> <repo-key: hasna-apps|internal-apps> — cluster oss-fleet-prod, account 789877399345, region us-east-1.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: read the deploy resume lines on rows 0ec39e58 + c82297eb; check git-deployments for any deploy attempt NEWER than the fix merge (11aba88c) — if a lane already deployed the fix, verify and record, do NOT duplicate.
- RESOLVE (evidence, before any deploy): (a) the ECR image for the app (repository from the SSM manifest /hasna/deploy/subscriptions or /hasna/deploy/accounts) — image build/pushed timestamp vs the 11aba88c merge time; (b) whether the migration runner code in the image carries the accounts_-era ledger restore (inspect the image's migration sources or the build provenance — the fix is in internal-apps main, NOT in the published 0.2.46 tarball); (c) the exact version label the deploy should carry. If the staged image predates the fix: rebuild the image from internal-apps main at the fix commit (or the released version that includes it — if the package must be re-released, bump patch through the internal-apps release path with its own gates and announce on git-publishing per the publish protocol; the published-version check is npm view @hasna-internal/subscriptions version). NEVER deploy an artifact that lacks the fix — that reproduces the 12:25Z migration failure.
- DEPLOY: post [DEPLOY INTENT] to git-deployments FIRST (<app>@<version> -> oss-fleet-prod/<route> — one-line changelog), then run the deploy (deploy-one.sh with the resolved app name/version), capturing evidence per step. The migration step must exit 0. If any step fails: record the exact failure (aws ecs describe-tasks stopped reason + container exit code; CloudWatch logs if reachable), post the failure in-thread (never a confirm), leave rows pending with a resume condition. NEVER bypass a failing migration.
- LIVE VERIFY: curl the service route /health (200 + identity) and /version (the resolved version) — per deploy-one.sh STEP 6/7 evidence lines. Only then [DEPLOY-CONFIRM] in-thread (reply to the INTENT message) with the live-test evidence line. The confirm target thread: the deploy intent for THIS deploy (post both intent and confirm on git-deployments).
- No secrets: never print/capture/commit credential values; AWS via the hasna-xyz-infra profile, assert the account id (aws sts get-caller-identity) before touching resources. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on rows 0ec39e58 + c82297eb, posts to #board. English. Distinguish measured vs inferred; state what you did not check.
`

const RESOLVE = CONST + `
ROLE: resolve (Opus). (1) Read the resume lines on 0ec39e58/c82297eb + git-deployments for newer attempts (IDEMPOTENCY FIRST). (2) Resolve the deploy targets: SSM manifest /hasna/deploy/subscriptions (or /hasna/deploy/accounts — the live name), read it and name service/web_task_family/web_container/migration_task_family/migration_container/ecr_repository_url/subnets/security_groups; check whether an ECS service subscriptions-prod or accounts-prod exists. (3) Determine the image state: ECR image pushed timestamp vs the 11aba88c merge; whether the image carries the fix (evidence: build provenance, or inspect the migration runner sources in the image via aws ecr describe-images / the taskdef's image digest); the registry version of @hasna-internal/subscriptions (npm view). (4) Name the exact artifact + version label to deploy. Do NOT mutate anything in this phase. Return (JSON): { idempotency: {newerAttempt, verdict}, manifest: {name, service, webFam, webCont, migFam, migCont, ecrRepo, subnets, sgs}, imageState: {pushedAt, predatesFix, carriesFix, digest}, registryVersion, deployTarget: {app, version, route}, notChecked: [string] }
`

const DEPLOY = CONST + `
ROLE: deploy (Opus). Apply the resolve result: if the image predates the fix, rebuild/publish the fixed artifact FIRST through the sanctioned path (internal-apps main at the fix commit; patch release through the internal-apps release gates with git-publishing intent/confirm if a re-release is needed — the migration-ledger fix has NO changeset-triggered version yet since PR #382 merged after 0.2.46). Then post [DEPLOY INTENT] to git-deployments, run the deploy (deploy-one.sh with the resolved app/version/repo-key), capture evidence per step, migration exit 0 required, live verify /health + /version, [DEPLOY-CONFIRM] in-thread with the evidence line. On failure: exact failure recorded, posted in-thread, rows pending with resume condition. Return (JSON): { artifactResolved, intentPosted, publishIfNeeded: {needed, version, confirmPosted}, deployOutput: {steps: [{step, rc, evidence}], stoppedAt}, liveTest: {health, version, route}, confirmPosted, resumeCondition }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review: (a) the deployed artifact is PROVEN to carry the migration-ledger fix (image state evidence, not assumption), (b) intent before / confirm after with matching evidence lines, in-thread on git-deployments, (c) migration exit 0 measured, (d) live verify actually ran (health 200 + version match), (e) a failed deploy was never confirmed, (f) no credential values in any output, (g) the 12:25Z failure mode (accounts-era ledger) is not reproducible in the deployed artifact. Post '[REVIEW] <GO|NO_GO> — subscriptions-deploy-rerun @ <version/sha> — lens: ECS deploy of the fixed artifact, reviewer subscriptions-deploy-rerun-review' to #board. Block ONLY concrete P0/P1 defects; two remediation cycles max. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const RESOLVE_SCHEMA = { type: 'object', properties: { idempotency: { type: 'object' }, manifest: { type: 'object' }, imageState: { type: 'object' }, registryVersion: { type: 'string' }, deployTarget: { type: 'object' }, notChecked: { type: 'array' } }, required: ['deployTarget', 'imageState'] }
const DEPLOY_SCHEMA = { type: 'object', properties: { artifactResolved: { type: 'boolean' }, intentPosted: { type: 'boolean' }, publishIfNeeded: { type: 'object' }, deployOutput: { type: 'object' }, liveTest: { type: 'object' }, confirmPosted: { type: 'boolean' }, resumeCondition: { type: 'string' } }, required: ['intentPosted'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }

phase('Resolve')
const res = await agent(RESOLVE, { label: 'deploy-rerun-resolve', phase: 'Resolve', schema: RESOLVE_SCHEMA, model: 'opus' })

phase('Deploy')
const dep = res && res.deployTarget ? await agent(DEPLOY, { label: 'deploy-rerun-deploy', phase: 'Deploy', schema: DEPLOY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = dep ? await agent(REVIEW, { label: 'deploy-rerun-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' }) : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'deploy did not run', detail: JSON.stringify(res) }] }

return { resolve: res && { deployTarget: res.deployTarget, imageState: res.imageState }, deploy: dep && { intentPosted: dep.intentPosted, liveTest: dep.liveTest, confirmPosted: dep.confirmPosted, resumeCondition: dep.resumeCondition }, review: review && review.verdict }
