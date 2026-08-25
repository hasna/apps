export const meta = {
  name: 'audit642-rebase',
  description: 'Merge-completion continuation for hasna/apps#642 (packed-surface audit gate, row be6817f3): cycle-1 remediation GO at c8f0704c (one-line expected-string fix, CI 5/5, Fable GO) but the ship lane refused at the base-movement gate — origin/main moved 225 files past merge-base d20456352. This lane: rebase auditfix/be6817f3-packed-surface-audit onto current origin/main, CI 5/5 at the new head, scoped Fable re-review (rebase delta only), base gate, merge, complete be6817f3 — the loops 0.5.2 publish hold (714000) lifts when this lands',
  phases: [
    { title: 'Rebase', detail: 'rebase onto current origin/main; fix diff intact' },
    { title: 'Verify', detail: 'CI 5/5 at the new head' },
    { title: 'Review', detail: 'Fable scoped re-review of the rebase delta' },
    { title: 'Ship', detail: 'base gate, merge GO, complete be6817f3' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PR = 642
const ROW = 'be6817f3-a28a-4aa6-8f10-a996d8bbb6f5'

const CONST = `
You are a lane of the audit642-rebase workflow (2026-08-20). PR hasna/apps#${PR} (packed-surface audit gate) completed remediation cycle 1: head c8f0704c fixed the one-line release-contract.test.ts:39 expected-string, computers suite 245/0, two-sided audit probe rc=0, CI 5/5 green, Fable GO. The ship lane refused at the base-movement gate: origin/main (e935eb9d) moved 225 files past merge-base d20456352; merge-tree(main, head) != reviewed tree — UNREVIEWED AT HEAD. This lane completes the merge: rebase, CI, scoped re-review, base gate, merge, complete row ${ROW}. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work; the shared checkout is heavily dirty from other lanes — fetch refs and work from a worktree if the pull refuses). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/audit642-rb-<n>; work on the PR's OWN branch (auditfix/be6817f3-packed-surface-audit — gh pr view ${PR} --json headRefName, never guess). PR-first; never push to main. Commits end with 'Agent: audit642-rb-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check PR #${PR} comments — if a rebase already landed (head moved past c8f0704c), verify and record; do not duplicate.
- REBASE ONLY: rebase onto current origin/main. The remediation diff (the one-line expected-string change) must be byte-identical after the rebase; name any merge resolution and why. No scope creep.
- Verify: computers suite rc=0 at the new head ('bun test' — literal counts), two-sided probe 'bun run check:supply-chain:audit' from apps/loops rc=0 (literals), 'bun install --frozen-lockfile' rc=0, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on PR #${PR} and row ${ROW}, posts to #board. English. Lineage 'conversations agents register' named audit642-rb-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const REBASE = CONST + `
ROLE: rebase lane. Per the CONST: rebase onto current origin/main, prove the fix diff intact (git diff c8f0704c <new-head> -- apps/computers/tests/release-contract.test.ts shows NO content change from the rebase — or name what changed and why), computers suite rc=0 + audit probe rc=0 + frozen install rc=0 (literals), secrets scan, commit ('Agent: audit642-rb-<your-role>'), push --force-with-lease.
Return (JSON): { newHead: string, diffSummary: string, fixIntact: bool, suiteCounts: {passed, failed}, auditGateOk: string, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks ${PR}', re-run failed jobs (gh run rerun), poll bounded (max 20 min), require ALL FIVE checks GREEN at the new head (record the per-check table; build+test is the check under test). The known environmental playwright stall, if the ONLY failure, re-run once and record.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) — scoped re-review of the rebase delta only. Review: (a) new head = origin/main + the unchanged reviewed fix (the one-line expectation diff intact; any merge resolution named and justified), (b) computers suite + audit probe green at the new head, (c) 5/5 CI green (or ONLY the documented environmental stall), (d) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — audit642-rb @ <sha> — lens: rebase delta, reviewer audit642-rb-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge PR #${PR} (base-movement gate first — merge-tree against origin/main, verify the reviewed tree is what lands; gh pr merge --squash --body-file ending 'Agent: audit642-rb-ship'), record the merged sha, complete row ${ROW} with the unblock note (loops 0.5.2 publish hold 714000 lifts — the release lane can proceed). If NO_GO: comment findings + resume condition, leave in_progress.
Return (JSON): { merged: bool, mergedSha: string|null, rowState: string, residue: [string] }
`

const REBASE_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, diffSummary: { type: 'string' }, fixIntact: { type: 'boolean' }, suiteCounts: { type: 'object' }, auditGateOk: { type: 'string' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Rebase')
const rebase = await agent(REBASE, { label: 'audit642-rb-rebase', phase: 'Rebase', schema: REBASE_SCHEMA })

phase('Verify')
let verify = null
if (rebase && rebase.newHead) {
  verify = await agent(VERIFY, { label: 'audit642-rb-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'rebase did not complete', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW, { label: 'audit642-rb-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'rebase/verify did not complete', detail: JSON.stringify({ rebase, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'audit642-rb-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { rebase, verify, review, ship }
