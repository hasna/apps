export const meta = {
  name: 'wave670-ship-r5',
  description: 'Wave #670 successor candidate — cycle-1 remediation (successor lineage, max two cycles on THIS candidate): review NO_GO at 2d0bcb3e4 — pglite pin proven (knowledge suite 470/0/2 exit 0) but P1: CI build+test FAILS (@hasna/projects installed-authority verifier test) from the same lock-drift class at scale — 121 wave-introduced lock resolutions vs main + wave changesets bumped projects dep pins (conversations 0.5.41->0.6.3, todos 0.15.19->0.15.36, loops ->0.5.3) collapsing the nested installed resolution. This lane: restore projects dep pins to main values, regenerate bun.lock to main resolution parity, prove verifier rc=0 + CI green at the new head, cycle-1 focused re-review, base gate, merge, [SHIP-READY].',
  phases: [
    { title: 'Fix', detail: 'restore projects dep pins + lock regen to main resolution parity, push new head' },
    { title: 'Verify', detail: 'fresh frozen install + projects verifier rc=0 + CI per-check at the new head' },
    { title: 'Review', detail: 'cycle-1 focused Fable re-review (named P1 + direct regressions)' },
    { title: 'Ship', detail: 'base gate + merge + [SHIP-READY]' },
  ],
}

