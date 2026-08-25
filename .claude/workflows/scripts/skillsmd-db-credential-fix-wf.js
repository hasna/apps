export const meta = {
  name: 'skillsmd-db-credential-fix',
  description: 'Fix lane for incident 715672 / task a5baac8c (nopen project): skillsmd production web task DB password mismatch — RDS rejects skillsmd_admin with 28P01 FATAL on every new pool connection (202 RDS auth failures 2026-08-20 00:18Z-10:05Z, 181 target 5xx before 09:30Z, alarm 715672 tripped at 09:56Z). Reconcile the credential between the app secret and RDS, redeploy, verify a fresh DB connection succeeds. Investigate (measure the secret source) -> Fix (smallest owned reconciliation, credential-safe) -> Verify (no new 28P01, DB-backed request 200) -> Fable Review -> Report',
  phases: [
    { title: 'Investigate', detail: 'idempotency check + measure where the web task gets its DB password and what RDS expects' },
    { title: 'Fix', detail: 'smallest owned credential reconciliation, credential-safe, redeploy' },
    { title: 'Verify', detail: 'no new 28P01 in RDS logs, DB-backed request succeeds, alarm stays OK' },
    { title: 'Review', detail: 'Fable adversarial review' },
    { title: 'Report', detail: 'update task a5baac8c + incident thread, record evidence' },
  ],
}

const ROW = 'a5baac8c-027f-4dec-898d-cd3f8dd79b09'

const CONST = `
You are a lane of the skillsmd-db-credential-fix workflow (2026-08-20, incident 715672, task ${ROW} — nopen project). Mission: reconcile the skillsmd production DB credential so the web task can authenticate as skillsmd_admin. Final text = machine-readable JSON.

THE MEASURED DEFECT (investigation aaa8fee37450955d3, 3 surfaces, read-only, profile hasna-tools / account 059898286899): every target 5xx == app-logged DrizzleQueryError wrapping pg 28P01 'password authentication failed for user "skillsmd_admin"' — the running ECS web task's DB password does not match RDS. Standing 2026-08-20 since 00:18Z (202 RDS auth failures, 181 target 5xx before 09:30Z; alarm tripped 09:56Z on a burst of 6; cleared OK 10:09Z). Warm pooled connections + DB-free /api/health mask it; bursts recur on connection churn until the credential is reconciled. App: skillsmd-production (ALB app/skillsmd-production/4c6f0e24c4f6af24, target 10.65.1.77:3505), web service skillsmd-production-web, RDS skillsmd-production-postgres (hasna-tools). NOT an outage; the fix is not urgent-deploy but MUST land this pass.

Non-negotiable rules (all agents):
- CREDENTIAL HYGIENE IS THE TOP RULE: never print, capture, echo, paste, log, or commit any credential VALUE in any encoding. Discover credentials by NAME only (secrets search <term>, secrets get <key> --check prints length+sha256 only). Consume a value only with 'secrets exec <key> --as <VAR> -- <cmd>' (value reaches only the child process env). For AWS Secrets Manager / SSM parameters, never fetch and print parameter values: use the parameter NAME, and where a value must be applied, apply it through the narrowest supported mechanism without materializing it into a transcript (e.g. 'aws ssm put-parameter --value "$(aws secretsmanager get-secret-value ...)"' is FORBIDDEN as a printed form — use the supported CLI/service route that consumes without rendering, or capture to a mode-600 file under /tmp and delete after use, scanning both streams per the capture-path rule before reading). NEVER write a credential into a task comment, channel post, PR, or transcript.
- IDEMPOTENCY CHECK FIRST: check task ${ROW} comments + incident 715672 thread for a live fixer or a landed fix (RDS logs show no new 28P01 after a redeploy). If the credential was already reconciled and verified, verify and record; do NOT duplicate.
- SCOPE: the smallest owned reconciliation ONLY — the app's DB credential source (ECS task secret / SSM / Secrets Manager / env) vs RDS's expected password. Do NOT touch other secrets, roles, RLS, or the 8aced233 architecture row (separate, stale, out of scope). Do NOT rotate RDS master, do NOT create new users unless the measured path requires it (prefer matching the existing skillsmd_admin role).
- The vault is the authority for the provisioned password: search hasna/secrets for the skillsmd / nopen RDS credential key; verify with --check. RDS's CURRENT expected password must be established by measurement (e.g. a successful connection with the vault credential — prove which side is stale BEFORE mutating anything; the investigation could not tell whether the task secret or RDS was rotated).
- MUTATION PATH: the smallest change is (a) update the secret store the task reads to the proven-correct password, OR (b) set RDS skillsmd_admin password to the vault-provisioned value, whichever the investigation proves correct — then redeploy the web service (new task definition / force new deployment), and verify. A rollout/restart of skillsmd-production-web is authorized as part of this fix. Do NOT touch the workers service.
- Verify: (1) 'aws rds describe-db-log-files' or equivalent shows NO new 28P01 after the redeploy timestamp; (2) a DB-backed request returns 200 (the public skills listing endpoint — the failing query was the public skills select; curl through the ALB host); (3) alarm state OK; (4) the task's stored secret postimage is the applied value (readback). Record literal outputs.
- AWS profile hasna-tools only (assert account 059898286899 first). Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on task ${ROW}, posts to the incident thread 715672 and #board. English. Lineage 'conversations agents register' named skillsmd-fix-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per the CONST). Then MEASURE the credential story read-only: (a) where does the running web task get its DB password — read the ECS task definition (skillsmd-production-web) secrets/env (NAMES and ARNs only, never values); (b) what does the vault hold — secrets search for the skillsmd/nopen RDS credential (name only) + --check; (c) what does RDS expect — determine by connecting with the vault credential via a HERMETIC check (secrets exec --as PGPASSWORD -- psql ... 'select 1' on a host-reachable path, output only rc/result, NEVER the password); (d) decide which side is stale (task secret vs RDS) and the smallest reconciliation. State what you did not check.
Return (JSON): { idempotency: { alreadyFixed: bool, liveFixer: string|null, decision: string }, secretSource: { kind: string, name: string, arn: string|null }, vaultKey: string|null, vaultCheck: { exists: bool, length: int|null }, rdsExpectedMatchesVault: bool|null, staleSide: 'task'|'rds'|'unknown', fixPlan: string, evidence: string }
`

