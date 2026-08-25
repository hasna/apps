export const meta = {
  name: 'wave670-ship-r4',
  description: 'Wave #670 successor candidate (the ONE successor the bounded-review adjudication routes after the cycle-2 termination): the terminated candidate\'s sole blocking P1 is that the wave\'s regenerated lock resolves @electric-sql/pglite 0.5.5 while main pins 0.5.4 (^0.5.4 declared; drift from the lock regen; knowledge suite teardown crashes on 0.5.5). This lane: pin pglite to 0.5.4 (match main\'s resolution), regenerate the lock, push a materially new head, fresh CI, ONE fresh review, base gate, merge, [SHIP-READY].',
  phases: [
    { title: 'Lock', detail: 'pin pglite 0.5.4, regenerate lock, keep all verified surfaces, push new head' },
    { title: 'Verify', detail: 'fresh CI at the new head — knowledge suite green, RULING D loops class acceptable' },
    { title: 'Review', detail: 'ONE fresh Fable review of the successor candidate' },
    { title: 'Ship', detail: 'base gate + merge + [SHIP-READY]' },
  ],
}

const CONST = `
You are the wave670-ship-r4 lane (owner-authorized — the ONE successor candidate the bounded-review adjudication routes after the wave ship lineage\'s cycle-2 termination). Final text = machine-readable JSON.

Context (measured, review 717240 — the terminating NO_GO): the terminated candidate (head 8b78293d) fixed the named defect (CI exists, mergeable vs current main b5e05fd5, knowledge.js conflict both-sides, bun-types lock fix + contracts state preserved, secrets clean) but carried ONE blocking P1: the wave\'s regenerated bun.lock resolves @electric-sql/pglite to 0.5.5 while main\'s lock pins 0.5.4 (both package.json declare ^0.5.4 — 0.5.5 is unintended third-party resolution drift from the wave\'s lock regen, not a declared change). tests/entry-versioning-client.test.ts (live Bun.serve + PGlite fixture) exits 99 on 0.5.5 (teardown crash, 470 pass / 2 skip / 0 fail) and rc=0 on 0.5.4; main\'s CI runs the same suite green at 36f771705. Merging the terminated candidate would land pglite 0.5.5 on main and break the knowledge suite for every subsequent PR — the exact regression class main\'s #700 lock regen was fixing. REVIEWER REMEDIATION POINTER (verbatim): regenerate bun.lock with pglite pinned to 0.5.4 (match main\'s resolution).

THIS IS THE SUCCESSOR CANDIDATE — a materially new candidate (the lock defect removed), NOT a remediation cycle of the terminated one. It gets ONE fresh review; the reviewer\'s findings then remediate (max two cycles) on THIS candidate. Do NOT reopen the terminated candidate.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: confirm #670 is still OPEN and unmerged (gh pr view 670; if merged while dispatching, verify + stop); confirm the current head is 8b78293d and origin/main is b5e05fd5 (re-measure if either moved).
- /home/hasna/workspace/repos/hasna/apps is READ/context only. Sync first (git -C <checkout> fetch origin main -q; never discard local work). File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/wave670-ship-r4 cut from origin/main. Work on the release/version-wave branch (fetch from origin); this is the existing wave PR #670 — rebase/force-push per the wave lineage, never a duplicate PR. Commits end with 'Agent: wave670-ship-r4-<role>' (the ONLY attribution line; never Co-Authored-By).
- LOCK: pin @electric-sql/pglite to 0.5.4 (matching main\'s resolution) in the regenerated bun.lock; regenerate under no-quarantine resolution (exact-name minimumReleaseAgeExcludes in ~/.bunfig.toml if the quarantine blocks the resolve — never lower the quarantine itself). KEEP all verified surfaces: bun-types@1.4.0 x5 + workspace locators (economy/files/sheets/slides/tables), the contracts revert (50/50 byte-identical vs origin/main), the RULING B/C surfaces (incl. the knowledge bin/dist both-sides resolution). Verify the regenerated lock: pglite == 0.5.4, bun-types entries present, frozen install rc=0 in a fresh checkout. Do NOT touch version numbers or changesets.
- VERIFY at the new head: fresh-checkout 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, full prepare scripts, zero node_modules); CI per-check table (gh api actions/runs?head_sha=<sha> + per-job conclusions) — CI MUST exist at this head; build + test (affected) GREEN (knowledge suite exit 0 — the pglite fix is proven by the suite passing); test-suites may show the RULING D loops class (unbacked == ["loops"]) — acceptable; classify 5/5 green, or green-with-RULING-D-loops-class-only, or FAIL (name the failing check exactly); versioning suite with only the two documented classes; secrets scan clean.
- REVIEW (ONE fresh review of the successor): review the materially new candidate at the new head: (a) pglite pinned to 0.5.4 matching main (regenerate evidence), (b) knowledge suite green at the head (exit 0), (c) CI exists + green or exactly the RULING D class, (d) mergeability vs CURRENT origin/main (merge-tree clean), (e) the verified surfaces preserved (bun-types x5, contracts revert, version-only diff class, secrets), (f) no stray non-version paths. Post '[REVIEW] <GO|NO_GO> — wave670 @ <sha> — lens: wave successor candidate (pglite pin), reviewer wave670-ship-r4-review' to #apps. Block ONLY concrete P0/P1 defects. On NO_GO: findings remediate on THIS candidate (max two cycles).
- SHIP: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge 670 --squash --body-file ending 'Agent: wave670-ship-r4-ship', record merged sha, post [SHIP-READY] on git-publishing with the bumped package set (name@version per package, count) + merged sha — publish-all is the ONLY publisher and consumes it.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on PR #670 and #board. English. Distinguish measured vs inferred; state what you did not check.
`

