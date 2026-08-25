export const meta = {
  name: 'loops-deploy-cutover',
  description: 'OWNER-PRIORITY (2026-08-21, explicit): bring hosted loops back up — execute the drill-proven cutover sequence against prod and verify the service. Row c998eab9: cutover partially done 07:45Z (0.5.4 code deployed, /ready 503 pending_migrations + unsafe_database_role, scheduler down fleet-wide since 07:45Z); SNAPSHOT + DRILL complete (snapshot loops-premig-20260821; drill instance loops-premig-drill-20260821 served /health=200 /ready=200 /version=200; sequence proven: master creates 4 NOLOGIN roles + hashaadmin memberships, REASSIGN OWNED BY loops_owner..., run pending migrations [0009,0010,...]); verify-FAIL 14:16Z: recovery worker NEVER STARTED (launch wrapper failed), /ready stayed 503 unsafe_database_role across 12 polls; driver silent since. Live probe 18:0xZ: /ready /version /health ALL 503 (service not answering). Lane: idempotency check -> execute the drill-proven prod sequence -> bring the service up -> verify endpoints + scheduler -> [DEPLOY INTENT]/[DEPLOY-CONFIRM] on git-deployments -> comment + complete row.',
  phases: [
    { title: 'Remediate', detail: 'idempotency check; diagnose why the service is not answering (ALB target / ECS task / DB role); run the drill-proven prod sequence (4 NOLOGIN roles + hashaadmin memberships, REASSIGN OWNED BY loops_owner, pending migrations [0009,0010,...]); start/restore the app so it serves' },
    { title: 'Verify', detail: '/health /ready /version 200 on loops.hasna.xyz; /v1 routes serving; scheduler up; capability runner.claimScope present; rollback artifact intact' },
    { title: 'Report', detail: '[DEPLOY INTENT] before / [DEPLOY-CONFIRM] after on git-deployments; comment + complete row c998eab9' },
  ],
}

const ROW = 'c998eab9'
const SNAPSHOT = 'loops-premig-20260821'
const DRILL = 'loops-premig-drill-20260821'

const CONST = `
You are the loops-deploy-cutover lane (row ${ROW}; OWNER-PRIORITY — the owner explicitly demanded loops deployed ASAP on 2026-08-21). Final text = machine-readable JSON.

Context (evidence on row ${ROW}): cutover partially done 2026-08-21 ~07:45Z — 0.5.4 code deployed, /version answered 0.5.4 postgresql capabilities=[runner.claimScope], but /ready=503 {pending_migrations} and all /v1/* 503 {auth_unavailable}; hosted scheduler down fleet-wide since 07:45Z. marcellus resumed ~14:05Z, measured NO pre-cutover snapshot existed anywhere, PITR healthy (14d, LatestRestorableTime 10:44Z), created manual RDS snapshot '${SNAPSHOT}' as the rollback artifact. DRILL COMPLETE: restore instance '${DRILL}' served /health=200 /ready=200 /version=200 — the prod sequence is PROVEN: (1) master creates 4 NOLOGIN roles + exact hashaadmin memberships; (2) REASSIGN OWNED BY loops_owner (the comment truncates at 'loops_owner,lo...' — the drill's exact continuation is in the drill instance's applied sequence; re-derive it from the drill instance if needed); (3) run the pending migrations — dry-run on the deployed 0.5.4 image showed applied=[0001..0008,0011,0012], pending=[0009,0010,...]. verify-FAIL 14:16Z: the recovery worker NEVER STARTED (launch wrapper failed before any work; worker out-file /tmp/opencode/loops-recovery-out.json absent); /ready stayed 503 {"code":"unsafe_database_role"} across 12 polls 13:52Z-14:16Z. Driver silent since. Live probe (this lane start): /ready /version /health ALL 503 — the service is not answering.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: (a) row ${ROW} is in_progress with NO live worker (last comment 14:16:26Z verify-FAIL; no heartbeat since — if the row lock is held, perform the supported authenticated stale handoff and record the receipt; never force-unlock); (b) no OTHER lane is executing this cutover (check the row comments + git-deployments + project channel for a live fixer); (c) the snapshot '${SNAPSHOT}' EXISTS (rollback artifact); (d) the drill instance '${DRILL}' state is known. If ANY check fails, record the exact state and STOP.
- DIAGNOSE FIRST, MUTATE SECOND: the service answers 503 at the load balancer — determine whether the ECS target is unhealthy/drained, the task is down, or the app is up but refusing (the earlier signature was the app answering /ready 503 with a JSON body). Name the mechanism before mutating. The DB role/migration fix is the PROVEN path from the drill; the app start is the second half.
- EXECUTE the drill-proven prod sequence against prod exactly as proven: master creates the 4 NOLOGIN roles + exact hashaadmin memberships; REASSIGN OWNED BY per the drill; apply pending migrations [0009,0010,...]. Use the same commands the drill used (recover them from the drill instance or the row's drill comments — never invent a new sequence). The snapshot '${SNAPSHOT}' is the rollback artifact; do NOT take a second snapshot unless the first is proven missing.
- BRING THE SERVICE UP: after the DB state is correct, ensure the app is serving (restart the ECS task / fix the ALB target / whatever the diagnosis names) so loops.hasna.xyz answers.
- VERIFY (bounded, literal): curl loops.hasna.xyz /health /ready /version -> 200 each with literal bodies; /v1 route answers (e.g. GET /loops) not 503; the scheduler is up (a run can be claimed — capability runner.claimScope present); the drill instance remains untouched. Paste literal output lines.
- REPORT: post '[DEPLOY INTENT] loops@0.5.4-cutover -> loops.hasna.xyz — migration 0009/0010 + role fix per drill, bring service up' to git-deployments BEFORE the mutation; post '[DEPLOY-CONFIRM] ... — <live-test evidence line>' IN-THREAD after verification. Comment row ${ROW} at each state change (BLOCKED/RESUMED/DONE with evidence). Complete row ${ROW} ONLY after /health /ready /version are 200 and a /v1 route serves.
- If the migration/role work is impossible from this machine (no DB access), record the exact missing access and the command that needs to run, then post the blocker to the row — do not fake a completion.
- No secrets: never print/capture/commit credential values (DB passwords, tokens). Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. English. Distinguish measured vs inferred; state what you did not check. Record as you go.
`