const FIX = CONST + `
ROLE: fix lane. Per the CONST + the investigation ({PLAN}): apply the SMALLEST owned reconciliation (staleSide={STALE}): update the secret store the task reads to the proven-correct password, or set the RDS skillsmd_admin password to the vault value — via the narrowest supported route with zero value materialization into any transcript (mode-600 temp capture under /tmp + delete, or secrets exec wrapping the applying command). Then force a new deployment of skillsmd-production-web ('aws ecs update-service --force-new-deployment' with the updated task definition/secret version). Record the applied secret ARN/name + version (never the value) and the new deployment id. Do NOT weaken any guard.
Return (JSON): { applied: { kind: string, name: string, version: string|null, deploymentId: string|null }, staleSideConfirmed: string, valuesExposed: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: after the fix ({APPLIED}): (1) RDS logs (describe-db-log-files / log events) show ZERO new 28P01 auth failures after the redeploy timestamp; (2) a DB-backed request to the public skills listing returns HTTP 200 (curl the ALB hostname); (3) alarm skillsmd-production-target-5xx is OK (describe-alarms); (4) the applied secret readback matches (name/version, never the value). Record literal output lines.
Return (JSON): { checks: [{name, result, evidence}], allPass: bool, resumeCondition: string|null }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the fix: (a) the reconciliation matched the measured stale side (task secret vs RDS proven, not guessed), (b) zero credential values appeared in any transcript/task/thread, (c) the narrowest mutation was used (no unrelated changes, no new users, no master rotation), (d) verify proved the acceptance (no new 28P01, DB-backed 200, alarm OK), (e) the service is serving. Post '[REVIEW] <GO|NO_GO> — skillsmd-db-credential-fix @ <deployment id> — lens: production DB credential reconciliation, reviewer skillsmd-fix-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const REPORT = CONST + `
ROLE: report lane. Update task ${ROW}: complete it with the evidence IF the review is GO and verify allPass (merged/rolled-out state, verify literal outputs, review verdict, incident 715672 linkage: alarm state, RDS log evidence window). Post the resolution on the incident thread 715672 and one line on #board. If NO_GO: leave the task in_progress with the exact remaining gates + resume condition.
Return (JSON): { taskState: string, threadPosted: bool, residue: [string] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { idempotency: { type: 'object' }, secretSource: { type: 'object' }, vaultKey: { type: ['string', 'null'] }, vaultCheck: { type: 'object' }, rdsExpectedMatchesVault: { type: ['boolean', 'null'] }, staleSide: { type: 'string' }, fixPlan: { type: 'string' }, evidence: { type: 'string' } }, required: ['idempotency', 'staleSide', 'fixPlan'] }
const FIX_SCHEMA = { type: 'object', properties: { applied: { type: 'object' }, staleSideConfirmed: { type: 'string' }, valuesExposed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['applied', 'valuesExposed'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, allPass: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] } }, required: ['allPass'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const REPORT_SCHEMA = { type: 'object', properties: { taskState: { type: 'string' }, threadPosted: { type: 'boolean' }, residue: { type: 'array' } }, required: ['taskState'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'skillsmd-fix-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
let fix = null
if (investigate && investigate.idempotency && investigate.idempotency.decision !== 'already-done') {
  fix = await agent(FIX.replace('{PLAN}', investigate.fixPlan).replace('{STALE}', investigate.staleSide), { label: 'skillsmd-fix-apply', phase: 'Fix', schema: FIX_SCHEMA })
} else {
  fix = { applied: null, valuesExposed: false, evidence: 'idempotency: already-done' }
}

phase('Verify')
let verify = null
if (fix && fix.applied) {
  verify = await agent(VERIFY.replace('{APPLIED}', JSON.stringify(fix.applied)), { label: 'skillsmd-fix-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { allPass: false, resumeCondition: 'fix did not apply', checks: [] }
}

phase('Review')
let review = null
if (verify && verify.allPass) {
  review = await agent(REVIEW, { label: 'skillsmd-fix-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'fix/verify did not complete', detail: JSON.stringify({ fix, verify }) }] }
}

phase('Report')
const report = await agent(REPORT, { label: 'skillsmd-fix-report', phase: 'Report', schema: REPORT_SCHEMA })

return { investigate, fix, verify, review, report }
