export const meta = {
  name: 'audit642-rb2',
  description: 'Tight-merge continuation (testguard-merge pattern) for hasna/apps#642 (packed-surface audit gate, row be6817f3): GO at 54da18e0 (CI 5/5, Fable GO) but the base gate fired AGAIN — origin/main moved 695a46b3 mid-window. This lane: rebase onto the LATEST origin/main, CI 5/5, scoped re-review, base gate, MERGE IMMEDIATELY at the quiet window (baseStable check), complete be6817f3 — loops 0.5.2 publish hold (714000) lifts on merge',
  phases: [
    { title: 'Rebase', detail: 'rebase onto latest origin/main; fix diff intact' },
    { title: 'Verify', detail: 'CI 5/5 at the new head + base stability window' },
    { title: 'Review', detail: 'Fable scoped re-review (rebase delta)' },
    { title: 'Ship', detail: 'base gate, MERGE IMMEDIATELY, complete be6817f3' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PR = 642
const ROW = 'be6817f3-a28a-4aa6-8f10-a996d8bbb6f5'

const CONST = `
You are a lane of the audit642-rb2 workflow (2026-08-20) — the tight-merge continuation for PR hasna/apps#${PR} (packed-surface audit gate, row ${ROW}). History: fix GO at c8f0704c → rebase to 54da18e0 (CI 5/5, Fable GO) → base gate fired AGAIN (origin/main moved to 695a46b3 mid-window). THIS lane uses the testguard-merge discipline that finally merged #630 after 8 refusals: rebase onto the LATEST origin/main, CI 5/5 at the new head, scoped re-review, then MERGE IMMEDIATELY once the base is stable — do not wait for further windows. On merge only: loops 0.5.2 publish hold (todos 714000) lifts and the release lane re-runs its review + publish. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work; shared checkout dirty from other lanes — fetch refs and work from a worktree if the pull refuses). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/audit642-rb2-<n>; work on the PR's OWN branch (auditfix/be6817f3-packed-surface-audit — gh pr view ${PR} --json headRefName, never guess). PR-first; never push to main. Commits end with 'Agent: audit642-rb2-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check PR #${PR} comments — if the merge already landed (state MERGED) or a rebase moved the head past 54da18e0, verify and record; do not duplicate.
- REBASE ONLY: rebase onto the LATEST origin/main. The remediation diff (the one-line expected-string change) must be byte-identical after the rebase; name any merge resolution and why. No scope creep.
- Verify: computers suite rc=0 at the new head ('bun test' inside apps/computers — literal counts), two-sided probe 'bun run check:supply-chain:audit' from apps/loops rc=0 (literals), 'bun install --frozen-lockfile' rc=0, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on PR #${PR} and row ${ROW}, posts to #board. English. Lineage 'conversations agents register' named audit642-rb2-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const REBASE = CONST + `
ROLE: rebase lane. Per the CONST: rebase onto the LATEST origin/main, prove the fix diff intact (git diff 54da18e0 <new-head> -- apps/computers/tests/release-contract.test.ts shows NO content change — or name what changed and why), computers suite rc=0 + audit probe rc=0 + frozen install rc=0 (literals), secrets scan, commit ('Agent: audit642-rb2-<your-role>'), push --force-with-lease.
Return (JSON): { newHead: string, diffSummary: string, fixIntact: bool, suiteCounts: {passed, failed}, auditGateOk: string, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks ${PR}', re-run failed jobs (gh run rerun), poll bounded (max 25 min — publish-guard ~14min), require ALL FIVE checks GREEN at the new head. Record whether origin/main moved during the window (baseStable) — the ship lane merges immediately ONLY if the base held.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, baseStable: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) — scoped re-review of the rebase delta. Review: (a) new head = origin/main + the unchanged reviewed fix (the one-line expectation diff intact), (b) computers suite + audit probe green at the new head, (c) 5/5 CI green, (d) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — audit642-rb2 @ <sha> — lens: rebase delta, reviewer audit642-rb2-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet + baseStable: merge PR #${PR} IMMEDIATELY (base-movement gate first — merge-tree against origin/main; gh pr merge --squash --body-file ending 'Agent: audit642-rb2-ship'), record the merged sha, complete row ${ROW} with the unblock note (loops 0.5.2 publish hold 714000 lifts). If the base moved again: comment the resume condition, do not merge. If NO_GO: comment findings + resume condition, leave in_progress.
Return (JSON): { merged: bool, mergedSha: string|null, rowState: string, residue: [string] }
`

const REBASE_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, diffSummary: { type: 'string' }, fixIntact: { type: 'boolean' }, suiteCounts: { type: 'object' }, auditGateOk: { type: 'string' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, baseStable: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Rebase')
const rebase = await agent(REBASE, { label: 'audit642-rb2-rebase', phase: 'Rebase', schema: REBASE_SCHEMA })

phase('Verify')
let verify = null
if (rebase && rebase.newHead) {
  verify = await agent(VERIFY, { label: 'audit642-rb2-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'rebase did not complete', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW, { label: 'audit642-rb2-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'rebase/verify did not complete', detail: JSON.stringify({ rebase, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'audit642-rb2-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { rebase, verify, review, ship }
