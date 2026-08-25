export const meta = {
  name: 'catalog-scaffold-fix',
  description: 'Owned repair on main for the hasna/apps catalog scaffold defects (BUG b87f5915, exposed by hygiene-corpus PR #644): 9 failing assertions — src/version.ts hardcodes VERSION 0.1.0 vs package.json 0.2.0 (version.test.ts:22/31/38/47, cli.test.ts:196), paths.ts blank/whitespace env not normalized (paths.test.ts:56/67), ingest.ts shared eventTypes allowlist mutated (ingest.test.ts:107), server.ts leaks raw store internals in 500s (server.test.ts:123). TDD: port the corpus\'s apps/catalog tests onto main (red), fix the source (green), 5/5 CI, Fable review, merge. PR #644 lineage is STOPPED as an engineering blocker per bounded-review policy — this lane is the owning repair only; it does NOT revive the #644 lineage',
  phases: [
    { title: 'Fix', detail: 'port catalog tests onto main (red), fix scaffold source (green), PR' },
    { title: 'Verify', detail: 'CI 5/5 at the new head' },
    { title: 'Review', detail: 'Fable adversarial review' },
    { title: 'Ship', detail: 'base gate, merge, record on b87f5915 + #644/529e2ee5' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const BUGROW = 'b87f5915-f443-4294-9574-367567ce4c13'
const CORPUS_SHA = '17aea4881df61a200d70ac50cca9677b78b968b2' // hygiene-corpus PR #644 head carrying the failing catalog tests

const CONST = `
You are a lane of the catalog-scaffold-fix workflow (2026-08-20) — the owned repair on main for hasna/apps apps/catalog scaffold defects (BUG row ${BUGROW}). Origin: hygiene-corpus PR hasna/apps#644 (tests-only, 182 files) exposed 9 pre-existing main-side defects in apps/catalog — apps/catalog source is byte-identical between the corpus's heads and origin/main (verified; main's own CI cannot see the failures because catalog is only affected when its files change). The corpus's catalog tests pin the CORRECT contracts; the scaffold is defective. Final text = machine-readable JSON.

The 9 failing assertions (measured at corpus head ${CORPUS_SHA}, CI run 32323127737 + local repro): version.test.ts:22/31/38/47 (Expected "0.2.0" Received "0.1.0" — src/version.ts hardcodes VERSION 0.1.0 from scaffold commit 1332911e4, package.json is 0.2.0 since main PR #473), cli.test.ts:196 (hardcoded 0.2.0 vs 0.1.0), paths.test.ts:56/67 (blank env returns "" instead of the default; whitespace untrimmed), ingest.test.ts:107 (push to the shared eventTypes allowlist does not throw), server.test.ts:123 ("secret internal detail" propagates raw instead of a bounded JSON 500).

THE FIX (TDD, on main): (1) bring apps/catalog/tests from the corpus head into a NEW branch off origin/main (git show ${CORPUS_SHA}:apps/catalog/tests/<file> — the tests ARE the regression; do NOT rewrite them to match the defective scaffold), red on main; (2) smallest owned source fixes: src/version.ts VERSION -> 0.2.0 matching package.json; src/paths.ts blank/whitespace env normalization to the default; src/ingest.ts copy-guard the shared eventTypes allowlist so callers cannot mutate it; src/server.ts bounded JSON 500 error containment (no raw internals); (3) full apps/catalog suite green (210 pass/0 fail expected), frozen install rc=0, secrets scan, changeset (patch), commit, push, open the PR referencing BUG ${BUGROW} and PR #644's resume condition. Scope is apps/catalog ONLY — no other app, no corpus files, no version bumps beyond the changeset.

Coordination: PR #644's lineage is STOPPED as an engineering blocker (two-cycle cap, single successor of terminated #615) — this lane performs the owning repair only and does NOT re-open, re-review, or merge #644. After merge, record the landed fix on BUG ${BUGROW} (complete) and comment on PR #644 + row 529e2ee5 that the owning repair landed on main.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work; shared checkout dirty from other lanes — fetch refs and work from a worktree if the pull refuses). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/catalog-fix-<n> from origin/main. NEW BRANCH catalog-scaffold-fix; PR-first; never push to main. Commits end with 'Agent: catalog-fix-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check for an open PR touching apps/catalog scaffold (gh pr list --search 'catalog in:title,body') and BUG ${BUGROW} comments — if the fix already landed or a repair PR exists, verify and record; do not duplicate.
- TDD: red first (the ported tests fail on main), then the smallest owned source fix, green. Do NOT weaken the tests to match the scaffold.
- Verify: apps/catalog full suite green (record literal counts), 'bun install --frozen-lockfile' rc=0, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the PR and BUG ${BUGROW}, posts to #board. English. Lineage 'conversations agents register' named catalog-fix-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const FIX = CONST + `
ROLE: fix lane. Per the CONST: port apps/catalog/tests from ${CORPUS_SHA} onto a new branch off origin/main (prove red: the 9 named assertions fail), apply the four smallest owned source fixes, full catalog suite green (literal counts), frozen install rc=0, secrets scan, changeset (patch), commit ('Agent: catalog-fix-<your-role>'), push, open the PR referencing BUG ${BUGROW}.
Return (JSON): { prNumber: number, diffSummary: string, redBefore: {failed, named}, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks' on the PR ({PR}), re-run failed jobs, poll bounded (max 20 min), all five checks green at the new head (record the per-check table). The known environmental playwright stall, if the ONLY failure, re-run once and record.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PR ({PR}): (a) the regression tests are the corpus's own tests, ported unmodified (red-before/green-after measured), (b) the source fixes are the smallest owned changes for the four named defect classes, (c) no test weakening, (d) scope is apps/catalog only, (e) 5/5 CI green, (f) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — catalog-scaffold-fix @ <sha> — lens: catalog scaffold owned repair, reviewer catalog-fix-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge the PR (base-movement gate first — merge-tree against origin/main; gh pr merge --squash --body-file ending 'Agent: catalog-fix-ship'), record the merged sha, complete BUG ${BUGROW} with the evidence, comment on PR #644 and row 529e2ee5 that the owning repair landed (lineage stays stopped per policy). If NO_GO: comment findings + resume condition, leave open.
Return (JSON): { merged: bool, mergedSha: string|null, bugRowState: string, residue: [string] }
`

const FIX_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, diffSummary: { type: 'string' }, redBefore: { type: 'object' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['prNumber', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, bugRowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Fix')
const fix = await agent(FIX, { label: 'catalog-fix-fix', phase: 'Fix', schema: FIX_SCHEMA })

phase('Verify')
let verify = null
if (fix && fix.prNumber) {
  verify = await agent(VERIFY.replace('{PR}', String(fix.prNumber)), { label: 'catalog-fix-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'fix did not open a PR', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW.replace('{PR}', String(fix.prNumber)), { label: 'catalog-fix-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'fix/verify did not complete', detail: JSON.stringify({ fix, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'catalog-fix-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { fix, verify, review, ship }
