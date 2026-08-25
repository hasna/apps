export const meta = {
  name: 'billing612-rebase',
  description: 'Merge-completion continuation for hasna/apps#612 (billing Sol-guided coverage): cycle-1 remediation GO at 2dc6a710b (exitCode P1 fixed, CI 5/5, Fable GO) but the ship lane correctly refused at the base-movement gate — main advanced 9e0b93fcc -> da9764f4 (#638 notes cloud-only bridge + #613 tooling bootstrap merged). This lane: rebase coverage-billing onto current origin/main, CI 5/5 at the new head, SCOPED Fable re-review (the rebase delta only — the reviewed fix diff must be intact), base gate, merge, complete',
  phases: [
    { title: 'Rebase', detail: 'rebase coverage-billing onto current origin/main; fix-diff intact' },
    { title: 'Verify', detail: 'CI runs exist; 5/5 green at the new head' },
    { title: 'Review', detail: 'Fable scoped re-review of the rebase delta' },
    { title: 'Ship', detail: 'base gate, merge GO, complete' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PR = 612

const CONST = `
You are a lane of the billing612-rebase workflow (2026-08-19). PR hasna/apps#${PR} (billing Sol-guided coverage suite) completed remediation cycle 1: head 2dc6a710b fixed the exitCode P1 (openapi-check stale-document assertions moved to a spawned child CLI), suite rc=0, prepack exit 0, 5/5 CI green, Fable GO. The ship lane then refused at the base-movement gate: CI merge-ref base 9e0b93fcc != origin/main da9764f4 (main advanced with #638 notes + #613 tooling bootstrap), and git merge-tree --write-tree origin/main <head> differed from the reviewed tree — UNREVIEWED AT HEAD. This lane completes the merge: rebase, CI, scoped re-review, base gate, merge. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/billing612-rb-<n>; work on the PR's OWN branch (coverage-billing — gh pr view ${PR} --json headRefName, never guess). PR-first; never push to main. Commits end with 'Agent: billing612-rb-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check PR #${PR} comments — if a rebase already landed (head moved past 2dc6a710b), verify and record; do not duplicate.
- REBASE ONLY: rebase coverage-billing onto current origin/main. DO NOT change the fix content — the remediation diff (apps/billing/test/cli.test.ts spawn-child assertions) must be byte-identical after the rebase; if the rebase surfaces conflicts in billing files, resolve keeping the reviewed behavior. No scope creep.
- Verify: billing suite rc=0 at the new head ('bun test' full run — literal), 'bun run prepack' exit 0, 'bun install --frozen-lockfile' rc=0, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on PR #${PR}, posts to #board. English. Lineage 'conversations agents register' named billing612-rb-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const REBASE = CONST + `
ROLE: rebase lane. Per the CONST: sync, rebase coverage-billing onto current origin/main, resolve any conflicts keeping the reviewed fix behavior, prove the fix diff intact (git diff 2dc6a710b <new-head> -- apps/billing/test/cli.test.ts shows NO content change from the rebase — or name what changed and why), suite rc=0 + prepack exit 0 (literals), secrets scan, commit ('Agent: billing612-rb-<your-role>'), push --force-with-lease.
Return (JSON): { newHead: string, diffSummary: string, fixIntact: bool, suiteCounts: {passed, failed}, prepackOk: bool, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks ${PR}', re-run failed jobs (gh run rerun), poll bounded (max 20 min), require ALL FIVE checks GREEN at the new head (record the per-check table; build+test and publish guard are the two the original P1 broke). The known environmental playwright stall, if the ONLY failure, re-run once and record.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) — scoped re-review of the rebase delta only. Review: (a) the new head is origin/main + the unchanged reviewed fix (the cli.test.ts spawn-child diff intact; any additional merge resolution named and justified), (b) suite rc=0 + prepack exit 0 at the new head, (c) 5/5 CI green (or ONLY the documented environmental stall), (d) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — billing612-rb @ <sha> — lens: rebase delta, reviewer billing612-rb-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge PR #${PR} (base-movement gate first — merge-tree against origin/main, verify the reviewed tree is what lands; gh pr merge --squash --body-file ending 'Agent: billing612-rb-ship'), record the merged sha. If NO_GO: comment findings + resume condition, leave open.
Return (JSON): { merged: bool, mergedSha: string|null, residue: [string] }
`

const REBASE_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, diffSummary: { type: 'string' }, fixIntact: { type: 'boolean' }, suiteCounts: { type: 'object' }, prepackOk: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, residue: { type: 'array' } }, required: ['merged'] }

phase('Rebase')
const rebase = await agent(REBASE, { label: 'billing612-rb-rebase', phase: 'Rebase', schema: REBASE_SCHEMA })

phase('Verify')
let verify = null
if (rebase && rebase.newHead) {
  verify = await agent(VERIFY, { label: 'billing612-rb-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'rebase did not complete', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW, { label: 'billing612-rb-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'rebase/verify did not complete', detail: JSON.stringify({ rebase, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'billing612-rb-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { rebase, verify, review, ship }
