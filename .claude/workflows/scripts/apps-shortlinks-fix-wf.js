export const meta = {
  name: 'apps-shortlinks-fix',
  description: 'Row b03cc058 (owner directive 2026-08-20 drain): @hasna/shortlinks CLI returns signed destination URLs (uncontrolled composite) into output/transcripts — the capability-bearing-output class. This lane: TDD regression (no signed URL in CLI output), fix the projection in apps/shortlinks, PR + CI, Fable review, merge, complete row. The fleet-side scanner-gap half is owned by the fleet investigation (incident 716957) — NOT this lane.',
  phases: [
    { title: 'Fix', detail: 'repro + TDD red + smallest fix + PR' },
    { title: 'Review', detail: 'Fable adversarial review' },
    { title: 'Ship', detail: 'base gate + merge + complete row' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PROJ = '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'

const CONST = `
You are the apps-shortlinks-fix lane (owner-authorized, row b03cc058: "BUG: @hasna/shortlinks — CLI returns signed destination URLs (uncontrolled composite) into output/transcripts"). Final text = machine-readable JSON.

Non-negotiable rules:
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} fetch origin && git -C ${MONOREPO} pull --ff-only; never discard local work). File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/apps-shortlinks-fix cut from origin/main. NEW BRANCH fix/shortlinks-projection; PR-first; never push to main. Commits end with 'Agent: apps-shortlinks-fix-<role>' (the ONLY attribution line; never Co-Authored-By).
- IDEMPOTENCY CHECK FIRST: search for an existing open PR fixing this (gh pr list --repo hasna/apps --search 'shortlinks' + 'signed' + 'b03cc058') and read the row comments. If a live fix exists, verify and record; do NOT duplicate.
- Reproduce first: run the shortlinks CLI verb that emits the signed destination URL (find it from the row's evidence), capture the output to a file, confirm the signed URL shape (a capability-bearing URL — describe its shape/prefix/expiry, NEVER paste a live signed URL into any comment, post, or result). Write the failing regression test first (red, measured): the CLI output must not contain a signed capability URL for the destination.
- Smallest owned fix: project the capability — the CLI returns the plain (unsigned) destination reference or a store id the consumer resolves, per the capability-bearing-output doctrine; do NOT widen to unrelated surfaces.
- Verify: package suite green (literal counts), 'bun install --frozen-lockfile' rc=0 in the worktree, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push, changeset (patch) .changeset/shortlinks-projection.md, CI green at the head sha.
- The version wave PR hasna/apps#670 may be open and rebasing concurrently; if the wave lands while you work, rebase your branch onto the new origin/main and re-verify (base-movement gate at merge: <merge-ref>^{tree} == <head>^{tree} at CURRENT origin/main).
- No secrets: never print/capture/commit credential values; never paste a live signed URL. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the PR and row b03cc058, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is ${PROJ}.
`

const FIX = CONST + `
ROLE: fix lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Reproduce (literal evidence, signed URL shape only), failing regression test first (red), smallest owned projection fix, suite green, frozen install rc=0, secrets clean, changeset patch, commit ('Agent: apps-shortlinks-fix-fix'), push, open the PR referencing row b03cc058.
Return (JSON): { prNumber, diffSummary, redBefore: {failed, named}, suiteCounts: {passed, failed}, secretsClean, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PR (number in the fix result): (a) the regression test reproduces the leak and the fix passes it (red-before/green-after measured), (b) the fix projects the capability (no signed URL in CLI output) without breaking the resolved-destination surface, (c) smallest owned change, (d) no test weakening, (e) scope is apps/shortlinks only, (f) CI green at the head sha, (g) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — apps-shortlinks-fix @ <sha> — lens: capability projection, reviewer apps-shortlinks-fix-review' to #board. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship lane. If GO: base-movement gate first (git merge-tree against CURRENT origin/main; after any rebase <merge-ref>^{tree} == <head>^{tree} must hold), then gh pr merge --squash --body-file ending 'Agent: apps-shortlinks-fix-ship', record the merged sha, complete row b03cc058 with the evidence (merged sha, suite counts, review verdict). If NO_GO: comment findings + resume condition, leave open, row stays pending.
Return (JSON): { merged, mergedSha, rowState, residue: [] }
`

const FIX_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, diffSummary: { type: 'string' }, redBefore: { type: 'object' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['prNumber', 'diffSummary'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Fix')
const fix = await agent(FIX, { label: 'shortlinks-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' })

phase('Review')
const review = fix && fix.prNumber
  ? await agent(REVIEW, { label: 'shortlinks-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'fix did not open a PR', detail: JSON.stringify(fix) }] }

phase('Ship')
const ship = review && review.verdict === 'GO'
  ? await agent(SHIP, { label: 'shortlinks-ship', phase: 'Ship', schema: SHIP_SCHEMA })
  : { merged: false, mergedSha: null, rowState: 'pending', residue: ['NO_GO — fix lane must remediate per findings'] }

return { fix: fix && { prNumber: fix.prNumber }, review: review && review.verdict, ship }
