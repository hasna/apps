export const meta = {
  name: 'loops-503-fix',
  description: 'Row 03f174ea (incident 717790): hosted loops GET /loops -> 503 while /health is 200 (0.5.4). This lane: server-side diagnosis of the /loops route on loops.hasna.xyz (deploy state, route policy, DB pool, post-upgrade regression), smallest owned repair, prove loops list rc=0 from station01, one Fable review, land, complete the row.',
  phases: [
    { title: 'Investigate', detail: 'classify the /loops 503: deploy state, route policy, DB pool, logs' },
    { title: 'Fix', detail: 'smallest owned repair in the owning layer, deploy or PR per evidence' },
    { title: 'Verify', detail: 'loops list rc=0 from station01 + /health + frozen-check alarm un-blinded' },
    { title: 'Review', detail: 'one Fable adversarial review' },
    { title: 'Land', detail: 'land per owning-repo gates + complete row 03f174ea' },
  ],
}

const CONST = `
You are the loops-503-fix lane (owner-authorized; row 03f174ea, incident 717790). Final text = machine-readable JSON.

Context (measured 2026-08-21, station01): 'loops list --json' rc=1 twice — stdout {"ok":false,"error":{"code":"ERROR","message":"Hasna cloud request failed: GET /loops?limit=200&offset=0 -> 503"}}. /health -> 200 {"status":"ok","version":"0.5.4","storage":"postgresql","connection":"file"}. Root -> 403 {"ok":false,"error":"route_policy_missing"}. 'loops status' rc=0 (client 0.5.4, api https://loops.hasna.xyz, key present). The hosted control plane reports 0.5.4 — the previously queued upgrade landed; the /loops list route failing while the service is healthy is a post-upgrade route-level defect (or a DB-pool/route-policy issue on that route). The frozen-loop alarm on station01 is blind until this route recovers.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: confirm row 03f174ea is still pending and no live fixer exists (open PR on hasna/loops, in_progress fixer row, other lane); if already fixed or a lane is live, verify + stop. Re-probe loops list first: if rc=0 now, the route recovered — record it, complete the row with the evidence, STOP.
- /home/hasna/workspace/repos/hasna/apps is READ/context only. Sync first (git -C <checkout> fetch origin main -q; never discard local work). File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/loops-503-fix cut from origin/main. PR-first; never push to main. Commits end with 'Agent: loops-503-fix-<role>' (the ONLY attribution line; never Co-Authored-By).
- INVESTIGATE the server side: read the loops hosted deployment state (ECS service loops-prod or the deployment surface the repo's deploy.yml/AGENTS.md names — resolve the exact surface, never guess), the route-policy layer (root 403 route_policy_missing suggests a policy gate; is /loops behind the same gate?), DB pool/connection health on the list route, and recent deploy/rollback state. Classify: post-upgrade regression in code, deploy misconfiguration, DB/connection failure, or transient. Paste literal evidence for each probe; state what you did not check.
- FIX the smallest owned repair in the owning layer (loops server code in apps/loops, or the deployment surface). Do not band-aid; do not mutate production stores in place (the irreversible-mutation freeze binds). If the fix is a redeploy/rollback of the exact last deploy, follow the repo's deploy pipeline and the deploy-intent/confirm duty on git-deployments ([DEPLOY INTENT] before, [DEPLOY-CONFIRM] after with live-test evidence).
- VERIFY: 'loops list --json' rc=0 from station01 (literal output), /health 200, the frozen-check loop's probe verb returns rc=0, and the deployed service version is the fixed one. Run the real user-visible path (loops list) — focused tests support but never replace it.
- REVIEW (one Fable adversarial reviewer): (a) root cause named with evidence, (b) smallest owned fix, (c) loops list rc=0 measured at the end (not inferred), (d) no production-store in-place mutation, (e) deploy intent/confirm posted if a deploy happened, (f) secrets clean. Post '[REVIEW] <GO|NO_GO> — loops-503-fix @ <sha-or-deploy-ref> — lens: hosted /loops 503 remediation, reviewer loops-503-fix-review' to #board.
- LAND: on GO, land per the owning repo gates (PR + review + merge, or the deploy pipeline), record the merged sha or deploy ref, complete row 03f174ea with the evidence, post the outcome on #incidents in-thread on 717790.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on row 03f174ea and #board. English. Distinguish measured vs inferred; state what you did not check.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Classify the /loops 503 with server-side evidence: resolve the exact hosted deployment surface (repo deploy.yml / AGENTS.md / SSM manifest), read deploy state + recent deploys, probe the route-policy layer and DB connection health, check logs for the 503 on GET /loops. Name the root cause class. Return (JSON): { loopsListRcNow, rootCause, evidence: [string], deploySurface, currentDeployedVersion, notChecked: [string] }
`

