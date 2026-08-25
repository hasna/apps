export const meta = {
  name: 'knowledge-serve-help',
  description: 'Fix lane for row 8909e855 (BUG: @hasna/knowledge — knowledge-serve --help exits 1 requiring HASNA_KNOWLEDGE_DATABASE_URL before arg parse). Lane: IDEMPOTENCY CHECK FIRST -> reproduce -> smallest owned fix in apps/knowledge (help/version parse before env/config resolution) -> suite green + --help rc=0 -> one Fable review -> base gate + merge -> complete row with evidence.',
  phases: [
    { title: 'Investigate', detail: 'idempotency check; reproduce knowledge-serve --help rc=1 at CURRENT main; name the parse-order defect' },
    { title: 'Fix', detail: 'smallest owned fix in apps/knowledge (--help/--version parse before HASNA_KNOWLEDGE_DATABASE_URL resolution) + regression test + changeset' },
    { title: 'Verify', detail: 'knowledge-serve --help rc=0 without env, suite green, frozen install rc=0, CI green at head, diff gate (apps/knowledge only)' },
    { title: 'Review', detail: 'one Fable adversarial reviewer' },
    { title: 'Land', detail: 'base gate + squash merge + complete row 8909e855 with evidence' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '8909e855-04bd-4782-8345-ddba8192d1e8'

const CONST = `
You are the knowledge-serve-help lane (row ${ROW}; owner-authorized via the task-drain queue). Final text = machine-readable JSON.

Context (filed 2026-08-21): 'knowledge-serve --help' exits 1 because the binary requires HASNA_KNOWLEDGE_DATABASE_URL before argument parsing — help must never require the environment. This is the same class as the fixed projects-serve defect (todos 2ffcad1b): serve binaries parse --help/--version BEFORE env/config resolution.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: confirm row ${ROW} is still pending and unowned (no in_progress fixer row, no comments naming a workstream); check for an existing open PR fixing this (gh pr list --repo hasna/apps --search 'knowledge-serve in:title,body' — open knowledge PRs 484/567 are OTHER scopes, do not confuse or touch them). Sync the checkout (git -C ${MONOREPO} fetch origin main -q; never discard local work). Reproduce at CURRENT origin/main: 'bun run serve --help' or the package's serve bin with NO HASNA_KNOWLEDGE_DATABASE_URL in env — literal rc + output. If --help already exits 0 at current main, record the evidence and STOP (the lane is complete by recovery).
- ${MONOREPO} is READ/context only. File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/knowledge-serve-help cut from CURRENT origin/main. NEW BRANCH fix/knowledge-serve-help. PR-first; never push to main. Commits end with 'Agent: knowledge-serve-help-<role>' (the ONLY attribution line; never Co-Authored-By). Commit identity MUST be the canonical fleet identity (name 'Andrei Hasna', email andrei@hasna.com).
- FIX AT THE ROOT, NARROWLY: reorder argument parsing so --help/--version (and any other self-describing flag) resolve BEFORE the HASNA_KNOWLEDGE_DATABASE_URL env check; write a regression test that runs the serve bin with --help under an env WITHOUT the DB URL and asserts rc=0 + help text; add a .changeset/knowledge-serve-help.md patch changeset. HARD SCOPE GATE: the PR diff MUST be limited to apps/knowledge (the serve entrypoint + its test + the changeset) — any other app's files are a self-inflicted NO_GO.
- VERIFY: with HASNA_KNOWLEDGE_DATABASE_URL explicitly unset, the serve bin --help exits 0 (literal output); the knowledge test suite green (literal passed/failed counts, 'bun test' in apps/knowledge); 'bun install --frozen-lockfile' rc=0 in the worktree; CI per-check table green at the head sha (gh api actions/runs?head_sha=<sha> + per-job conclusions, bounded polling); diff gate (git diff origin/main...HEAD --stat: apps/knowledge only); secrets scan clean (redirect + 'secrets scan input', rc 0 clean).
- REVIEW (one Fable adversarial reviewer): (a) the parse-order defect is fixed at the root (help works with no env, measured), (b) regression test present and meaningful, (c) knowledge suite green, (d) diff gate — apps/knowledge only, (e) CI green at the head, (f) mergeability vs CURRENT origin/main (merge-tree clean). Post '[REVIEW] <GO|NO_GO> — knowledge-serve-help @ <sha> — lens: serve --help parse-order repair, reviewer knowledge-serve-help-review' to #board. Block ONLY concrete P0/P1 defects; two remediation cycles max.
- LAND: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: knowledge-serve-help-land', record the merged sha, complete row ${ROW} with the evidence (merged sha, --help rc, suite counts, review verdict). If NO_GO: comment findings + resume condition on the PR and the row, leave open, row stays pending.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on the PR and row ${ROW}, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Reproduce 'serve --help' with HASNA_KNOWLEDGE_DATABASE_URL unset at CURRENT origin/main — literal rc + the exact error; read the serve entrypoint to name the parse-order defect and the file(s) to change. Return (JSON): { mainTip, reproRc, reproOutput, parseOrderDefect, filesToChange: [string], notChecked: [string] }
`

const FIX = CONST + `
ROLE: fix lane (Opus). At the head after investigate: apply the smallest owned fix in apps/knowledge (arg-parse reorder + regression test + patch changeset); HARD SCOPE GATE (see CONST); canonical commit identity; commit; push; open the PR referencing row ${ROW}. Return (JSON): { newHead, rootCauseFixed, helpRcWithoutEnv, diffStatSummary, prNumber, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head: serve --help rc=0 with the DB URL env unset (literal); knowledge suite green (literal passed/failed counts); frozen install rc=0 in the worktree; CI per-check table at the head (bounded polling); diff gate (apps/knowledge only); secrets scan clean. Return (JSON): { helpRc, suiteCounts: {passed, failed}, frozenInstallRc, ciGreen, checks: [{name, conclusion}], diffGatePass, secretsClean, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). One review at the new head: (a) parse-order defect fixed at the root (help rc=0 with no env, measured), (b) regression test meaningful, (c) knowledge suite green, (d) diff gate — apps/knowledge only, (e) CI green at the head, (f) mergeability vs CURRENT origin/main (merge-tree clean), (g) secrets clean. Post '[REVIEW] <GO|NO_GO> — knowledge-serve-help @ <sha> — lens: serve --help parse-order repair, reviewer knowledge-serve-help-review' to #board. Block ONLY concrete P0/P1 defects. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: knowledge-serve-help-land', record merged sha, complete row ${ROW} with the evidence. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, rowState, residue: [] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { mainTip: { type: 'string' }, reproRc: { type: 'number' }, reproOutput: { type: 'string' }, parseOrderDefect: { type: 'string' }, filesToChange: { type: 'array' }, notChecked: { type: 'array' } }, required: ['mainTip', 'reproRc', 'parseOrderDefect'] }
const FIX_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, rootCauseFixed: { type: 'string' }, helpRcWithoutEnv: { type: 'number' }, diffStatSummary: { type: 'string' }, prNumber: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'prNumber'] }
const VERIFY_SCHEMA = { type: 'object', properties: { helpRc: { type: 'number' }, suiteCounts: { type: 'object' }, frozenInstallRc: { type: 'number' }, ciGreen: { type: 'boolean' }, checks: { type: 'array' }, diffGatePass: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['helpRc', 'ciGreen', 'checks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'knowledge-serve-help-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
const fix = investigate && investigate.reproRc !== 0 ? await agent(FIX, { label: 'knowledge-serve-help-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' }) : null

phase('Verify')
const verify = fix && fix.pushed ? await agent(VERIFY, { label: 'knowledge-serve-help-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'knowledge-serve-help-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'investigate/fix/verify did not complete or the defect already recovered', detail: JSON.stringify({ investigate, fix, verify }) }] }

phase('Land')
const land = review && review.verdict === 'GO'
  ? await agent(LAND, { label: 'knowledge-serve-help-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, rowState: 'pending', residue: ['NO_GO — fix lane must remediate per findings (two-cycle cap)'] }

return { investigate: investigate && { mainTip: investigate.mainTip, reproRc: investigate.reproRc, parseOrderDefect: investigate.parseOrderDefect }, fix: fix && { newHead: fix.newHead, prNumber: fix.prNumber, diffStatSummary: fix.diffStatSummary }, verify: verify && { helpRc: verify.helpRc, ciGreen: verify.ciGreen, diffGatePass: verify.diffGatePass }, review: review && review.verdict, land }
