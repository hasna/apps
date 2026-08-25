export const meta = {
  name: 'wave670-ship-r2',
  description: 'Wave #670 cycle-1 remediation (reviewer resume condition, review 717085): CI 0/5 at ed93f9b528 — "error: lockfile had changes, but lockfile is frozen". Root cause: the committed bun.lock lacks bun-types@1.4.0 and the workspace-locator entries for @hasna/{economy,files,sheets,slides,tables} (the five "bun-types": "latest" members); the station-side release-age quarantine masked the omission on regenerate. This lane: regenerate bun.lock under CI-equivalent (no-quarantine) resolution, re-push, fresh CI, focused Fable re-review of the named defect + direct regressions, base gate, merge, [SHIP-READY].',
  phases: [
    { title: 'Lock', detail: 'regenerate bun.lock under no-quarantine resolution, keep all passed surfaces, push' },
    { title: 'Verify', detail: 'fresh CI at the new head + frozen-lockfile rc=0' },
    { title: 'Review', detail: 'Fable focused re-review (named defect only + direct regressions)' },
    { title: 'Ship', detail: 'base gate + merge + [SHIP-READY]' },
  ],
}

const CONST = `
You are the wave670-ship-r2 lane (owner-authorized, cycle-1 remediation of the wave #670 final chain). Final text = machine-readable JSON.

Context (measured, review 717085): wave PR hasna/apps#670 (release/version-wave, label ship-latest) was reviewed NO_GO at head ed93f9b52856129712fe6f045811a94b49698391 — CI run 32399111271, 0/5, ALL five jobs failed at the Install step with "error: lockfile had changes, but lockfile is frozen". NOT the RULING D loops class — a hard install blocker. Root cause corroborated in the committed bun.lock: zero bun-types@1.4.0 entries and no workspace-locator entries for @hasna/{economy,files,sheets,slides,tables} (the five members declaring "bun-types": "latest"), which a cold no-quarantine CI install resolves — the station-side release-age quarantine masks the omission. ALL OTHER GATES PASSED at that head: diff vs origin/main is version-only + the authorized RULING B/C surfaces (162 paths); contracts revert intact (50/50 @hasna/contracts dependency lines byte-identical vs origin/main); dropped changesets 38/38 wave target versions absent from the registry (todos-9b050845 consumed into the wave's 0.15.36 changelog — @hasna/todos@0.15.36 is NOT published, the intent 716921 has no confirm); secrets scan rc=0 findingCount 0 on both streams (390,566 bytes); base-movement gate merge-tree == head tree at current origin/main (55855db6).

RESUME CONDITION (verbatim from the reviewer): regenerate bun.lock under CI-equivalent (no-quarantine) resolution and re-push; fresh CI, then re-review. After the install clears, test-suites may still show the loops changeset-accompaniment class (unbacked == ["loops"]) — acceptable at merge under RULING D option (i).

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: confirm #670 is still OPEN and unmerged (gh pr view 670), confirm the current head is still ed93f9b528 (if it moved or merged, re-measure and stop — do NOT duplicate another lane's work), and read review 717085 (conversations show 717085) before doing anything.
- /home/hasna/workspace/repos/hasna/apps is READ/context only. Sync first (git -C <checkout> fetch origin main -q; never discard local work). File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/wave670-ship-r2 cut from origin/main. Work on the release/version-wave branch (fetch from origin); PR-first discipline (this is the existing wave PR #670 — rebase/force-push the branch per the wave lineage, never create a duplicate PR). Commits end with 'Agent: wave670-ship-r2-<role>' (the ONLY attribution line; never Co-Authored-By).
- LOCK REGENERATION under CI-equivalent resolution: the sanctioned quarantine mechanism is the exact-name minimumReleaseAgeExcludes list in ~/.bunfig.toml — add the exact names needed for the fresh resolve (bun-types, plus any package the no-quarantine resolve needs that the quarantine blocks; scope wildcards are NOT honoured). NEVER lower or bypass minimumReleaseAge itself. Then 'bun install' in the worktree to regenerate bun.lock. Verify the regenerated lock NOW carries: bun-types@1.4.0 entries AND workspace-locator entries for @hasna/{economy,files,sheets,slides,tables}. Keep the contracts revert (50/50 byte-identical vs origin/main) and the RULING B/C surfaces intact. Do NOT touch version numbers or changesets. Commit only the lockfile (+ any exact-name excludes change is a ~/.bunfig.toml edit on the station, NOT a commit — say what you changed there). Push (force-push per the wave lineage).
- VERIFY: fresh-checkout 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, full prepare scripts, zero node_modules) — this MUST now pass; CI per-check table at the new head (gh api actions/runs?head_sha=<sha> + per-job conclusions); classify 5/5 green, or green-with-RULING-D-loops-class-only (unbacked == ["loops"]), or FAIL (name the failing check exactly); versioning suite with only the two documented classes; secrets scan clean.
- REVIEW (focused re-review, cycle 1): re-review ONLY the named defect (lockfile/install state at the new head) and its direct regressions — do NOT relitigate the already-passed surfaces (diff class, contracts revert, changesets, secrets, base gate) unless the new head changed them. Post '[REVIEW] <GO|NO_GO> — wave670 @ <new sha> — lens: wave final chain cycle-1 lock remediation, reviewer wave670-ship-r2-review' to #apps. Two remediation cycles max per the bounded-review policy.
- SHIP: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge 670 --squash --body-file ending 'Agent: wave670-ship-r2-ship', record merged sha, post [SHIP-READY] on git-publishing with the bumped package set (name@version per package, count) + merged sha — publish-all is the ONLY publisher and consumes it.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on PR #670 and #board. English. Distinguish measured vs inferred; state what you did not check.
`

