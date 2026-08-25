export const meta = {
  name: 'host-env-remediate',
  description: 'Remediation cycle 1 for hasna/apps#597 (host-env fix, Fable NO_GO): the new cold-launch regression fails on CI because the runner has no global secrets CLI — set HASNA_SECRETS_CLI=<dist/index.js> in the test beforeAll env when present; re-run CI; re-verify cold-launch; Fable re-review; merge; then station03 re-registration handoff',
  phases: [
    { title: 'Remediate', detail: 'one-line test-env fix on the PR branch, push' },
    { title: 'Verify', detail: 'CI build+test green at the new head + cold-launch acceptance re-run' },
    { title: 'Review', detail: 'Fable re-review (cycle 1, same reviewer standard)' },
    { title: 'Ship', detail: 'merge GO + station03 install-host re-registration handoff' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PR = 597

const CONST = `
You are a lane of the host-env-remediate workflow (2026-08-19). PR hasna/apps#${PR} (host-env-fix/host-env-1 @ a3f4f411) fixes the secrets Chrome extension native host env resolution (absolute node shebang + embedded secrets CLI path). Fable NO_GO with the exact remediation: the new regression 'installed host cold launch (Chrome path resolution)' spawnSyncs install-host.sh and fails on CI (rc=1, host-protocol.test.ts:326) because the runner has NO global secrets CLI and no HASNA_SECRETS_CLI — while install-host.sh and resolveSecretsBin both HONOR HASNA_SECRETS_CLI. Fix: in the test's beforeAll spawnSync env, when apps/secrets/dist/index.js exists (or always), pass HASNA_SECRETS_CLI=<dist/index.js> (or the resolved repo build). Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/host-env-remediate-<n>; work on the PR's OWN branch (host-env-fix/host-env-1 — never guess; push --force-with-lease only on that branch). PR-first; never push to main. Commits end with 'Agent: host-env-remediate-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check PR #${PR} comments — if the remediation already landed (head moved past a3f4f411), verify and record; do not duplicate.
- REMEDIATE ONLY THE NAMED DEFECT: the test-env wiring. Do not change install-host.sh, host.cjs, or any other behavior — the fix itself is verified correct (cold-launch acceptance passed locally).
- Verify: 'bun test' the extension suite at the new head (record counts), then drive CI: 'gh pr checks ${PR}' — re-run the failed build+test job, require it GREEN (or record the exact failure); re-run the cold-launch acceptance (env -i HOME-only wire frame) at the new head.
- No secrets: never print/capture/commit credential values; staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on PR #${PR}, posts to #board. English. Lineage 'conversations agents register' named host-env-remediate-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const REMEDIATE = CONST + `
ROLE: remediate lane. Per the CONST: apply the one-line test-env fix (host-protocol.test.ts beforeAll: HASNA_SECRETS_CLI env pointing at the repo build when present), run the extension suite locally (bounded 8 min, record counts), secrets scan, commit ('Agent: host-env-remediate-<your-role>'), push --force-with-lease to host-env-fix/host-env-1.
Return (JSON): { newHead: string, diffSummary: string, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks ${PR}', re-run the failed build+test job (gh run rerun), poll bounded (max 15 min), require 'build + test (affected)' GREEN at the new head (record the per-check table). Re-run the cold-launch acceptance at the new head: HOME=<tmp> install-host.sh into a temp dir, execve the installed host with env={HOME} only + the auth-status wire frame -> {ok:true,...}; record the literal response.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, coldLaunchOk: bool, protocolResponse: string, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) — cycle 1 on the SAME PR. Review: (a) the remediation is the named test-env fix ONLY (no behavior changes to install-host.sh/host.cjs), (b) CI build+test is green at the new head, (c) the cold-launch acceptance still passes at the new head, (d) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — host-env-remediate @ <sha> — lens: cycle-1 remediation, reviewer host-env-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge PR #${PR} (base-movement gate first; gh pr merge --squash --body-file ending 'Agent: host-env-remediate-ship'), record the merged sha, post to #board: host-env fix merged — station03 handoff: after syncing the checkout past the merge, re-run install-host.sh on station03, then the owner reloads the extension (Load unpacked from the SecretsVault v2 folder) + fully restarts Chrome. If NO_GO: comment findings + resume condition, leave open.
Return (JSON): { merged: bool, mergedSha: string|null, station03Handoff: string, taskState: string, residue: [string] }
`

const REM_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, diffSummary: { type: 'string' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, coldLaunchOk: { type: 'boolean' }, protocolResponse: { type: 'string' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, station03Handoff: { type: 'string' }, taskState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Remediate')
const remediate = await agent(REMEDIATE, { label: 'host-env-remediate-fix', phase: 'Remediate', schema: REM_SCHEMA })

phase('Verify')
let verify = null
if (remediate && remediate.newHead) {
  verify = await agent(VERIFY, { label: 'host-env-remediate-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'remediation did not complete', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW, { label: 'host-env-remediate-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P0', title: 'remediate/verify did not complete', detail: JSON.stringify({ remediate, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'host-env-remediate-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { remediate, verify, review, ship }