const CONST = `
You are the wave670-ship-r5 lane (owner-authorized — cycle-1 remediation of the wave #670 SUCCESSOR candidate; successor lineage, max two cycles on THIS candidate). Final text = machine-readable JSON.

Context (measured, review 717454): the successor head 2d0bcb3e4 pinned pglite 0.5.4 (knowledge suite 470 pass / 0 fail / 2 skip, exit 0 — the terminating P1 is FIXED) but the fresh review found P1: CI 'build + test (affected)' FAILS at 2d0bcb3e4 — @hasna/projects 'installed Conversations producer authority compatibility > accepts canonical forward/inverse receipts and rejects cross-project reuse' (apps/projects/src/lib/project-resource-link-producer-verifier.test.ts), CI run 32407032647: 'stored producer receipt does not match the supplied verification envelope' (lookupStoredReceipt at project-resource-link-producer-verifier.ts:436 — canonicalJson(result.receipt) !== canonicalJson(receipt)); arm64 fixture error 'Cannot find module @hasna/conversations' from fixtures/project-resource-link-producer-verifier.installed-authority.ts. Controlled: same test at origin/main b4f0e4d6 = 1 pass / 0 fail / rc=0. Root cause: the same lock/dependency-drift class at SCALE — head lock vs origin/main lock = 186 resolution differences, 121 wave-introduced (pg 8.22.0->8.23.0, pg-protocol, ai 6.0.246->6.0.253, all @ai-sdk/*, semver 7.7.2->7.8.5, hono 4.13.1->4.13.2, e2b 2.38.2->2.39.0, cron-parser, tsx, resend, ip-address, @smithy/*, @aws-sdk/*, @tiptap/* 3.29.2->3.30.1; 0 entries are main-side movement); AND the wave's changesets version run bumped projects' dep pins (@hasna/conversations 0.5.41->0.6.3, @hasna/todos 0.15.19->0.15.36, @hasna/loops >=0.3.0->>=0.5.3), collapsing the nested installed-authority resolution (@hasna/projects/@hasna/conversations = registry 0.5.41 in main/base locks) the test is named for. REVIEWER REMEDIATION (verbatim): restore projects' dependency pins to main's values (conversations 0.5.41, todos 0.15.19, loops >=0.3.0) or otherwise restore the nested installed resolutions; regenerate bun.lock to main resolution parity (not just pglite); prove the projects verifier suite rc=0 plus CI green at the new head.

THIS IS CYCLE-1 ON THE SUCCESSOR CANDIDATE. A second NO_GO remediates once more (cycle-2); a third terminates the successor lineage.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: confirm #670 is still OPEN and unmerged (gh pr view 670); confirm the current head is 2d0bcb3e4 and origin/main is b4f0e4d6 (re-measure if either moved); read the NO_GO review comment on #670 (exact text).
- /home/hasna/workspace/repos/hasna/apps is READ/context only. Sync first (git -C <checkout> fetch origin main -q; never discard local work). File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/wave670-ship-r5 cut from origin/main. Work on the release/version-wave branch (fetch from origin); this is the existing wave PR #670 — rebase/force-push per the wave lineage, never a duplicate PR. Commits end with 'Agent: wave670-ship-r5-<role>' (the ONLY attribution line; never Co-Authored-By).
- FIX: (1) restore apps/projects dependency pins to main's values (conversations 0.5.41, todos 0.15.19, loops >=0.3.0 — or otherwise restore the nested installed resolutions the verifier test needs, deciding with evidence and recording the decision); (2) regenerate bun.lock to MAIN RESOLUTION PARITY — the 121 wave-introduced resolution differences must return to main's resolutions (pg 8.22.0, ai 6.0.246, semver 7.7.2, hono 4.13.1, e2b 2.38.2, @tiptap/* 3.29.2, etc.), regenerating under no-quarantine resolution (exact-name minimumReleaseAgeExcludes in ~/.bunfig.toml if the quarantine blocks any resolution — never lower the quarantine itself). KEEP all other verified surfaces: pglite pinned 0.5.4, bun-types@1.4.0 x5 + workspace locators (economy/files/sheets/slides/tables), the contracts revert (50/50 byte-identical vs origin/main), the RULING B/C surfaces (incl. knowledge bin/dist both-sides). Do NOT touch version numbers or changesets themselves beyond the projects dep-pin restoration.
- VERIFY at the new head: fresh-checkout 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, full prepare scripts, zero node_modules); the projects verifier suite rc=0 at the head (the named failing test, literal output); lock parity measurement (head vs origin/main resolution diff count — must drop to the RULING class, ideally 0 wave-introduced); CI per-check table (gh api actions/runs?head_sha=<sha> + per-job conclusions — CI MUST exist at this head) — 5/5 green or exactly the RULING D loops class; knowledge suite exit 0 (pglite proof preserved); secrets scan clean.
- REVIEW (cycle-1 focused on the successor candidate): re-review ONLY the named P1 (projects verifier + lock parity at the new head) + direct regressions of the fix. Post '[REVIEW] <GO|NO_GO> — wave670 @ <sha> — lens: wave successor cycle-1 lock-parity remediation, reviewer wave670-ship-r5-review' to #apps. Block ONLY concrete P0/P1 defects; max two cycles on this candidate.
- SHIP: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge 670 --squash --body-file ending 'Agent: wave670-ship-r5-ship', record merged sha, post [SHIP-READY] on git-publishing with the bumped package set (name@version per package, count) + merged sha — publish-all consumes it (the ONLY publisher); read the bump set from the merged head's package.json files, NEVER from the PR body (the PR body's bump table is stale per the ship-latest census).
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on PR #670 and #board. English. Distinguish measured vs inferred; state what you did not check.
`

