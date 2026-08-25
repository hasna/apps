export const meta = {
  name: 'loops-ready-regression-fix',
  description: 'FIX the /ready 503 unsafe_database_role REGRESSION on hosted loops (row f33955f1; alarm 722280 19:27Z): the cutover lane verified /ready 200 at 19:06-19:12Z; at 19:22-19:24Z the unhealthy-hosts alarm datapoints rose and /ready returned 503 {"code":"unsafe_database_role"} — the exact signature the cutover fixed. Lane: idempotency check -> diagnose what changed between 19:12Z and 19:22Z (DB role/grants state vs cutover-applied state; or a redeployment rolling old config) -> restore the cutover-applied state with the smallest change -> verify /health /ready /version 200 + /v1 + ECS/ALB -> [DEPLOY INTENT]/[DEPLOY-CONFIRM] on git-deployments -> comment + complete row f33955f1.',
  phases: [
    { title: 'Remediate', detail: 'idempotency check; diagnose the regression mechanism (role state vs deployment); restore the cutover-applied state (smallest change); /ready back to 200' },
    { title: 'Verify', detail: '/health /ready /version 200 literal on loops.hasna.xyz; /v1 route serves (401 missing_token or 200, NOT 503); ECS/ALB target health; scheduler capability present; snapshot intact' },
    { title: 'Report', detail: '[DEPLOY INTENT] before / [DEPLOY-CONFIRM] after on git-deployments; comment + complete row f33955f1' },
  ],
}

const ROW = 'f33955f1'
const SNAPSHOT = 'loops-premig-20260821'

const CONST = `
You are the loops-ready-regression-fix lane (row ${ROW}). Final text = machine-readable JSON.

Context (measured evidence, 2026-08-21): the loops cutover lane (row c998eab9, completed 19:06:27Z) restored and verified loops.hasna.xyz: /health rc=200, /ready rc=200, /version rc=200 (0.5.4, capabilities [runner.claimScope]), /v1 answered 401 missing_token (auth surface live), ECS loops-prod 2/2, ALB 2/2 healthy. Its root cause was service-side: task definition loops-prod:15 mapped HASNA_LOOPS_AUTH_DATABASE_URL to the loops_auth DSN (correct), IAM GetSecretValue + KMS Decrypt grants were added for the authenticator secret, and open_loops_owner base-table grants (SELECT on api_keys, INSERT on audit_events + preauth_audit_events) were restored after the drill normalize over-revoked them. THEN at 19:22-19:24Z the loops-prod-unhealthy-hosts alarm (OK->ALARM 19:27:54Z, datapoints [2.0, 2.0, 1.0] >= 1.0) fired, and an independent probe at 19:29Z measured: /health rc=200, /version rc=200, /ready rc=503 {"code":"unsafe_database_role"} (truncated at 120 bytes; get the full body). The /ready gate has regressed to the pre-fix signature.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: (a) row ${ROW} is pending and unowned; (b) no OTHER lane is executing on hosted loops right now (check the row comments, git-deployments, incidents thread 722280 — if a live fixer exists, record and STOP); (c) the cutover row c998eab9 comments carry the exact applied state (the grants + td:15 + DSN wiring listed above; re-read them); (d) RDS snapshot '${SNAPSHOT}' is intact (rollback artifact). If ANY check fails, record the exact state and STOP.
- DIAGNOSE FIRST, MUTATE SECOND. Name the mechanism that re-broke the /ready gate between 19:12Z and 19:22Z before changing anything. Candidate mechanisms to distinguish with evidence: (1) DB role/grants state regressed (re-check the roles, memberships and the audit grants vs the cutover-applied state — re-read the c998eab9 comments for the exact grants; check whether the SECURITY DEFINER auth functions can read api_keys and write audit rows); (2) a deployment rolled after 19:12Z (check ECS deployment history on loops-prod — deployments list with start/stop times — and whether the running task definition is td:15 with the corrected DSN wiring; a re-deploy of td:14 or an old task definition would re-break the AUTH wiring); (3) the scheduler/claim path wedged. Find the actual mechanism with literal evidence; do NOT guess.
- FIX with the SMALLEST change that restores the cutover-applied state: re-apply the missing grant(s) or role membership(s) if the DB state regressed (the drill-proven role sequence is on record in c998eab9 comments and the drill instance loops-premig-drill-20260821); re-deploy td:15 if the wiring regressed. NEVER re-run the tenant backfill migration (0009/0010) or any migration blindly — check applied state first (the cutover verified applied=[0009,0010,0013,0014...]). If the app is serving (it is — /health and /version are 200), do not restart what is not broken.
- VERIFY (bounded, literal): curl loops.hasna.xyz /health /ready /version -> 200 each with literal bodies (paste them); /v1 route answers NOT 503 (401 missing_token or 200); ECS loops-prod running/desired and ALB target group healthy (literal); /version carries runner.claimScope; snapshot '${SNAPSHOT}' intact; drill instance untouched.
- REPORT: post '[DEPLOY INTENT] loops@0.5.4-readyfix -> loops.hasna.xyz — <one-line mechanism>' to git-deployments BEFORE the mutation; post '[DEPLOY-CONFIRM] ... — <live-test evidence line>' IN-THREAD after verification. Comment row ${ROW} at each state change with evidence. Complete row ${ROW} ONLY after /health /ready /version are 200 and a /v1 route serves.
- If the mechanism is a DB change made by an UNKNOWN actor between 19:12Z and 19:22Z, record the exact evidence (who/what could have run it: check RDS events, recent connections if visible) and say so in the row — do not paper over it.
- No secrets: never print/capture/commit credential values (DB passwords, tokens). Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. English. Distinguish measured vs inferred; state what you did not check. Record as you go.
`

