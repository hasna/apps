export const meta = {
  name: 'identities-roster-fallback-fix',
  description: 'Fix lane for BUG row 34c5512c (task-drain dispatch 2026-08-20): @hasna/identities — resolveRosterPath() SILENTLY falls back to the bundled 3-agent synthetic example at rc=0 when no roster file is found; add a data-dir resolution step. TDD regression first, smallest owned fix in apps/identities, suite green, changeset, PR, CI, Fable review, merge, complete the row with evidence',
  phases: [
    { title: 'Investigate', detail: 'idempotency check + reproduce the silent synthetic-roster fallback, name the code path' },
    { title: 'Fix', detail: 'failing regression test first, smallest owned fix, suite green, changeset, PR' },
    { title: 'Verify', detail: 'CI 5/5 at the new head' },
    { title: 'Review', detail: 'Fable adversarial review' },
    { title: 'Ship', detail: 'base gate, merge, complete row 34c5512c with evidence' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '34c5512c-b75b-4d99-9d7f-73d629ef09bf'

const CONST = `
You are a lane of the identities-roster-fallback-fix workflow (task-drain dispatch 2026-08-20, BUG row ${ROW}). Bug: @hasna/identities — resolveRosterPath() SILENTLY falls back to the bundled 3-agent synthetic example roster at rc=0 when no roster file resolves, so bare 'identities agent list' can report 3 synthetic agents as if they were the fleet. Fix direction named on the row: add a data-dir resolution step (the same silent-fallback family as incident 715558 — a fallback must never present a synthetic/empty backing store as the real population; it must either resolve a real roster or error naming the mode switch). Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work; shared checkout dirty from other lanes — fetch refs and work from a worktree if the pull refuses). File mutation happens in a task worktree ~/.hasna/repos/worktrees/apps/roster-fallback-<n> from origin/main. NEW BRANCH fix/identities-roster-fallback; PR-first; never push to main. Commits end with 'Agent: roster-fallback-<your-role>' (the ONLY attribution line).
- IDEMPOTENCY CHECK FIRST: check for an existing open PR fixing the roster fallback (gh pr list --repo hasna/apps --search 'roster in:title,body' + 'identities in:title,body'), and read the BUG row's comments for an existing fixer or duplicate filing. If a live fix exists, verify and record; do NOT duplicate.
- Scope is apps/identities ONLY. The fix is the smallest owned change: resolveRosterPath must (a) resolve a REAL roster through the canonical data-dir resolution (IDENTITIES_ROSTER_FILE / the identities data root — measure which surface the CLI already uses), and (b) when nothing resolves, FAIL with a usable error naming the missing roster/mode switch — NEVER silently return the bundled synthetic example as if it were real data. Preserve any legitimate dev/test use of the synthetic roster behind an explicit flag or fixture, never as the default path.
- TDD: failing regression test first (red: bare roster read returns the synthetic 3-agent roster at rc=0 with no error), smallest owned fix (green). Do NOT weaken tests.
- Verify: the identities app suite green (record literal counts), 'bun install --frozen-lockfile' rc=0, secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push, changeset (patch — bug fix).
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines.
- Record as you go: comments on the PR and BUG row ${ROW}, posts to #board. English. Lineage 'conversations agents register' named roster-fallback-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per the CONST). Then REPRODUCE: read apps/identities — resolveRosterPath (search for the function, the bundled synthetic roster constant, and the roster file resolution surfaces: IDENTITIES_ROSTER_FILE, the identities data root, any ~/.hasna/identities path), and reproduce the silent fallback (bare roster read with no file present returns the synthetic roster at rc=0 with no notice). NAME THE CODE PATH and the exact resolution step to add. State what you did not check.
Return (JSON): { idempotency: { existingPr: string|null, existingFixer: string|null, decision: string }, codePath: string, repro: string, fixDirection: string, testFiles: [string], evidence: string }
`

const FIX = CONST + `
ROLE: fix lane. Per the CONST + the code path ({CODEPATH}): (1) write the failing regression test first (the bare roster read must NOT silently return the synthetic 3-agent roster — red); (2) implement the smallest owned fix in apps/identities per the fix direction ({FIXDIRECTION}); (3) full identities suite green (literal counts), frozen install rc=0, secrets scan, changeset (patch), commit ('Agent: roster-fallback-<your-role>'), push, open the PR referencing BUG ${ROW}.

RE-ENTRY (resume wf_fe022eae-ccd, run 4, 2026-08-20): REBASE-RE-ENTRY #4. PR hasna-internal/internal-apps#353 is at 60377a2e38 with CI green + fresh [REVIEW] GO, but the base-movement gate failed again: origin/main moved to bf51b76128 (accounts internal move #344) after the run-3 rebase; merge-tree 63f7525f6 != reviewed head tree (276 differing paths, 0 identities/changeset). REBASE fix/identities-roster-fallback onto origin/main bf51b76128 (content-identical expected — verify git diff 60377a2e38 <new-head> -- 14 paths is empty), force-push, and return the new head sha. After the rebase <merge-ref>^{tree} == <head>^{tree} must hold. The bulkmove train is the mover; each cycle holds correctly. If the base moves AGAIN during this cycle, hold with the exact new base and record it — the lane keeps the row pending with the exact resume condition; do not loop unboundedly within one run.
Return (JSON): { prNumber: number, diffSummary: string, redBefore: {failed, named}, suiteCounts: {passed, failed}, secretsClean: bool, evidence: string }
`

const VERIFY = CONST + `
ROLE: verify lane. Per the CONST: CI — 'gh pr checks' on the PR ({PR}), re-run failed jobs, poll bounded (max 20 min), all five checks green at the new head (record the per-check table). The known environmental playwright stall, if the ONLY failure, re-run once and record.

RE-ENTRY (resume wf_fe022eae-ccd, run 2): REBASE-RE-ENTRY — re-verify at the NEW head after the rebase push (the PR is on hasna-internal/internal-apps where CI is 3 checks, not 5 — record the actual per-check table for that repo). acceptanceMet=true only when all checks are green at the new head.
Return (JSON): { checks: [{name, status, conclusion}], ciGreen: bool, acceptanceMet: bool, resumeCondition: string|null, evidence: string }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the PR ({PR}): (a) the regression test reproduces the silent synthetic-roster fallback and the fix fails with a usable error (red-before/green-after measured), (b) the fix is the smallest owned change adding the data-dir resolution step, (c) the synthetic roster is no longer reachable as the default path, (d) no test weakening, (e) scope is apps/identities only, (f) 5/5 CI green, (g) secrets clean, PR-first. Post '[REVIEW] <GO|NO_GO> — identities-roster-fallback-fix @ <sha> — lens: roster resolution fallback, reviewer roster-fallback-review'. Block ONLY concrete P0/P1 defects; two remediation cycles max.

RE-ENTRY (resume wf_fe022eae-ccd, run 2): REBASE-RE-ENTRY — review at the NEW head after the rebase (the rebase was main's markdown-move; verify the PR's own 14 files are byte-identical and merge-tree equality holds); post a FRESH verdict at the new head sha. A cached GO from 4ad375ce does not cover the rebased head.
Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship. If GO + acceptanceMet: merge the PR (base-movement gate first — merge-tree against origin/main; gh pr merge --squash --body-file ending 'Agent: roster-fallback-ship'), record the merged sha, complete BUG ${ROW} with the evidence (merged sha, suite counts, review verdict). If NO_GO: comment findings + resume condition, leave open.

RE-ENTRY (resume wf_fe022eae-ccd, run 2): REBASE-RE-ENTRY ship — the run-1 ship correctly held on the base-movement gate (main moved to c6f7ddbae6 after the GO at 4ad375ce). Merge only if the rebase pushed a new head, verify reports all checks green at THAT head, and review returned a FRESH GO at that head. Base-movement gate: git merge-tree against CURRENT origin/main — after the rebase <merge-ref>^{tree} == <head>^{tree} must hold. Then squash-merge with --body-file ending 'Agent: roster-fallback-ship', record the merged sha, complete BUG 34c5512c with the evidence.
Return (JSON): { merged: bool, mergedSha: string|null, rowState: string, residue: [string] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { idempotency: { type: 'object' }, codePath: { type: 'string' }, repro: { type: 'string' }, fixDirection: { type: 'string' }, testFiles: { type: 'array' }, evidence: { type: 'string' } }, required: ['idempotency', 'codePath'] }
const FIX_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, diffSummary: { type: 'string' }, redBefore: { type: 'object' }, suiteCounts: { type: 'object' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['prNumber', 'diffSummary'] }
const VERIFY_SCHEMA = { type: 'object', properties: { checks: { type: 'array' }, ciGreen: { type: 'boolean' }, acceptanceMet: { type: 'boolean' }, resumeCondition: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['acceptanceMet'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'roster-fallback-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
let fix = null
if (investigate && investigate.idempotency && investigate.idempotency.decision !== 'already-done') {
  fix = await agent(FIX.replace('{CODEPATH}', investigate.codePath).replace('{FIXDIRECTION}', investigate.fixDirection), { label: 'roster-fallback-fix', phase: 'Fix', schema: FIX_SCHEMA })
} else {
  fix = { prNumber: 0, diffSummary: 'skipped', evidence: 'idempotency: already-done' }
}

phase('Verify')
let verify = null
if (fix && fix.prNumber) {
  verify = await agent(VERIFY.replace('{PR}', String(fix.prNumber)), { label: 'roster-fallback-verify', phase: 'Verify', schema: VERIFY_SCHEMA })
} else {
  verify = { acceptanceMet: false, resumeCondition: 'fix did not open a PR', evidence: 'skipped' }
}

phase('Review')
let review = null
if (verify && verify.acceptanceMet) {
  review = await agent(REVIEW.replace('{PR}', String(fix.prNumber)), { label: 'roster-fallback-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
} else {
  review = { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'fix/verify did not complete', detail: JSON.stringify({ fix, verify }) }] }
}

phase('Ship')
const ship = await agent(SHIP, { label: 'roster-fallback-ship', phase: 'Ship', schema: SHIP_SCHEMA })

return { investigate, fix, verify, review, ship }