const LOCK = CONST + `
ROLE: lock lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Pin @electric-sql/pglite to 0.5.4 in the wave lock (regenerate under no-quarantine resolution; exact-name excludes if needed), verify pglite == 0.5.4 + bun-types x5 + workspace locators + contracts revert intact, frozen install rc=0 in a fresh checkout, commit (lock only), force-push the wave branch. Return (JSON): { newHead, lockFixed: {pglite, bunTypesEntries, workspaceLocators: [string]}, frozenInstallRc, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head (sha in the lock result): fresh-checkout 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, full prepare scripts, zero node_modules); CI per-check table at the head (gh api actions/runs?head_sha=<sha> + per-job conclusions — wait with bounded polling if queued; CI MUST exist); build + test (affected) GREEN — the knowledge suite exit 0 at the head is the pglite-fix proof (paste the suite line); test-suites may show the RULING D loops class only; versioning suite with only the two documented classes; contracts revert spot-check; secrets scan clean. Classify: 5/5 green, or green-with-RULING-D-loops-class-only, or FAIL (name the failing check exactly). Return (JSON): { ciGreen, checks: [{name, conclusion}], installRc, knowledgeSuite: {exit, passed, failed, skipped}, rulingDClassOnly, contractsRevertIntact, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). ONE fresh review of the successor candidate at the new head: (a) pglite pinned to 0.5.4 matching main (regeneration evidence), (b) knowledge build+test green at the head (exit 0 — the terminating P1 is fixed), (c) CI exists at this head and is 5/5 green or exactly the RULING D loops class + green elsewhere, (d) mergeability vs CURRENT origin/main (merge-tree clean), (e) the verified surfaces preserved (bun-types x5 + workspace locators, contracts revert 50/50, version-only diff class + RULING B/C, secrets), (f) no stray non-version paths. Post '[REVIEW] <GO|NO_GO> — wave670 @ <sha> — lens: wave successor candidate (pglite pin), reviewer wave670-ship-r4-review' to #apps. Block ONLY concrete P0/P1 defects; findings remediate on THIS candidate (max two cycles). Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge 670 --squash --body-file ending 'Agent: wave670-ship-r4-ship', record merged sha, post [SHIP-READY] on git-publishing with the bumped package set (name@version per package, count) + merged sha — publish-all consumes it (the ONLY publisher). If NO_GO: comment findings + resume condition, leave open, no [SHIP-READY]. Return (JSON): { merged, mergedSha, shipReadyPosted, bumpSet: {count, packages: [string]}, residue: [] }
`

const LOCK_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, lockFixed: { type: 'object' }, frozenInstallRc: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed'] }
const VERIFY_SCHEMA = { type: 'object', properties: { ciGreen: { type: 'boolean' }, checks: { type: 'array' }, installRc: { type: 'number' }, knowledgeSuite: { type: 'object' }, rulingDClassOnly: { type: 'boolean' }, contractsRevertIntact: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['ciGreen', 'checks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, shipReadyPosted: { type: 'boolean' }, bumpSet: { type: 'object' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Lock')
const lock = await agent(LOCK, { label: 'wave670-r4-lock', phase: 'Lock', schema: LOCK_SCHEMA, model: 'opus' })

phase('Verify')
const verify = lock && lock.pushed
  ? await agent(VERIFY, { label: 'wave670-r4-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' })
  : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'wave670-r4-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'lock/verify did not complete', detail: JSON.stringify({ lock, verify }) }] }

phase('Ship')
const ship = review && review.verdict === 'GO'
  ? await agent(SHIP, { label: 'wave670-r4-ship', phase: 'Ship', schema: SHIP_SCHEMA })
  : { merged: false, mergedSha: null, shipReadyPosted: false, bumpSet: null, residue: ['NO_GO — successor candidate must remediate per findings (max two cycles)'] }

return { lock: lock && { newHead: lock.newHead, lockFixed: lock.lockFixed }, verify: verify && { ciGreen: verify.ciGreen, knowledgeSuite: verify.knowledgeSuite }, review: review && review.verdict, ship }
