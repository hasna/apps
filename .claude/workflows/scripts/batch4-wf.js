export const meta = {
  name: 'batch4-r2',
  description: 'Remediation cycle 2 (FINAL) for hasna/apps#615 (row 529e2ee5, hygiene fixtures): NO_GO at bf6cb5b4 with 2 P1s — (1) 6x TS2352 in apps/evals/src/core/redaction.test.ts (as-unknown-as cast or narrow), (2) publish-guard pack failures in apps/billing (prepack verify+scan:artifact) and apps/attachments (prepack verify:release), not root-caused. Rebase onto current main first (may resolve pack failures if base-stale), fix the casts, root-cause any remaining pack failure, 5/5 green, Fable re-review (cycle 2 FINAL), merge, complete row. Third NO_GO terminates the candidate',
  phases: [
    { title: 'Remediate', detail: 'rebase drain4-hygiene onto origin/main; TS2352 casts; root-cause billing/attachments prepack' },
    { title: 'Verify', detail: 'all five CI checks green at the new head' },
    { title: 'Review', detail: 'Fable re-review (cycle 2, FINAL, scoped)' },
    { title: 'Ship', detail: 'merge GO, complete 529e2ee5; NO_GO terminates' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const PR = 615
const ROW = '529e2ee5-5d14-47e8-a994-14702fedb528'

const CONST = `
You are a lane of the batch4-r2 workflow (2026-08-19). PR hasna/apps#${PR} (row ${ROW}, hygiene fixtures) got drain4r1-review NO_GO at bf6cb5b4 with TWO P1s — this is remediation cycle 2 (FINAL): a third NO_GO terminates the candidate per the bounded-review policy. Final text = machine-readable JSON.

The P1s: (1) build+test FAILS at head — @hasna/evals#build exits 2, 6x TS2352 in apps/evals/src/core/redaction.test.ts (lines 34, 52, 97, 107, 150, 189): 'Conversion of type AdapterConfig | undefined to type Record<string, unknown> may be a mistake... convert the expression to unknown first'. The casts pre-existed the sentinel remediation (identical at b377fb9f) but the PR as a whole must build. Fix: cast via 'as unknown as Record<string, unknown>' or narrow the type before indexing. (2) publish guard FAILS at head — apps/billing npm pack fails (prepack 'bun run verify && bun run scan:artifact' exit 1) and apps/attachments fails (prepack 'bun run verify:release' exit 1); NOT root-caused (pack log tail truncates). Note: origin/main has moved since the branch was cut (drain4-r1 closed #619 superseded by #622; main at db7ca40a+).

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/drain4r2-<n>; work on the PR's OWN branch (drain4-hygiene — gh pr view ${PR} --json headRefName, never guess). PR-first; never push to main. Commits end with 'Agent: drain4r2-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check PR #${PR} comments — if remediation of a P1 already landed (head moved past bf6cb5b4), verify and record; do not duplicate.
- REMEDIATE ONLY THE NAMED DEFECTS. Step 1: REBASE the branch onto origin/main (--force-with-lease after) — if the billing/attachments prepack failures were base-staleness, the rebase resolves them (record the before/after). Step 2: the TS2352 casts (smallest fix). Step 3: for any prepack failure that SURVIVES the rebase, root-cause it (run the failing prepack locally with output captured — redirect, never pipe — and name the exact failing assertion). No unrelated edits.
- Verify: 'bun install --frozen-lockfile' rc=0, affected suites green (evals redaction tests + access secret-boundary still pass — the sentinels must still exercise the redactor), 'bun run pack --dry-run' on billing/attachments if they were failing (or the CI publish-guard passes), secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on PR #${PR} and row ${ROW}, posts to #board. English. Lineage 'conversations agents register' named drain4r2-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const REMEDIATE = CONST + `
ROLE: remediate lane. Per the CONST: rebase drain4-hygiene onto origin/main (record old head bf6cb5b4 -> new head), fix the 6 TS2352 casts (red proven if the build failure is reproducible locally — record the literal), root-cause any surviving billing/attachments prepack failure (name the exact assertion; if the rebase resolved them, record the before/after evidence), affected suites green (record counts), secrets scan, commit ('Agent: drain4r2-<your-role>'), push --force-with-lease.
Return (JSON): { newHead: string, diffSummary: string, ts2352Fixed: bool, prepackState: [{app, resolvedByRebase|rootCause, evidence}], frozenInstallOk: bool, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks ${PR}', re-run failed jobs (gh run rerun), poll bounded (max 20 min), require ALL FIVE checks GREEN at the new head (record the per-check table; build+test and publish guard are the two under test). The known environmental playwright stall, if the ONLY failure, re-run once and record.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable) — cycle 2 (FINAL), scoped to the named P1s and their direct regressions. Review: (a) the TS2352 casts fixed at the new head (build green), (b) the billing/attachments prepack failures resolved or root-caused with the exact assertion named (no silent skip), (c) the sentinels still exercise the redactors (tests pass), (d) all five CI checks green (or ONLY the documented environmental stall), (e) secrets clean, PR-first, no scope creep. Post '[REVIEW] <GO|NO_GO> — drain4r2 @ <sha> — lens: cycle-2 FINAL, reviewer drain4r2-review'. Block ONLY concrete P0/P1 defects. A third NO_GO terminates the candidate.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge PR #${PR} (base-movement gate first — merge-tree against origin/main; gh pr merge --squash --body-file ending 'Agent: drain4r2-ship'), record the merged sha, complete row ${ROW} with the evidence. If NO_GO: comment findings + resume condition, leave in_progress — the candidate terminates; record that on the row.
Return (JSON): { merged: bool, mergedSha: string|null, rowState: string, residue: [string] }
`

const REM_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, diffSummary: { type: 'string' }, ts2352Fixed: { type: 'boolean' }, prepackState: { type: 'array' }, frozenInstallOk: { type: 'boolean' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Remediate')
const remediate = await agent(REMEDIATE, { label: 'drain4r2-fix', phase: 'Remediate', schema: REM_SCHEMA })

phase('Verify')
let verify = null
if (remediate && remediate.newHead) {
  verify = await agent(VERIFY, { label: 'drain4r2-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'remediation did not complete', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW, { label: 'drain4r2-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'remediate/verify did not complete', detail: JSON.stringify({ remediate, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'drain4r2-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { remediate, verify, review, ship }
