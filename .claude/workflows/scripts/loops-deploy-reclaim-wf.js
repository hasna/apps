export const meta = {
  name: 'loops-deploy-reclaim',
  description: 'Deploy the current hasna/loops (with the /leases/stuck reclaim verb, merged 9655f27c0) to loops.hasna.xyz, run the reclaim, verify the wedged loops fire and succeed (task bb5f58ab)',
  phases: [
    { title: 'Deploy', detail: 'deploy main to loops.hasna.xyz via the sanctioned path; verify the reclaim verb exists' },
    { title: 'Reclaim', detail: 'clear the lease-wedged runs through the new verb' },
    { title: 'Verify', detail: 'sample loops fire and succeed with terminal receipts' },
    { title: 'Review', detail: 'Fable review' },
    { title: 'Report', detail: 'task + #board' },
  ],
}

const TASK = 'bb5f58ab-7596-4d83-8311-9fc7b29e98ee'

const CONST = `
You are a lane of the loops-deploy-reclaim workflow (2026-08-19, task ${TASK}, CRITICAL). The fleet Loops outage (25 frozen + 19 dead of 66 active) is BLOCKED on one deploy: the reclaim capability (GET /leases/stuck, 'harden hosted execution truth' #201) is MERGED on origin/main as squash 9655f27c0 (pre-squash 0efb4ebf5), but the DEPLOYED loops.hasna.xyz lacks the verb (404 re-verified by the prior repair workflow wf_4f829165-f56). The cloud runner on station01 is alive and executing (pid 3247955, loops-cloud-runner.sh, 32 terminal runs since 00Z, 12 exit=0) but cannot reclaim the ~20 lease-wedged runs (status=running, lease expired 2026-08-03..08-18, held by cloud-runner-station01/01-b/spark01). Final text = machine-readable JSON.

KNOWN CLASSES (measured by wf_4f829165-f56): (a) lease_wedge ~20 loops incl. chief-of-staff-v8 (wedge + exit=83 class tracked c1216d46 — do not re-file), chief-strategy-report, chief-harness/engineering-coordination, chief-of-shipping-pass-v8, ecosystem-intel-* x5, codewith-loop-probe, self-workspace-drift, telegram-inbound, chief-marketing-report-backstop, stale-agent-scan, chief-shipping-followthrough, machine-ops-recovery-spark01, fleet-probe-scratch-db-cleanup-delivery-spark01 x2; (b) never-claimed machine-pinned ~10 (station02/03-bound, no runner there: machine-ops-scratch-db-cleanup-apple03 x2, fleet-probe-scratch-db-cleanup-delivery-apple03, agent-chief-research-coordination-10m + others); (c) per-loop dead-cadence classes (pr-monitor = repos 0.1.49 brick, release pending aaef650b — record-and-skip; exit=83 c1216d46; ecosystem-intel-digest post-send failure; exit=127 verify-shell x2).

Non-negotiable rules (all agents):
- DEPLOY THROUGH THE SANCTIONED PATH ONLY: read apps/loops docs + the repo's deploy config (deploy scripts, the loops.hasna.xyz service deployment convention, Docker/ECS or the documented path) and deploy origin/main's loops server exactly that way. Never hand-roll a deploy. Record the deploy method + the deployed sha.
- IDEMPOTENCY FIRST: before deploying, check whether the deployed control plane ALREADY has the reclaim verb (probe GET /leases/stuck on loops.hasna.xyz via the loops CLI's hosted-diagnostics surface or a bounded curl — never a secret-bearing call). If it exists, skip the deploy and go straight to Reclaim.
- RECLAIM: use the new verb via the package-owned CLI surface (loops CLI hosted-diagnostics or the documented reclaim command — read the merged code's CLI surface for the exact form). Clear ONLY runs whose lease is genuinely expired and whose claimedBy is a runner identity (never a live run). Record each reclaimed run id + the terminal state transition.
- VERIFY: after reclaim, each previously-wedged loop must produce a terminal run (real run, not synthetic): observe the next scheduled fire or a bounded 'loops run <name>' execution — record status + receipt. The verify lane samples at least 8 loops across the classes.
- Per-loop dead-cadence classes: fix what the lane can fix through package-owned surfaces (verify-shell 127 = locate the missing command reference; ecosystem-intel-digest post-send failure = read its run output); pr-monitor + exit-83 recorded as known-tracked (skip).
- No secrets: never print/capture credential values; the loops API key is consumed via the CLI's own config, never echoed. Capture path: redirect to files. Paste literal output lines. Record as you go: comments on ${TASK}, posts to #board. English. Lineage 'conversations agents register' named loops-deploy-<your-role>. Attribution trailer 'Agent: loops-deploy-reclaim' LAST in any commit.
`

const DEPLOY = CONST + `
ROLE: deploy lane. Per the CONST: idempotency-probe first (does the deployed control plane already expose the reclaim verb?); if not, deploy origin/main via the sanctioned apps/loops deploy path; verify the deployed sha + the verb responds (bounded). Record the method, sha, and verb probe result. Do NOT reclaim in this lane (the Reclaim lane does it).
Return (JSON): { alreadyDeployed: bool, deployed: bool, deployedSha: string|null, deployMethod: string, verbProbe: string, evidence: string }
`

const RECLAIM = CONST + `
ROLE: reclaim lane. Use the package-owned CLI surface for the stuck-lease reclaim (read the merged code's CLI for the exact form — hosted-diagnostics or the documented verb). Reclaim ONLY the lease-wedged set from the classify data: {WEDGED}. For each: verify the run is status=running with an expired lease and a runner claimedBy, reclaim it, record the terminal state transition. NEVER touch a run whose lease is live. Record every reclaimed run id + the resulting state. If the verb is still absent (deploy failed), return blocked with the probe evidence — do NOT work around.
Return (JSON): { reclaimed: [{runId, loop, claimedBy, leaseExpiredAt, terminalState}], blocked: bool, blockedEvidence: string|null }
`

