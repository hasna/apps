export const meta = {
  name: 'session-inject-land',
  description: 'Task-drain dispatch (2026-08-19): land the unified session-inject-monitor into hasna-internal/fleet-resources per the Fable verdict (rows b4b3e7ed + 996bf5bc). One implement lane (Side A canonical set + strong-readback graft, per-station duplication station01/02, supersede legacy B copies; A3 fail-closed cursor restore covering intermediate exits), verify, Fable review, ship, hydrate live homes, complete both rows',
  phases: [
    { title: 'Implement', detail: 'fleet-resources worktree: portable set + readback graft + A3 cursor-restore; PR referencing both rows' },
    { title: 'Verify', detail: 'CI + gate script two-sided checks (cursor restore covers intermediate exits; known-positive/known-negative)' },
    { title: 'Review', detail: 'Fable adversarial review (bounded, two cycles max)' },
    { title: 'Ship', detail: 'merge GO, hydrate live homes station01/02, complete both rows' },
  ],
}

const REPO = '/home/hasna/workspace/repos/hasna-internal/fleet-resources'
const ROW_MAIN = 'b4b3e7ed-f831-49a4-805b-1bde4f7fc283'
const ROW_A3 = '996bf5bc-4da6-4d51-872c-eb8b64eef0b1'

const CONST = `
You are a lane of the session-inject-land workflow (2026-08-19, task-drain dispatch). Two unowned rows, one program: land the unified session-inject-monitor into ${REPO} per the Fable verdict 2026-08-19. Final text = machine-readable JSON.

The packet (row ${ROW_MAIN}): Side A canonical base + mandatory strong-readback graft (error-rejecting jq discriminator); focused re-review VERDICT GO (lane3/re-review). Execution: place the fixed portable set (SKILL.md + scripts/ + references/, NO .hasna-skills.json) under resources/station01/skills/agent-homes/opencode/session-inject-monitor/ AND resources/station02/skills/agent-homes/opencode/session-inject-monitor/ (per-station duplication required; the repo is a snapshot/mirror, hydration is operator-run). Then reproduce to LIVE homes on both stations (installed/ render source + the .agents gap on station01) and supersede the legacy single-file B copies. Row ${ROW_A3} (A3): in hasna-session-inject-gate.sh the fail-closed cursor snapshot+restore covers the inject failure path; extend it to cover exits between the reader pass and inject (validation/summary-assembly errors) — ANY exit before confirmed delivery must restore cursors so undelivered content re-fires next firing. Reference: /tmp/opencode/skill-unify/re-review-verdict.md.

Non-negotiable rules (all agents):
- ${REPO} is READ/context only. Sync first (git -C ${REPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/fleet-resources/simland-<n> from origin/main. PR-first; never push to main. Commits end with 'Agent: simland-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check both rows' comments + open PRs on fleet-resources touching session-inject-monitor — if the land already happened (PR merged, homes hydrated), verify and record; do not duplicate.
- THE LAND: the portable set per the packet (SKILL.md + scripts/ + references/, NO .hasna-skills.json), per-station duplication under resources/station01/... AND resources/station02/..., supersede the legacy single-file B copies (record what they were and where). The A3 extension lands in the SAME unified skill's gate script. TDD where testable: the A3 cursor-restore regression (a fixture that exits between reader and inject must restore cursors; positive control: a clean inject leaves them advanced).
- HYDRA TION of live homes on station01/station02: per the packet (installed/ render source + the .agents gap on station01; supersede legacy B copies). It is authorized by the packet; run it AFTER the PR merges, from the merged state. If a station is unreachable, record the exact resume condition.
- No secrets: never print/capture/commit credential values; staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on both rows, posts to #board. English. Lineage 'conversations agents register' named simland-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const IMPLEMENT = CONST + `
ROLE: implement lane. Per the CONST: the unified land (both rows) in one PR referencing ${ROW_MAIN} + ${ROW_A3}; TDD the A3 cursor-restore regression first (red proven), the strong-readback graft per the verdict, per-station duplication, legacy B copies superseded; suites/gate checks green (record counts), secrets scan, commit ('Agent: simland-<your-role>'), push, PR.
Return (JSON): { prNumber: number, diffSummary: string, a3Regression: string, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI on the PR ({PR}) — 'gh pr checks', re-run failed jobs, poll bounded (max 15 min), all green at the new head (record the per-check table). The A3 gate script two-sided probes: (a) a fixture exiting between reader and inject restores cursors (pass), (b) a clean inject advances cursors (pass), (c) known-negative input is rejected by the readback discriminator. Record the literal outputs.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, a3RestoreOk: bool, discriminatorOk: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PR ({PR}): (a) the land matches the packet (portable set, no .hasna-skills.json, per-station duplication, B copies superseded with record), (b) A3 regression fails-before/passes-after, (c) CI green, (d) secrets clean, PR-first, no scope creep. Post '[REVIEW] <GO|NO_GO> — session-inject-land @ <sha> — lens: unified skill land + A3, reviewer simland-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge the PR (base-movement gate first; gh pr merge --squash --body-file ending 'Agent: simland-ship'), record the merged sha, HYDRA TE the live homes on station01/station02 from the merged state per the packet (record the literal per-station evidence; unreachable stations get a resume condition), complete both rows (${ROW_MAIN}, ${ROW_A3}) with the evidence. If NO_GO: comment findings + resume condition, leave both in_progress.
Return (JSON): { merged: bool, mergedSha: string|null, hydration: [{station, ok, evidence}], rows: [{rowId, state}], residue: [string] }
`

const IMPL_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, diffSummary: { type: 'string' }, a3Regression: { type: 'string' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['prNumber', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, a3RestoreOk: { type: 'boolean' }, discriminatorOk: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, hydration: { type: 'array' }, rows: { type: 'array' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Implement')
const implement = await agent(IMPLEMENT, { label: 'simland-implement', phase: 'Implement', schema: IMPL_SCHEMA })

phase('Verify')
let verify = null
if (implement && implement.prNumber) {
  verify = await agent(VERIFY.replace('{PR}', String(implement.prNumber)), { label: 'simland-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'implement did not open a PR', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW.replace('{PR}', String(implement.prNumber)), { label: 'simland-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'implement/verify did not complete', detail: JSON.stringify({ implement, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'simland-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { implement, verify, review, ship }
