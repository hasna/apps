export const meta = {
  name: 'task-drain-batch4',
  description: 'Task-drain batch 4 (2026-08-19, every-10-min drain pass): two unowned rows — (1) 6fa79ced CI Playwright-chromium install timeout resilience (repo-wide, apt mirror unreachable), (2) 529e2ee5 shared-checkout hygiene: classify 141 pre-existing uncommitted paths, preserve real work, restore checkout to clean. Per-lane TDD where testable, Fable review, PR-first',
  phases: [
    { title: 'Fix', detail: 'two lanes: CI playwright install resilience; shared-checkout hygiene classify+clean' },
    { title: 'Review', detail: 'Fable adversarial review per PR' },
    { title: 'Report', detail: 'merge GO PRs, complete rows by evidence, #board' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PROJECT = '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'

const CONST = `
You are a lane of the task-drain-batch4 workflow (2026-08-19, owner-authorized every-10-min task drain in ${MONOREPO}). Two unowned rows are done here, one lane each, PR-first. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/drain4-<n> from origin/main. PR-first; never push to main. Commits end with 'Agent: drain4-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check the row's comments + open PRs touching the surface; if a fix already landed or is being worked, verify and record — do not duplicate.
- TDD FIRST where testable: the failing regression before the fix (red proven), then the smallest owned repair. No band-aids.
- No secrets: never print/capture/commit credential values; staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the row + PR, posts to #board, mementos for non-obvious findings. English. Lineage 'conversations agents register' named drain4-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const LANE_CI = CONST + `
ROLE: fix lane for row 6fa79ced (BUG: hasna/apps CI — 'build + test (affected)' job times out at 'Install playwright chromium (member browser tests)'). MEASURED (display-names + machines-split lanes, 2026-08-19): the env-setup step runs 'bunx playwright install chromium --with-deps' and the apt mirror azure.archive.ubuntu.com is unreachable (Ign retries then ~9 min silence) — 10-min timeout, repo-wide (push to main run 32270240029, PRs 601/600 runs all fail identically; runs that get past it are green). OWED: make the Playwright browser install resilient in the CI workflow(s): bounded retry, alternate mirror, or cached browser (the repo's own cache key) — smallest owned change. Proof: a CI run on the PR passes the env-setup step (or the step is removed where the browser is not actually needed for the affected-build job's tests — verify which tests need it first). Run the affected checks, secrets scan, commit ('Agent: drain4-<your-role>'), push, PR referencing 6fa79ced.
Return (JSON): { prNumber: number|null, diffSummary: string, proof: string, secretsClean: bool, evidence: string }
`

const LANE_HYGIENE = CONST + `
ROLE: fix lane for row 529e2ee5 (HYGIENE: 141 pre-existing uncommitted paths in the shared ${MONOREPO} checkout — mostly test files under apps/*; worktree-law compliance; predates publish-all lanes). OWED: (1) ENUMERATE all 141 paths exactly (git status --porcelain, redirect to a file) and CLASSIFY each: coherent work (real test/source content) vs generated residue (build outputs, node_modules-ish, temp files); (2) PRESERVE every coherent-work path: copy it into a worktree branch (drain4-hygiene), and if the files form coherent tests, open a PR carrying them (tests-only PR, referencing 529e2ee5); (3) only after preservation is verified (files present in the branch), remove the residue from the shared checkout — and ONLY paths you classified as residue; NEVER discard or overwrite a path whose content you did not read and classify; (4) restore the shared checkout to a clean tree (git status --porcelain empty) and record the exact before/after counts. If a path's ownership is genuinely ambiguous (real work by an unknown lane), preserve it in the preservation branch rather than deleting. Report the classification table.
Return (JSON): { enumerated: number, classified: {work, residue, ambiguous}, preserved: number, removed: number, prNumber: number|null, checkoutClean: bool, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PRs ({PRS}): (a) each change is the smallest owned repair, (b) CI lane: the playwright install step is resilient or provably unneeded, with a CI run passing env-setup; hygiene lane: EVERY removed path was classified with evidence (no silent discard of real work), preservation branch verified, (c) secrets clean, (d) PR-first. Post '[REVIEW] <GO|NO_GO> — drain4 <item> @ <sha> — lens: task-drain batch 4, reviewer drain4-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.
Return (JSON): { prs: [{number, verdict, findings: [{severity, title, detail}]}] }
`

const REPORT = CONST + `
ROLE: report. For each GO PR: merge (base-movement gate first; gh pr merge --squash --body-file ending 'Agent: drain4-ship'), complete the row with the fix + merged sha. NO_GO: comment findings + resume condition, leave in_progress. The hygiene row completes only when the checkout is verifiably clean (git status --porcelain empty readback). Post one #board line per outcome.
Return (JSON): { rows: [{rowId, prNumber, verdict, merged, mergedSha, rowState}], residue: [string] }
`

const LANE_SCHEMA = { type: 'object', properties: { prNumber: { type: ['number', 'null'] }, diffSummary: { type: 'string' }, proof: { type: 'string' }, secretsClean: { type: 'boolean' }, enumerated: { type: 'number' }, classified: { type: 'object' }, preserved: { type: 'number' }, removed: { type: 'number' }, checkoutClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['diffSummary'] }
const REVIEW_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REPORT_SCHEMA = { type: 'object', properties: { rows: { type: 'array', items: { type: 'object' } }, residue: { type: 'array' } }, required: ['rows'] }

phase('Fix')
const [lCi, lHygiene] = await parallel([
  () => agent(LANE_CI, { label: 'drain4-ci', phase: 'Fix', schema: LANE_SCHEMA }),
  () => agent(LANE_HYGIENE, { label: 'drain4-hygiene', phase: 'Fix', schema: LANE_SCHEMA }),
])
const prs = [lCi, lHygiene].filter(Boolean).map(l => ({ number: l.prNumber, diff: l.diffSummary })).filter(p => p.number)
log(`fix lanes: ${prs.map(p => '#' + p.prNumber).join(', ') || 'none opened'}`)

phase('Review')
let review = null
if (prs.length) {
  review = await agent(REVIEW.replace('{PRS}', JSON.stringify(prs)), { label: 'drain4-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { prs: [] }
}

phase('Report')
const report = await agent(REPORT, { label: 'drain4-report', phase: 'Report', schema: REPORT_SCHEMA })

return { ci: lCi, hygiene: lHygiene, review, report }