const REMEDIATE = CONST + `
ROLE: remediate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Diagnose the 503 mechanism (ALB/ECS/app) with literal evidence; execute the drill-proven prod sequence (roles, REASSIGN OWNED, migrations 0009/0010); bring the app up so loops.hasna.xyz answers; verify /health /ready /version and a /v1 route with literal output. Post [DEPLOY INTENT] to git-deployments BEFORE mutating. Return (JSON): { rowState, lockReceipt, serviceMechanism, migrationsApplied: [string], rolesCreated: [string], appRestart: {done, method}, healthRc, readyRc, versionRc, v1Rc, literalLines: [string], blocked: null | {missingAccess, exactCommand}, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the post-cutover state: re-probe loops.hasna.xyz /health /ready /version (200, literal bodies) and a /v1 route; confirm the scheduler can claim a run (capability runner.claimScope); confirm the snapshot rollback artifact is intact; confirm the drill instance was not touched. Return (JSON): { healthRc, readyRc, versionRc, v1Rc, schedulerUp, capability, snapshotIntact, drillUntouched, literalLines: [string], evidence }
`

const REPORT = CONST + `
ROLE: report lane. If verification passed: post '[DEPLOY-CONFIRM] loops@0.5.4-cutover -> loops.hasna.xyz — <live-test evidence line>' IN-THREAD on git-deployments; comment row ${ROW} with the full evidence; complete row ${ROW}. If blocked: comment the blocker + resume condition, leave open. Return (JSON): { confirmPostId, rowState, completed, evidence }
`

const REMEDIATE_SCHEMA = { type: 'object', properties: { rowState: { type: 'string' }, lockReceipt: { type: ['string', 'null'] }, serviceMechanism: { type: 'string' }, migrationsApplied: { type: 'array' }, rolesCreated: { type: 'array' }, appRestart: { type: 'object' }, healthRc: { type: 'number' }, readyRc: { type: 'number' }, versionRc: { type: 'number' }, v1Rc: { type: 'number' }, literalLines: { type: 'array' }, blocked: { type: ['object', 'null'] }, evidence: { type: 'string' } }, required: ['serviceMechanism', 'readyRc', 'literalLines'] }
const VERIFY_SCHEMA = { type: 'object', properties: { healthRc: { type: 'number' }, readyRc: { type: 'number' }, versionRc: { type: 'number' }, v1Rc: { type: 'number' }, schedulerUp: { type: 'boolean' }, capability: { type: 'string' }, snapshotIntact: { type: 'boolean' }, drillUntouched: { type: 'boolean' }, literalLines: { type: 'array' }, evidence: { type: 'string' } }, required: ['readyRc', 'schedulerUp'] }
const REPORT_SCHEMA = { type: 'object', properties: { confirmPostId: { type: ['string', 'null'] }, rowState: { type: 'string' }, completed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['rowState'] }

phase('Remediate')
const remediate = await agent(REMEDIATE, { label: 'loops-cutover-remediate', phase: 'Remediate', schema: REMEDIATE_SCHEMA, model: 'opus' })

phase('Verify')
const verify = remediate && !remediate.blocked && remediate.readyRc === 200
  ? await agent(VERIFY, { label: 'loops-cutover-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' })
  : null

phase('Report')
const report = verify && verify.readyRc === 200 && verify.schedulerUp
  ? await agent(REPORT, { label: 'loops-cutover-report', phase: 'Report', schema: REPORT_SCHEMA, model: 'opus' })
  : { rowState: remediate && remediate.blocked ? 'blocked' : 'in_progress', completed: false, confirmPostId: null, evidence: JSON.stringify({ remediate, verify }) }

return { remediate: remediate && { serviceMechanism: remediate.serviceMechanism, readyRc: remediate.readyRc, migrationsApplied: remediate.migrationsApplied, blocked: remediate.blocked }, verify: verify && { readyRc: verify.readyRc, schedulerUp: verify.schedulerUp }, report }
