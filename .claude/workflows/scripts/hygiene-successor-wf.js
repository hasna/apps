export const meta = {
  name: 'hygiene-successor',
  description: 'Adjudicated ONE successor for the terminated hygiene PR hasna/apps#615 (row 529e2ee5, bounded-review cap: NO_GO b377fb9f -> bf6cb5b4 -> 87ea38d5). The successor is a materially new candidate: the tests-only hygiene corpus (evals redaction sentinels, access secret-boundary, attachments + crawl test files) with the named test-file fixes — crawl webhooks.test.ts FK-setup (missing parent webhooks row), crawler.test.ts mapSite mock propagation (homepage-down must return []), cycle-2 billing test fix + TS2352 casts retained. New branch + new PR, own review cycles (max 2), 5/5 CI, merge, complete row',
  phases: [
    { title: 'Build', detail: 'new branch from origin/main: hygiene test corpus + the two crawl fixes + retained cycle-2 fixes' },
    { title: 'Verify', detail: '5/5 CI green at the new head' },
    { title: 'Review', detail: 'Fable adversarial review (cycle 1 of the successor)' },
    { title: 'Ship', detail: 'merge GO, complete 529e2ee5; NO_GO stops the lineage' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '529e2ee5-5d14-47e8-a994-14702fedb528'

const CONST = `
You are a lane of the hygiene-successor workflow (2026-08-19). PR hasna/apps#615 (tests-only hygiene, row ${ROW}) TERMINATED at its two-cycle cap (bounded-review policy: initial NO_GO @ b377fb9f, cycle-1 NO_GO @ bf6cb5b4, cycle-2 final NOT-met @ 87ea38d5). THIS IS THE LINEAGE'S SINGLE ADJUDICATED SUCCESSOR — a materially new candidate with its own review cycles (max 2); a NO_GO here stops the lineage. Final text = machine-readable JSON.

The successor candidate: the tests-only hygiene corpus from the terminated branch (drain4-hygiene @ 87ea38d5) as the base content — evals redaction sentinels (non-matching fragments), access secret-boundary tests, attachments test files, crawl test files, billing tests — WITH the named fixes:
(1) apps/crawl/src/lib/webhooks.test.ts:82 — test setup inserts a webhook_deliveries row whose webhook_id 'missing-webhook' has no parent webhooks row; the FK rejects the INSERT so the test never reaches its assertion. Fix the SETUP (insert the parent row or use a factory that satisfies the FK) — the test's intent ('deliverWebhook returns false when the webhook does not exist') must still be exercised.
(2) apps/crawl/src/lib/crawler.test.ts:359 — mock server 'homepage down' for non-sitemap paths; mapSite propagates the error instead of returning [] (assertion expect(urls).toEqual([]) receives a thrown error). Fix per the intended contract (unreachable homepage -> sitemap entries [] — or if the app's real contract is error-propagation, the TEST is wrong and must assert the real contract; measure the source's actual behavior at origin/main and assert THAT, with the smallest owned change).
(3) RETAIN cycle-2 fixes: the 6 'as unknown as Record<string, unknown>' casts in apps/evals/src/core/redaction.test.ts (build green), the billing test fixes (events-edge seeds stripe_invoice_id via insertInvoice; reconciliation tenant-isolation test deferred — do NOT re-add it; the deferred source edit rides drain4-hygiene-source separately).
The candidate is tests-only (all changes *.test.ts) — app source is NOT modified.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/hygiene-s-<n> from origin/main. NEW BRANCH hygiene-successor (the terminated branch stays as the record); PR-first; never push to main. Commits end with 'Agent: hygiene-s-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check row ${ROW} comments + open PRs — if a successor already landed (PR open/merged carrying the hygiene corpus), verify and record; do not duplicate.
- Verify: 'bun install --frozen-lockfile' rc=0, affected suites green (record counts: evals redaction, access secret-boundary, crawl webhooks + crawler, billing prepack exit 0), secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. The known machine-local port-collision fails in evals (ports held by mementos-serve daemons) are pre-existing and absent on CI — record, do not chase.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on ${ROW} and the new PR, posts to #board. English. Lineage 'conversations agents register' named hygiene-s-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const BUILD = CONST + `
ROLE: build lane. Per the CONST: new branch hygiene-successor from origin/main; apply the hygiene test corpus from drain4-hygiene @ 87ea38d5 (git cherry-pick or copy the test-file diff — verify the diff is tests-only), then the two crawl fixes + retained cycle-2 fixes; affected suites green (record counts incl. billing prepack exit 0), secrets scan, commit ('Agent: hygiene-s-<your-role>'), push, open the PR referencing ${ROW}.
Return (JSON): { prNumber: number, diffSummary: string, crawlFixes: [{file, fix}], suiteCounts: {passed, failed}, prepackOk: bool, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks' on the PR ({PR}), re-run failed jobs (gh run rerun), poll bounded (max 20 min), require ALL FIVE checks GREEN at the new head (record the per-check table; build+test and publish guard are the two that failed the terminated candidate). The known environmental playwright stall, if the ONLY failure, re-run once and record.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) — cycle 1 of the successor candidate. Review: (a) the candidate is tests-only (no app-source changes), (b) the two crawl fixes assert the real contract (measured, not guessed) and the FK-setup fix exercises the intended assertion, (c) cycle-2 fixes retained (TS2352 casts, billing test fix, no re-added deferred test), (d) 5/5 CI green at the new head (or ONLY the documented environmental stall), (e) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — hygiene-successor @ <sha> — lens: successor cycle 1, reviewer hygiene-s-review'. Block ONLY concrete P0/P1 defects; two cycles max — a NO_GO stops the lineage.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge the PR (base-movement gate first — merge-tree against origin/main; gh pr merge --squash --body-file ending 'Agent: hygiene-s-ship'), record the merged sha, complete row ${ROW} with the evidence. If NO_GO: comment findings + resume condition, leave in_progress — the lineage stops as an engineering blocker; record that.
Return (JSON): { merged: bool, mergedSha: string|null, rowState: string, residue: [string] }
`

const BUILD_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, diffSummary: { type: 'string' }, crawlFixes: { type: 'array' }, suiteCounts: { type: 'object' }, prepackOk: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['prNumber', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Build')
const build = await agent(BUILD, { label: 'hygiene-s-build', phase: 'Build', schema: BUILD_SCHEMA })

phase('Verify')
let verify = null
if (build && build.prNumber) {
  verify = await agent(VERIFY.replace('{PR}', String(build.prNumber)), { label: 'hygiene-s-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'build did not open a PR', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW, { label: 'hygiene-s-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'build/verify did not complete', detail: JSON.stringify({ build, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'hygiene-s-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { build, verify, review, ship }
