export const meta = {
  name: 'subscriptions-migration-ledger-fix',
  description: 'Owner directive 2026-08-20 (deploy subscriptions): the 0.2.46 ECS deploy is blocked on the migration step — PR #358 (accounts->subscriptions rename) changed the applied-migration ledger IDs (accounts_* -> subscriptions_*), so the migration container cannot see which migrations are applied (row 0ec39e58, filed by the deploy lane with the full diagnosis). This lane: restore the applied migration IDs in apps/subscriptions at hasna-internal/internal-apps origin/main (keep 0008_auth_status as the only new ID per the deploy lane resume condition), PR-first, Fable review, merge, post the deploy-rerun resume line.',
  phases: [
    { title: 'Fix', detail: 'restore applied migration IDs -> PR + CI' },
    { title: 'Review', detail: 'Fable adversarial review' },
    { title: 'Ship', detail: 'base gate + merge + deploy resume line' },
  ],
}

const CONST = `
You are the subscriptions-migration-ledger-fix lane (owner-authorized, unblocks the subscriptions@0.2.46 ECS deploy). Final text = machine-readable JSON.

Context (measured by the deploy lane, wf_5b3b7b44-0dd): accounts.hasna.xyz is LIVE at 0.2.45. The 0.2.46 deploy stops at the migration container: PR #358 (2d265dd2, accounts->subscriptions rename) changed the applied-migration ledger IDs from accounts_* to subscriptions_*, so the migration ledger no longer matches what is applied in the shared RDS (accounts_0001_accounts .. accounts_0007_alias_records + 0005a were applied under the OLD IDs). Resume condition (verbatim from the deploy lane): 'restore applied migration IDs accounts_0001_accounts..accounts_0007_alias_records + 0005a in the shipped set, keep 0008_auth_status as the only new ID'. Row 0ec39e58 carries the filed diagnosis — read it first.

Non-negotiable rules:
- /home/hasna/workspace/repos/hasna-internal/internal-apps is READ/context only. Sync first (git -C <checkout> fetch origin main -q; never discard local work). File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/internal-apps/subscriptions-migration-ledger-fix cut from origin/main. NEW BRANCH fix/subscriptions-migration-ledger; PR-first; never push to main. Commits end with 'Agent: subscriptions-migration-ledger-fix-<role>' (the ONLY attribution line; never Co-Authored-By).
- IDEMPOTENCY CHECK FIRST: search for an existing open PR fixing this (gh pr list --repo hasna-internal/internal-apps --search 'migration ledger' + 'subscriptions' + '0ec39e58'), and read row 0ec39e58 + the deploy lane's comments. If a live fix exists, verify and record; do NOT duplicate.
- The fix is in apps/subscriptions (migrations + the applied-ID registry the server reads): restore the pre-rename applied IDs for migrations already applied in production (accounts_0001_accounts .. accounts_0007_alias_records, 0005a), keep 0008_auth_status as the only genuinely new ID. Do NOT re-run destructive migrations; do NOT touch production data — the PR only fixes the source ledger. Read the exact applied-ID mechanism from the app source (server/migrations.ts or the migration runner) and the PR #358 rename diff before editing.
- TDD where applicable (a regression test asserting the applied-ID set matches the pre-rename production set); package suite green (literal counts, exit 0 measured unpiped); 'bun install --frozen-lockfile' rc=0 in the worktree; secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push; changeset (patch) .changeset/subscriptions-migration-ledger.md.
- No secrets: never print/capture/commit credential values; no internal-infra strings beyond what the app already carries. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on the PR and row 0ec39e58. English. Distinguish measured vs inferred; state what you did not check.
`

const FIX = CONST + `
ROLE: fix lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Read row 0ec39e58 + the deploy lane comments + PR #358 diff; restore the applied migration IDs in apps/subscriptions (per the resume condition); regression test for the applied-ID set; suite green; frozen install rc=0; secrets scan clean; changeset patch; commit ('Agent: subscriptions-migration-ledger-fix-fix'); push; open the PR referencing row 0ec39e58 and the deploy resume condition.
Return (JSON): { prNumber, diffSummary, redBefore: {failed, named}, suiteCounts: {passed, failed}, secretsClean, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PR (number in the fix result): (a) the applied-ID restore matches the resume condition exactly (accounts_0001_accounts..accounts_0007_alias_records + 0005a restored; 0008_auth_status the only new ID), (b) no destructive migration re-run, no production-data touch, (c) the regression test pins the applied-ID set, (d) smallest owned change, (e) CI green at the head sha, (f) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — subscriptions-migration-ledger @ <sha> — lens: migration ledger restore, reviewer subscriptions-migration-ledger-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship lane. If GO: base-movement gate first (git merge-tree against CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree} must hold after any rebase), then gh pr merge --squash --body-file ending 'Agent: subscriptions-migration-ledger-fix-ship', record the merged sha, comment row 0ec39e58 + row c82297eb with the deploy resume line: 'migration-ledger fix merged (<sha>) — rerun bash /tmp/deploy-one.sh subscriptions 0.2.46 internal-apps (SSM manifest + taskdefs accounts-prod:9 / accounts-prod-migrate:7 staged; keep the HASNA_SUBSCRIPTIONS_* env rename), verify 0.2.46 on accounts.hasna.xyz, [DEPLOY-CONFIRM] in-thread 716872'. If NO_GO: comment findings + resume condition, leave open.
Return (JSON): { merged, mergedSha, deployResumePosted, residue: [] }
`

const FIX_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, diffSummary: { type: 'string' }, redBefore: { type: 'object' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['prNumber', 'diffSummary'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, deployResumePosted: { type: 'boolean' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Fix')
const fix = await agent(FIX, { label: 'subscriptions-migration-ledger-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' })

phase('Review')
const review = fix && fix.prNumber
  ? await agent(REVIEW, { label: 'subscriptions-migration-ledger-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'fix did not open a PR', detail: JSON.stringify(fix) }] }

phase('Ship')
const ship = review && review.verdict === 'GO'
  ? await agent(SHIP, { label: 'subscriptions-migration-ledger-ship', phase: 'Ship', schema: SHIP_SCHEMA })
  : { merged: false, mergedSha: null, deployResumePosted: false, residue: ['NO_GO — fix lane must remediate per findings'] }

return { prNumber: fix && fix.prNumber, diffSummary: fix && fix.diffSummary, review: review && review.verdict, ship }