const FIX = CONST + `
ROLE: fix lane (Opus). At the head after investigate: apply the smallest owned fix in the owning layer (code in apps/loops or the deployment surface). TDD where the fix is code (failing regression first). Deploy or PR per the owning pipeline. Do not touch version numbers unless the pipeline requires it. Return (JSON): { fixSummary, rootCause, landedAs: 'pr'|'deploy', prNumber, deployRef, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). After fix: 'loops list --json' rc=0 from station01 (literal output, first 300 bytes), /health 200 with the fixed version, the frozen-check probe verb rc=0, real user-visible path exercised. Return (JSON): { loopsListRc, loopsListOutput, healthOk, healthVersion, frozenCheckRc, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). One review: (a) root cause named with evidence (not guessed), (b) smallest owned fix, (c) loops list rc=0 MEASURED at the end (literal output), (d) no production-store in-place mutation, (e) deploy intent/confirm posted if a deploy happened, (f) secrets clean, (g) row evidence complete. Post '[REVIEW] <GO|NO_GO> — loops-503-fix @ <sha-or-deploy-ref> — lens: hosted /loops 503 remediation, reviewer loops-503-fix-review' to #board. Block ONLY concrete P0/P1 defects. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: land per owning gates (merge the PR with --body-file ending 'Agent: loops-503-fix-land', or confirm the deploy), record merged sha / deploy ref, complete row 03f174ea with evidence, post outcome on #incidents in-thread on 717790. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { landed, mergedSha, deployRef, rowState, incidentPosted, residue: [] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { loopsListRcNow: { type: 'number' }, rootCause: { type: 'string' }, evidence: { type: 'array' }, deploySurface: { type: 'string' }, currentDeployedVersion: { type: 'string' }, notChecked: { type: 'array' } }, required: ['loopsListRcNow', 'rootCause'] }
const FIX_SCHEMA = { type: 'object', properties: { fixSummary: { type: 'string' }, rootCause: { type: 'string' }, landedAs: { type: 'string' }, prNumber: { type: ['number', 'null'] }, deployRef: { type: ['string', 'null'] }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['fixSummary', 'landedAs'] }
const VERIFY_SCHEMA = { type: 'object', properties: { loopsListRc: { type: 'number' }, loopsListOutput: { type: 'string' }, healthOk: { type: 'boolean' }, healthVersion: { type: 'string' }, frozenCheckRc: { type: 'number' }, evidence: { type: 'string' } }, required: ['loopsListRc', 'healthOk'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { landed: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, deployRef: { type: ['string', 'null'] }, rowState: { type: 'string' }, incidentPosted: { type: 'boolean' }, residue: { type: 'array' } }, required: ['landed'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'loops-503-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
const fix = investigate && investigate.loopsListRcNow !== 0 ? await agent(FIX, { label: 'loops-503-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' }) : null

phase('Verify')
const verify = fix && fix.pushed ? await agent(VERIFY, { label: 'loops-503-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'loops-503-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'investigate/fix/verify did not complete or route already recovered', detail: JSON.stringify({ investigate, fix, verify }) }] }

phase('Land')
const land = review && review.verdict === 'GO'
  ? await agent(LAND, { label: 'loops-503-land', phase: 'Land', schema: LAND_SCHEMA })
  : { landed: false, mergedSha: null, deployRef: null, rowState: 'pending', incidentPosted: false, residue: ['NO_GO — fix lane must remediate per findings'] }

return { investigate: investigate && { rootCause: investigate.rootCause, loopsListRcNow: investigate.loopsListRcNow }, fix: fix && { fixSummary: fix.fixSummary, landedAs: fix.landedAs }, verify: verify && { loopsListRc: verify.loopsListRc, healthOk: verify.healthOk }, review: review && review.verdict, land }
