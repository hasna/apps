export const meta = {
  name: 'wave670-ship-r3',
  description: 'Wave #670 cycle-2 (FINAL remediation cycle per the bounded-review policy): the reviewer\'s resume condition (review 717108) — the lock fix is VERIFIED at 605f44b9 (bun-types@1.4.0 x5 + workspace locators, fresh frozen install rc=0, secrets clean) but the head has no CI run and PR #670 is CONFLICTING vs origin/main 36f771705 (content conflict in apps/knowledge/bin/knowledge.js). This lane: rebase release/version-wave onto current origin/main (the push creates the fresh CI run), re-verify, cycle-2 focused re-review of the named defect + direct regressions ONLY, base gate, merge, [SHIP-READY].',
  phases: [
    { title: 'Rebase', detail: 'rebase wave onto 36f771705, resolve knowledge.js, keep lock + contracts revert + RULING B, push' },
    { title: 'Verify', detail: 'fresh CI at the new head + frozen-lockfile rc=0' },
    { title: 'Review', detail: 'cycle-2 focused Fable re-review (named defect + direct regressions only)' },
    { title: 'Ship', detail: 'base gate + merge + [SHIP-READY]' },
  ],
}

const CONST = `
You are the wave670-ship-r3 lane (owner-authorized, wave #670 cycle-2 FINAL remediation). Final text = machine-readable JSON.

Context (measured, review 717108): the cycle-1 lock fix is VERIFIED at head 605f44b9e4aaf11c95b1651ff32b41950dd7dbff — bun.lock carries the five bun-types@1.4.0 member entries (diff vs ed93f9b528 = +10 lines, bun.lock only; workspace-locators present for economy/files/sheets/slides/tables), fresh-checkout 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules), lock-diff secrets scan rc=0 findingCount 0 (4,970 bytes). TWO BLOCKING GATES remain: (1) no CI run exists at 605f44b9 (actions/runs?head_sha=605f44b9 total_count 0 at 18:13Z while six other runs started in the same window — platform healthy); (2) PR #670 is CONFLICTING with current origin/main 36f771705 (merge-tree --write-tree rc=1, content conflict in apps/knowledge/bin/knowledge.js, siblings auto-merged). REVIEWER REMEDIATION PATH (verbatim): rebase release/version-wave onto current origin/main (resolves the conflict; that push creates the fresh CI run), re-push, then cycle-2 re-review of the named defect and its direct regressions only.

THIS IS CYCLE 2 — the FINAL remediation cycle. The cycle-1 verified surfaces (lock fix, contracts revert, RULING B/C diff class, changesets, secrets) must be preserved through the rebase; the re-review is focused on the named defect + direct regressions. A third NO_GO terminates the candidate.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: confirm #670 is still OPEN and unmerged (gh pr view 670), confirm the current head is still 605f44b9 and origin/main is 36f771705 (re-measure if either moved; if #670 merged while dispatching, verify the merge + stop).
- /home/hasna/workspace/repos/hasna/apps is READ/context only. Sync first (git -C <checkout> fetch origin main -q; never discard local work). File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/wave670-ship-r3 cut from origin/main. Work on the release/version-wave branch (fetch from origin); this is the existing wave PR #670 — rebase/force-push per the wave lineage, never a duplicate PR. Commits end with 'Agent: wave670-ship-r3-<role>' (the ONLY attribution line; never Co-Authored-By).
- REBASE onto current origin/main (36f771705): resolve the apps/knowledge/bin/knowledge.js content conflict keeping BOTH sides where possible — the wave's version stamp (RULING B surface) AND main's content changes since the wave's base; never drop a version bump silently, never drop main's fixes. KEEP: the lock fix (bun-types@1.4.0 x5 + workspace locators), the contracts revert (50/50 byte-identical vs origin/main), the RULING B/C surfaces. If main's #700 lock regen conflicts with the wave's lock, keep the wave's regenerated lock (it is version-consistent with the wave and carries the bun-types members) and re-verify with a fresh frozen install. Do NOT touch version numbers or changesets.
- VERIFY at the new head: fresh-checkout 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, full prepare scripts, zero node_modules); CI per-check table (gh api actions/runs?head_sha=<sha> + per-job conclusions) — CI MUST exist at this head (the push creates it; if the run is still queued, wait with bounded polling and record the window); classify 5/5 green, or green-with-RULING-D-loops-class-only (unbacked == ["loops"]), or FAIL (name the failing check exactly); versioning suite with only the two documented classes; secrets scan clean.
- REVIEW (cycle-2 focused): re-review ONLY the named defect (CI presence + mergeability at the new head) and direct regressions of the rebase (diff class, contracts revert, lock fix, secrets — re-verify if the rebase changed anything beyond the conflict resolution). Post '[REVIEW] <GO|NO_GO> — wave670 @ <new sha> — lens: wave final chain cycle-2 rebase remediation, reviewer wave670-ship-r3-review' to #apps. Two remediation cycles max — this is cycle 2.
- SHIP: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge 670 --squash --body-file ending 'Agent: wave670-ship-r3-ship', record merged sha, post [SHIP-READY] on git-publishing with the bumped package set (name@version per package, count) + merged sha — publish-all is the ONLY publisher and consumes it.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on PR #670 and #board. English. Distinguish measured vs inferred; state what you did not check.
`