const LOCK = CONST + `
ROLE: lock lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Add the exact-name quarantine excludes (bun-types + whatever the fresh resolve needs) to ~/.bunfig.toml minimumReleaseAgeExcludes (station config — never lower the quarantine), regenerate bun.lock in the wave worktree, verify the lock now carries bun-types@1.4.0 + the five workspace locators, keep contracts revert + RULING B/C surfaces, commit the lock only, force-push the wave branch. Return (JSON): { newHead, lockFixed: {bunTypesEntries, workspaceLocators: [string]}, bunfigExcludesAdded: [string], pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head (sha in the lock result): fresh-checkout 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, full prepare scripts, zero node_modules); CI per-check table at the head (gh api actions/runs?head_sha=<sha> + per-job conclusions); versioning suite with only the two documented classes. Classify: 5/5 green, or green-with-RULING-D-loops-class-only, or FAIL (name the failing check exactly). Return (JSON): { ciGreen, checks: [{name, conclusion}], installRc, rulingDClassOnly, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Focused re-review at the new head: (a) the lockfile now carries bun-types@1.4.0 + the five workspace locators and fresh-checkout frozen install rc=0, (b) CI is 5/5 green or exactly the RULING D loops class + green elsewhere, (c) the previously-passed surfaces are unchanged by the lock fix (diff class, contracts revert, changesets, secrets — re-verify only if the new head differs from ed93f9b528 in more than the lockfile), (d) secrets clean. Post '[REVIEW] <GO|NO_GO> — wave670 @ <sha> — lens: wave final chain cycle-1 lock remediation, reviewer wave670-ship-r2-review' to #apps. Block ONLY the named defect and its direct regressions; two remediation cycles max. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge 670 --squash --body-file ending 'Agent: wave670-ship-r2-ship', record merged sha, post [SHIP-READY] on git-publishing with the bumped package set (name@version per package, count) + merged sha — publish-all consumes it (the ONLY publisher). If NO_GO: comment findings + resume condition, leave open, no [SHIP-READY]. Return (JSON): { merged, mergedSha, shipReadyPosted, bumpSet: {count, packages: [string]}, residue: [] }
`

const LOCK_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, lockFixed: { type: 'object' }, bunfigExcludesAdded: { type: 'array' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed'] }
const VERIFY_SCHEMA = { type: 'object', properties: { ciGreen: { type: 'boolean' }, checks: { type: 'array' }, installRc: { type: 'number' }, rulingDClassOnly: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['ciGreen', 'checks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, shipReadyPosted: { type: 'boolean' }, bumpSet: { type: 'object' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Lock')
const lock = await agent(LOCK, { label: 'wave670-r2-lock', phase: 'Lock', schema: LOCK_SCHEMA, model: 'opus' })

phase('Verify')
const verify = lock && lock.pushed
  ? await agent(VERIFY, { label: 'wave670-r2-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' })
  : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'wave670-r2-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'lock/verify did not complete', detail: JSON.stringify({ lock, verify }) }] }

phase('Ship')
const ship = review && review.verdict === 'GO'
  ? await agent(SHIP, { label: 'wave670-r2-ship', phase: 'Ship', schema: SHIP_SCHEMA })
  : { merged: false, mergedSha: null, shipReadyPosted: false, bumpSet: null, residue: ['NO_GO — lock lane must remediate per findings'] }

return { lock: lock && { newHead: lock.newHead, lockFixed: lock.lockFixed }, verify: verify && { ciGreen: verify.ciGreen, rulingDClassOnly: verify.rulingDClassOnly }, review: review && review.verdict, ship }
