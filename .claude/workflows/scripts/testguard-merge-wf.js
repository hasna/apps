export const meta = {
  name: 'testguard-merge',
  description: 'Merge-completion continuation for hasna/apps#630 (test-guard successor conformance, rows 48d4725e + 940070c4): cycle-1 remediation GO at 7cf978d6 (smoke s16 skip on absent fleet layout, CI 5/5, Fable GO) but the ship lane hit EIGHT consecutive base-movement refusals (~2.5h, 7 content-identical rebases). This lane: rebase testguard-s-1-conformance onto current origin/main, CI 5/5 at the new head, scoped Fable re-review, base gate, merge, complete both rows',
  phases: [
    { title: 'Rebase', detail: 'rebase onto current origin/main; smoke fix intact' },
    { title: 'Verify', detail: 'CI 5/5 at the new head' },
    { title: 'Review', detail: 'Fable scoped re-review of the rebase delta' },
    { title: 'Ship', detail: 'base gate, merge GO, complete 48d4725e + 940070c4' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PR = 630

const CONST = `
You are a lane of the testguard-merge workflow (2026-08-20). PR hasna/apps#${PR} (test-guard member conformance successor) completed its cycle-1 remediation: head 7cf978d6 makes the smoke skip the 8 s16 alert-classification assertions when the fleet install layout is absent (GitHub runner), keeping the full 13-check battery on guard-installed hosts; CI 5/5 green, Fable GO (one P2 informational). The ship lane then refused at the base-movement gate EIGHT consecutive times (~2.5h; origin/main advanced d98bdb702 -> ... -> a20dcf98f, each landing inside the ~14min publish-guard job; 7 content-identical rebases, PR-owned paths byte-identical at every head). This lane completes the merge: rebase once onto CURRENT origin/main, CI 5/5, scoped re-review, base gate, merge, complete rows 48d4725e + 940070c4. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work; shared checkout dirty from other lanes — fetch refs and work from a worktree if the pull refuses). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/testguard-m-<n>; work on the PR's OWN branch (testguard-s-1-conformance — gh pr view ${PR} --json headRefName, never guess). PR-first; never push to main. Commits end with 'Agent: testguard-m-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check PR #${PR} comments — if the merge already landed (state MERGED) or a rebase moved the head past 7cf978d6, verify and record; do not duplicate.
- REBASE ONLY: rebase onto current origin/main. The smoke fix (apps/test-guard/test/smoke.sh skip block) must be byte-identical after the rebase; name any merge resolution and why. No scope creep.
- Verify: 'bun run test:standard' rc=0, 'bun install --frozen-lockfile' rc=0, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on PR #${PR} and rows 48d4725e/940070c4, posts to #board. English. Lineage 'conversations agents register' named testguard-m-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const REBASE = CONST + `
ROLE: rebase lane. Per the CONST: rebase onto current origin/main, prove the smoke fix intact (git diff 7cf978d6 <new-head> -- apps/test-guard/test/smoke.sh shows NO content change — or name what changed and why), standard suite rc=0 + frozen install rc=0 (literals), secrets scan, commit ('Agent: testguard-m-<your-role>'), push --force-with-lease.
Return (JSON): { newHead: string, diffSummary: string, fixIntact: bool, standardOk: string, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks ${PR}', re-run failed jobs (gh run rerun), poll bounded (max 25 min — the publish-guard job is ~14min), require ALL FIVE checks GREEN at the new head (record the per-check table). If the base moves again mid-window, note it and report the resume condition rather than merging.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, baseStable: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) — scoped re-review of the rebase delta only. Review: (a) new head = origin/main + the unchanged smoke fix, (b) 5/5 CI green at the new head, (c) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — testguard-m @ <sha> — lens: rebase delta, reviewer testguard-m-review'. Block ONLY concrete P0/P1 defects.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet + baseStable: merge PR #${PR} IMMEDIATELY (base-movement gate first — merge-tree against origin/main; gh pr merge --squash --body-file ending 'Agent: testguard-m-ship'), record the merged sha, complete rows 48d4725e and 940070c4 with the evidence. If the base moved again: comment the resume condition, do not merge. If NO_GO: comment findings + resume condition, leave open.
Return (JSON): { merged: bool, mergedSha: string|null, rows: [{rowId, state}], residue: [string] }
`

const REBASE_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, diffSummary: { type: 'string' }, fixIntact: { type: 'boolean' }, standardOk: { type: 'string' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, baseStable: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rows: { type: 'array' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Rebase')
const rebase = await agent(REBASE, { label: 'testguard-m-rebase', phase: 'Rebase', schema: REBASE_SCHEMA })

phase('Verify')
let verify = null
if (rebase && rebase.newHead) {
  verify = await agent(VERIFY, { label: 'testguard-m-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'rebase did not complete', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW, { label: 'testguard-m-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'rebase/verify did not complete', detail: JSON.stringify({ rebase, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'testguard-m-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { rebase, verify, review, ship }