const REBASE = CONST + `
ROLE: rebase lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Rebase release/version-wave onto origin/main 36f771705; resolve the knowledge.js conflict per CONST; keep the lock fix + contracts revert + RULING B/C surfaces; fresh frozen install rc=0 in the worktree; commit; force-push the wave branch (this push creates the fresh CI run). Return (JSON): { newHead, conflicts: [{file, resolution}], keptSurfaces: [string], frozenInstallRc, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head (sha in the rebase result): fresh-checkout 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, full prepare scripts, zero node_modules); CI per-check table at the head (gh api actions/runs?head_sha=<sha> + per-job conclusions — wait with bounded polling if the run is still queued; CI MUST exist at this head); versioning suite with only the two documented classes; contracts revert spot-check (50/50 byte-identical vs origin/main); secrets scan clean. Classify: 5/5 green, or green-with-RULING-D-loops-class-only, or FAIL (name the failing check exactly). Return (JSON): { ciGreen, checks: [{name, conclusion}], installRc, rulingDClassOnly, contractsRevertIntact, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Cycle-2 focused re-review at the new head: (a) CI exists at this head and is 5/5 green or exactly the RULING D loops class + green elsewhere, (b) mergeability vs CURRENT origin/main (merge-tree clean), (c) the rebase preserved the cycle-1 verified surfaces (lock fix bun-types x5 + workspace locators, contracts revert, version-only diff class, secrets), (d) the knowledge.js conflict resolution kept both sides (wave version stamp + main's content). Re-review ONLY the named defect + direct regressions; do NOT relitigate already-passed surfaces unless the rebase changed them. Post '[REVIEW] <GO|NO_GO> — wave670 @ <sha> — lens: wave final chain cycle-2 rebase remediation, reviewer wave670-ship-r3-review' to #apps. Block ONLY concrete P0/P1 defects; this is cycle 2 — the final remediation cycle. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge 670 --squash --body-file ending 'Agent: wave670-ship-r3-ship', record merged sha, post [SHIP-READY] on git-publishing with the bumped package set (name@version per package, count) + merged sha — publish-all consumes it (the ONLY publisher). If NO_GO: comment findings + resume condition, leave open, no [SHIP-READY] (cycle cap reached — do not dispatch further remediation). Return (JSON): { merged, mergedSha, shipReadyPosted, bumpSet: {count, packages: [string]}, residue: [] }
`

const REBASE_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, conflicts: { type: 'array' }, keptSurfaces: { type: 'array' }, frozenInstallRc: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed'] }
const VERIFY_SCHEMA = { type: 'object', properties: { ciGreen: { type: 'boolean' }, checks: { type: 'array' }, installRc: { type: 'number' }, rulingDClassOnly: { type: 'boolean' }, contractsRevertIntact: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['ciGreen', 'checks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, shipReadyPosted: { type: 'boolean' }, bumpSet: { type: 'object' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Rebase')
const rebase = await agent(REBASE, { label: 'wave670-r3-rebase', phase: 'Rebase', schema: REBASE_SCHEMA, model: 'opus' })

phase('Verify')
const verify = rebase && rebase.pushed
  ? await agent(VERIFY, { label: 'wave670-r3-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' })
  : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'wave670-r3-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'rebase/verify did not complete', detail: JSON.stringify({ rebase, verify }) }] }

phase('Ship')
const ship = review && review.verdict === 'GO'
  ? await agent(SHIP, { label: 'wave670-r3-ship', phase: 'Ship', schema: SHIP_SCHEMA })
  : { merged: false, mergedSha: null, shipReadyPosted: false, bumpSet: null, residue: ['NO_GO — cycle cap reached; candidate terminated'] }

return { rebase: rebase && { newHead: rebase.newHead, conflicts: rebase.conflicts }, verify: verify && { ciGreen: verify.ciGreen, rulingDClassOnly: verify.rulingDClassOnly }, review: review && review.verdict, ship }