const VERIFY = CONST + `
ROLE: verify lane. Sample the previously-wedged + never-claimed + dead-cadence sets: {SET}. For each sampled loop: 'loops runs <name>' (bounded) — require a terminal run AFTER the reclaim timestamp (or, for never-claimed machine-pinned loops, classify what the fix would be: station02/03 runner or rebind). For dead-cadence per-loop classes, run the per-loop fix only if the fix is a package-owned one-liner (verify-shell 127 command reference), else record. pr-monitor + chief-of-staff-v8 recorded-skips. Paste literal output lines.
Return (JSON): { verified: [{name, status, terminalAfterReclaim: bool, evidence}], recordedSkips: [string], residue: [string] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review: (a) deploy went through the sanctioned path with a recorded sha; (b) reclaims touched only expired-lease runs of runner identities; (c) verification uses real terminal runs; (d) no secrets; (e) known-tracked classes not re-filed. Post '[REVIEW] <GO|NO_GO> — loops-deploy-reclaim @ <sha> — lens: Loops deploy+reclaim, reviewer loops-deploy-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const REPORT = CONST + `
ROLE: report. Aggregate: deploy state, reclaimed count, verified loops, residue (never-claimed machine-pinned set + per-loop classes + the repos-brick note). Comment ${TASK} (complete only if the deployed control plane reclaimed AND a sampled set verified terminal; else in_progress with residue), post to #board.
Return (JSON): { taskState: string, residue: [string] }
`

const DEPLOY_SCHEMA = { type: 'object', properties: { alreadyDeployed: { type: 'boolean' }, deployed: { type: 'boolean' }, deployedSha: { type: ['string', 'null'] }, deployMethod: { type: 'string' }, verbProbe: { type: 'string' }, evidence: { type: 'string' } }, required: ['deployed'] }
const RECLAIM_SCHEMA = { type: 'object', properties: { reclaimed: { type: 'array' }, blocked: { type: 'boolean' }, blockedEvidence: { type: ['string', 'null'] } }, required: ['reclaimed'] }
const VERIFY_SCHEMA = { type: 'object', properties: { verified: { type: 'array' }, recordedSkips: { type: 'array' }, residue: { type: 'array' } }, required: ['verified'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const REPORT_SCHEMA = { type: 'object', properties: { taskState: { type: 'string' }, residue: { type: 'array' } }, required: ['taskState'] }

const WEDGED = ['ecosystem-intel-bookmarks', 'ecosystem-intel-models', 'ecosystem-intel-harness', 'ecosystem-intel-codex', 'ecosystem-intel-digest', 'chief-strategy-report', 'chief-of-staff-coordination-v8-10m', 'chief-harness-coordination', 'chief-engineering-coordination', 'chief-of-harness-coordination-v5-30m', 'chief-of-shipping-pass-v8', 'fleet-probe-scratch-db-cleanup-delivery-spark01', 'machine-ops-recovery-spark01', 'self-workspace-drift-every-15m-alert-agent-ceo-r2', 'telegram-inbound-every-5m-alert-agent-ceo-r1', 'codewith-loop-probe', 'chief-marketing-report-backstop', 'stale-agent-scan-station01', 'chief-shipping-followthrough', 'fleet-probe-scratch-db-cleanup-delivery-spark01']
const VERIFY_SET = ['ecosystem-intel-digest', 'chief-strategy-report', 'chief-harness-coordination', 'chief-engineering-coordination', 'chief-of-shipping-pass-v8', 'self-workspace-drift-every-15m-alert-agent-ceo-r2', 'telegram-inbound-every-5m-alert-agent-ceo-r1', 'codewith-loop-probe', 'stale-agent-scan-station01', 'machine-ops-recovery-spark01', 'fleet-probe-scratch-db-cleanup-delivery-spark01', 'machine-ops-scratch-db-cleanup-apple03', 'agent-chief-research-coordination-10m', 'verify-shell']

phase('Deploy')
const deploy = await agent(DEPLOY, { label: 'loops-deploy-lane', phase: 'Deploy', schema: DEPLOY_SCHEMA })
log(`deploy: already=${deploy && deploy.alreadyDeployed} deployed=${deploy && deploy.deployed} sha=${deploy && deploy.deployedSha}`)

phase('Reclaim')
let reclaim = null
if (deploy && (deploy.alreadyDeployed || deploy.deployed)) {
  reclaim = await agent(RECLAIM.replace('{WEDGED}', JSON.stringify(WEDGED)), { label: 'loops-reclaim-lane', phase: 'Reclaim', schema: RECLAIM_SCHEMA })
} else {
  reclaim = { reclaimed: [], blocked: true, blockedEvidence: 'deploy did not land — reclaim verb unavailable' }
}
log(`reclaim: ${reclaim && reclaim.reclaimed ? reclaim.reclaimed.length : 0} reclaimed, blocked=${reclaim && reclaim.blocked}`)

phase('Verify')
const verify = await agent(VERIFY.replace('{SET}', JSON.stringify(VERIFY_SET)), { label: 'loops-deploy-verify', phase: 'Verify', schema: VERIFY_SCHEMA })

phase('Review')
const review = await agent(REVIEW, { label: 'loops-deploy-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })

phase('Report')
const report = await agent(REPORT, { label: 'loops-deploy-report', phase: 'Report', schema: REPORT_SCHEMA })

return { deploy, reclaim, verify, review, report }