const FIX = CONST + `
ROLE: fix lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Restore apps/projects dep pins to main's values (conversations 0.5.41, todos 0.15.19, loops >=0.3.0 — or the evidence-backed equivalent restoring the nested installed resolutions), regenerate bun.lock to main resolution parity under no-quarantine resolution (exact-name excludes if needed), keep pglite 0.5.4 + bun-types x5 + workspace locators + contracts revert + RULING B/C, fresh frozen install rc=0, projects verifier suite rc=0 (named test green, literal output), commit, force-push the wave branch. Return (JSON): { newHead, depPinsRestored: {conversations, todos, loops}, lockParity: {headVsMainDiffs, waveIntroduced}, keptSurfaces: [string], verifierRc, frozenInstallRc, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head (sha in the fix result): fresh-checkout 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, full prepare scripts, zero node_modules); projects verifier suite rc=0 (named test green, literal output); lock parity re-measured (head vs origin/main resolution diff count); CI per-check table at the head (gh api actions/runs?head_sha=<sha> + per-job conclusions — wait with bounded polling if queued; CI MUST exist at this head) — classify 5/5 green, or green-with-RULING-D-loops-class-only, or FAIL (name the failing check exactly); knowledge suite exit 0 (pglite proof); contracts revert spot-check; secrets scan clean. Return (JSON): { ciGreen, checks: [{name, conclusion}], installRc, verifier: {exit, passed, failed}, lockParity: {headVsMainDiffs, waveIntroduced}, knowledgeSuite: {exit, passed, failed, skipped}, rulingDClassOnly, contractsRevertIntact, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Cycle-1 focused re-review at the new head: (a) the projects verifier named test passes at the head (red-before/green-after, not skipped), (b) lock parity: the wave-introduced resolution diffs are gone (measured head-vs-main), (c) pglite still pinned 0.5.4 + knowledge suite exit 0, (d) CI exists at this head and is 5/5 green or exactly the RULING D loops class + green elsewhere, (e) mergeability vs CURRENT origin/main (merge-tree clean), (f) verified surfaces preserved (bun-types x5 + workspace locators, contracts revert, version-only diff class + RULING B/C, secrets), (g) no stray non-version paths. Post '[REVIEW] <GO|NO_GO> — wave670 @ <sha> — lens: wave successor cycle-1 lock-parity remediation, reviewer wave670-ship-r5-review' to #apps. Block ONLY concrete P0/P1 defects; max two cycles on this candidate. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge 670 --squash --body-file ending 'Agent: wave670-ship-r5-ship', record merged sha, post [SHIP-READY] on git-publishing with the bumped package set (name@version per package, count, read from the merged head's package.json files — NEVER the PR body) + merged sha — publish-all consumes it (the ONLY publisher). If NO_GO: comment findings + resume condition, leave open, no [SHIP-READY] (cycle-2 available on this candidate). Return (JSON): { merged, mergedSha, shipReadyPosted, bumpSet: {count, packages: [string]}, residue: [] }
`

const FIX_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, depPinsRestored: { type: 'object' }, lockParity: { type: 'object' }, keptSurfaces: { type: 'array' }, verifierRc: { type: 'number' }, frozenInstallRc: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed'] }
const VERIFY_SCHEMA = { type: 'object', properties: { ciGreen: { type: 'boolean' }, checks: { type: 'array' }, installRc: { type: 'number' }, verifier: { type: 'object' }, lockParity: { type: 'object' }, knowledgeSuite: { type: 'object' }, rulingDClassOnly: { type: 'boolean' }, contractsRevertIntact: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['ciGreen', 'checks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, shipReadyPosted: { type: 'boolean' }, bumpSet: { type: 'object' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Fix')
const fix = await agent(FIX, { label: 'wave670-r5-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' })

phase('Verify')
const verify = fix && fix.pushed ? await agent(VERIFY, { label: 'wave670-r5-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'wave670-r5-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'fix/verify did not complete', detail: JSON.stringify({ fix, verify }) }] }

phase('Ship')
const ship = review && review.verdict === 'GO'
  ? await agent(SHIP, { label: 'wave670-r5-ship', phase: 'Ship', schema: SHIP_SCHEMA })
  : { merged: false, mergedSha: null, shipReadyPosted: false, bumpSet: null, residue: ['NO_GO — successor candidate cycle-2 available'] }

return { fix: fix && { newHead: fix.newHead, lockParity: fix.lockParity, depPinsRestored: fix.depPinsRestored }, verify: verify && { ciGreen: verify.ciGreen, verifier: verify.verifier, lockParity: verify.lockParity }, review: review && review.verdict, ship }
