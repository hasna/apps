export const meta = {
  name: 'wave670-ship',
  description: 'Wave #670 final chain: the main-side knowledge suite budget fix merged (PR #699, 77bb3e1a) — the last wave blocker. This lane: rebase release/version-wave onto the new origin/main KEEPING the contracts-range revert + regenerated lockfile (the wave670r cycle-7 precedent), drop changesets consumed by early publishes (todos-9b050845 if @hasna/todos@0.15.36 published), verify CI 5/5 at the new head (loops changeset-accompaniment class is RULING D acceptable), Fable review, base gate, merge, [SHIP-READY] with the bump set on git-publishing for publish-all.',
  phases: [
    { title: 'Rebase', detail: 'rebase wave onto new main, keep revert + lockfile, drop consumed changesets' },
    { title: 'Verify', detail: 'CI 5/5 at new head + changeset-version consistency' },
    { title: 'Review', detail: 'Fable adversarial review at the new head' },
    { title: 'Ship', detail: 'base gate + merge + [SHIP-READY]' },
  ],
}

const CONST = `
You are the wave670-ship lane (owner-authorized final chain for the hasna/apps version wave). Final text = machine-readable JSON.

Context (measured): wave PR hasna/apps#670 (release/version-wave, label ship-latest) has been open since 00:51Z through 7 remediation cycles; the last blocker — the main-side @hasna/knowledge suite budget (PR #699 merged 77bb3e1a) — has landed. The wave carries 72 pending changesets / ~40 packages; the pre-wave publish of @hasna/todos@0.15.36 was intented (git-publishing 716921) — if published, its changeset (todos-9b050845-bounded-remote-timeout.md) is consumed and must be dropped from the wave at rebase (verify against the registry, not assumption). Prior wave670r precedent: the wave must carry the contracts-range revert (35 lines == origin/main values) and the regenerated bun.lock; RULING B surfaces (11 version.ts literals + openapi + recordings Info.plist + member test literals + machines template floor + notes literal + knowledge bin/dist) are the authorized non-version paths; the loops changeset-accompaniment class is RULING D acceptable at merge.

Non-negotiable rules:
- /home/hasna/workspace/repos/hasna/apps is READ/context only. Sync first (git -C <checkout> fetch origin main -q; never discard local work). File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/wave670-ship cut from origin/main. Work on the release/version-wave branch (fetch it from origin); PR-first discipline applies (this is the existing wave PR #670 — rebase + force-push the branch per the wave lineage, never create a duplicate PR). Commits end with 'Agent: wave670-ship-<role>' (the ONLY attribution line; never Co-Authored-By).
- IDEMPOTENCY CHECK FIRST: confirm #670 is still OPEN and unmerged before any work (gh pr view 670); if it merged while this lane was dispatching, verify the merge + stop.
- Rebase onto CURRENT origin/main keeping: the 35 contracts-range revert lines (== origin/main values), the regenerated bun.lock, the RULING B surfaces. Drop changesets whose packages were published outside the wave since the wave was cut (verify each candidate against npm view with the lane token, never by assumption). Resolve conflicts by keeping the wave's version-only + authorized surfaces — never by dropping a version bump silently.
- Verify: CI 5/5 at the new head (gh run list + per-check conclusions; the loops changeset-accompaniment class FAIL is RULING D acceptable ONLY if it is exactly that class and nothing else; the knowledge build+test must now PASS with the merged budget fix); fresh-checkout 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, full prepare scripts) in a fresh worktree; changeset-version consistency (versioning suite) with only the two documented classes; secrets scan clean.
- Base-movement gate before merge: <merge-ref>^{tree} == <head>^{tree} at CURRENT origin/main.
- Merge: gh pr merge 670 --squash --body-file ending 'Agent: wave670-ship-ship'; record the merged sha; post [SHIP-READY] on git-publishing with the bumped package set (name + version per package, count) and the merged sha — publish-all is the ONLY publisher and consumes [SHIP-READY].
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on PR #670 and #board. English. Distinguish measured vs inferred; state what you did not check.
`

const REBASE = CONST + `
ROLE: rebase lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Rebase release/version-wave onto origin/main keeping the contracts revert + lockfile + RULING B surfaces; drop consumed changesets verified against the registry; resolve conflicts per CONST. Push the rebased branch (force-push per the wave lineage; the branch is the wave PR's own branch — never create a duplicate PR). Return (JSON): { newHead, droppedChangesets: [string], keptSurfaces: [string], conflicts: [{file, resolution}], pushed }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the rebased head (sha in the rebase result): fresh-checkout 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, full prepare scripts, zero node_modules); CI per-check table at the head (gh api actions/runs?head_sha=<sha> + per-job conclusions); versioning suite with only the two documented classes; changeset-version consistency. Classify: CI 5/5 green, or green-with-RULING-D-loops-class-only, or FAIL (name the failing check exactly). Return (JSON): { ciGreen, checks: [{name, conclusion}], installRc, suiteCounts: {passed, failed}, rulingDClassOnly, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review the rebased wave at the new head: (a) the diff vs origin/main is version-only + the authorized RULING B surfaces (no stray non-version paths), (b) the contracts revert and lockfile are intact, (c) dropped changesets are all verified-consumed (registry evidence), (d) CI state is 5/5 green or exactly the RULING D loops class + green elsewhere, (e) secrets clean. Post '[REVIEW] <GO|NO_GO> — wave670 @ <sha> — lens: wave final chain, reviewer wave670-ship-review' to #apps. Block ONLY concrete P0/P1 defects; two remediation cycles max. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge 670 --squash --body-file ending 'Agent: wave670-ship-ship', record merged sha, post [SHIP-READY] on git-publishing: the bumped package set (name@version per package, count) + merged sha — publish-all consumes it (the ONLY publisher). If NO_GO: comment findings + resume condition, leave open, no [SHIP-READY]. Return (JSON): { merged, mergedSha, shipReadyPosted, bumpSet: {count, packages: [string]}, residue: [] }
`

const REBASE_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, droppedChangesets: { type: 'array' }, keptSurfaces: { type: 'array' }, conflicts: { type: 'array' }, pushed: { type: 'boolean' } }, required: ['newHead', 'pushed'] }
const VERIFY_SCHEMA = { type: 'object', properties: { ciGreen: { type: 'boolean' }, checks: { type: 'array' }, installRc: { type: 'number' }, suiteCounts: { type: 'object' }, rulingDClassOnly: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['ciGreen', 'checks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, shipReadyPosted: { type: 'boolean' }, bumpSet: { type: 'object' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Rebase')
const rebase = await agent(REBASE, { label: 'wave670-rebase', phase: 'Rebase', schema: REBASE_SCHEMA, model: 'opus' })

phase('Verify')
const verify = rebase && rebase.pushed
  ? await agent(VERIFY, { label: 'wave670-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' })
  : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'wave670-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'rebase/verify did not complete', detail: JSON.stringify({ rebase, verify }) }] }

phase('Ship')
const ship = review && review.verdict === 'GO'
  ? await agent(SHIP, { label: 'wave670-ship', phase: 'Ship', schema: SHIP_SCHEMA })
  : { merged: false, mergedSha: null, shipReadyPosted: false, bumpSet: null, residue: ['NO_GO — rebase lane must remediate per findings'] }

return { rebase: rebase && { newHead: rebase.newHead, dropped: rebase.droppedChangesets }, verify: verify && { ciGreen: verify.ciGreen, rulingDClassOnly: verify.rulingDClassOnly }, review: review && review.verdict, ship }