const REMEDIATE = CONST + `
ROLE: remediate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Diagnose the /ready regression mechanism with literal evidence (role/grants state vs deployment history vs wiring); apply the SMALLEST fix restoring the cutover-applied state; re-verify /health /ready /version and a /v1 route. Post [DEPLOY INTENT] to git-deployments BEFORE mutating. Return (JSON): { rowState, mechanism, mechanismEvidence: [string], fixApplied: [string], migrationsRun: [string], healthRc, readyRc, versionRc, v1Rc, literalLines: [string], blocked: null | {missingAccess, exactCommand}, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the post-fix state: re-probe loops.hasna.xyz /health /ready /version (200, literal bodies) and a /v1 route; confirm the scheduler claim capability; confirm snapshot intact + drill untouched; confirm ECS/ALB health (literal). Return (JSON): { healthRc, readyRc, versionRc, v1Rc, schedulerUp, snapshotIntact, drillUntouched, ecsHealthy, literalLines: [string], evidence }
`

const REPORT = CONST + `
ROLE: report lane. If verification passed: post '[DEPLOY-CONFIRM] loops@0.5.4-readyfix -> loops.hasna.xyz — <live-test evidence line>' IN-THREAD on git-deployments; comment row ${ROW} with the full evidence; complete row ${ROW}. If blocked: comment the blocker + resume condition, leave open. Return (JSON): { confirmPostId, rowState, completed, evidence }
`

const REMEDIATE_SCHEMA = { type: 'object', properties: { rowState: { type: 'string' }, mechanism: { type: 'string' }, mechanismEvidence: { type: 'array' }, fixApplied: { type: 'array' }, migrationsRun: { type: 'array' }, healthRc: { type: 'number' }, readyRc: { type: 'number' }, versionRc: { type: 'number' }, v1Rc: { type: 'number' }, literalLines: { type: 'array' }, blocked: { type: ['object', 'null'] }, evidence: { type: 'string' } }, required: ['mechanism', 'readyRc', 'literalLines'] }
const VERIFY_SCHEMA = { type: 'object', properties: { healthRc: { type: 'number' }, readyRc: { type: 'number' }, versionRc: { type: 'number' }, v1Rc: { type: 'number' }, schedulerUp: { type: 'boolean' }, snapshotIntact: { type: 'boolean' }, drillUntouched: { type: 'boolean' }, ecsHealthy: { type: 'boolean' }, literalLines: { type: 'array' }, evidence: { type: 'string' } }, required: ['readyRc', 'schedulerUp'] }
const REPORT_SCHEMA = { type: 'object', properties: { confirmPostId: { type: ['string', 'null'] }, rowState: { type: 'string' }, completed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['rowState'] }

phase('Remediate')
const remediate = await agent(REMEDIATE, { label: 'loops-readyfix-remediate', phase: 'Remediate', schema: REMEDIATE_SCHEMA, model: 'opus' })

phase('Verify')
const verify = remediate && !remediate.blocked && remediate.readyRc === 200
  ? await agent(VERIFY, { label: 'loops-readyfix-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' })
  : null

phase('Report')
const report = verify && verify.readyRc === 200 && verify.schedulerUp
  ? await agent(REPORT, { label: 'loops-readyfix-report', phase: 'Report', schema: REPORT_SCHEMA, model: 'opus' })
  : { rowState: remediate && remediate.blocked ? 'blocked' : 'in_progress', completed: false, confirmPostId: null, evidence: JSON.stringify({ remediate, verify }) }

return { remediate: remediate && { mechanism: remediate.mechanism, readyRc: remediate.readyRc, fixApplied: remediate.fixApplied, blocked: remediate.blocked }, verify: verify && { readyRc: verify.readyRc, schedulerUp: verify.schedulerUp }, report }
