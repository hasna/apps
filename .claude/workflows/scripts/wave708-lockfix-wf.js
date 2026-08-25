export const meta = {
  name: 'wave708-lockfix',
  description: 'Wave #708 (release/version-wave-3 @ 934bb0718, 33 bumps) REVIEW NO_GO: P1 bun.lock not regenerated for the wave dependency-range updates — all 5 CI checks red at Install (lockfile-frozen). This lane: regenerate bun.lock at the wave head, verify frozen install rc=0 + CI green, one Fable review, base gate, merge, [SHIP-READY].',
  phases: [
    { title: 'Fix', detail: 'regenerate bun.lock at the wave head, commit, push' },
    { title: 'Verify', detail: 'frozen install rc=0 + CI per-check at the new head' },
    { title: 'Review', detail: 'one Fable adversarial review' },
    { title: 'Ship', detail: 'base gate + merge + [SHIP-READY]' },
  ],
}

const CONST = `
You are the wave708-lockfix lane (owner-authorized; next-wave remediation for hasna/apps#708). Final text = machine-readable JSON.

Context (measured, review 2026-08-21): PR #708 'Version Packages' (release/version-wave-3, head 934bb0718) — 33 packages bumped from 23 changesets; REVIEW NO_GO with ONE P1: bun.lock not regenerated for the wave's dependency-range updates (26 package.json internal dep ranges updated: contracts -> 0.13.0, secrets -> 0.3.2, machines -> 0.2.31, browser -> 0.5.17, etc.) — CI run 32425288631 all 5 primary checks red at Install with the lockfile-frozen literal. Secondary note: secrets scan flagged 2 findings in apps/secrets/CHANGELOG.md:12 (npm_ env var NAMES, 16/19 chars — documented false positive, below the fleet npm value discriminator; the detector-shape fix ships in this same wave). Wave is the successor of the merged #670 (ff340cc40); no version numbers or changesets may change.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: confirm #708 is still OPEN and unmerged (gh pr view 708); confirm head 934bb0718 and origin/main ff340cc40 (re-measure if moved); read the NO_GO review comment on #708 (exact text).
- /home/hasna/workspace/repos/hasna/apps is READ/context only. Sync first (git -C <checkout> fetch origin main -q; never discard local work). File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/wave708-lockfix cut from origin/main. Work on the release/version-wave-3 branch (fetch from origin) — the existing wave PR #708, never a duplicate PR. Commits end with 'Agent: wave708-lockfix-<role>' (the ONLY attribution line; never Co-Authored-By).
- FIX: regenerate bun.lock at the wave head so the wave's dependency-range updates resolve (bun install --lockfile-only or equivalent under no-quarantine resolution — exact-name minimumReleaseAgeExcludes if the quarantine blocks a resolution, never lower the quarantine). Do NOT touch version numbers or changesets. Keep the diff version/lock/changeset-class only.
- VERIFY: fresh-checkout 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules); CI per-check table at the new head (gh api actions/runs?head_sha=<sha> + per-job conclusions; wait with bounded polling) — 5/5 green or exactly the RULING D loops class; secrets scan: the two changelog findings are the documented false-positive class (npm_ env var NAMES) — re-scan and classify; lock diff vs main contains only wave-introduced resolution entries.
- REVIEW (one Fable adversarial reviewer): (a) the lockfile P1 is fixed (frozen install rc=0 at the head, CI green at the head or RULING D only), (b) no version/changeset changes beyond the wave's own, (c) secrets classified (false positives documented, no real credential), (d) mergeability vs CURRENT origin/main (merge-tree). Post '[REVIEW] <GO|NO_GO> — wave708 @ <sha> — lens: next-wave lockfile remediation, reviewer wave708-lockfix-review' to #board.
- SHIP: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge 708 --squash --body-file ending 'Agent: wave708-lockfix-ship', record merged sha, post [SHIP-READY] on git-publishing with the bumped package set (read from the merged head's package.json files — NEVER the PR body) + merged sha. publish-all is the ONLY publisher — this lane never calls npm publish.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on PR #708 and #board. English. Distinguish measured vs inferred; state what you did not check.
`

const FIX = CONST + `
ROLE: fix lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Regenerate bun.lock at the wave head so the wave's dependency-range updates resolve; commit; force-push release/version-wave-3. Return (JSON): { newHead, lockSummary, frozenInstallRc, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head: fresh-checkout 'bun install --frozen-lockfile' rc=0 (literal output); CI per-check table (gh api actions/runs?head_sha=<sha> + per-job conclusions, bounded polling) — 5/5 green or exactly the RULING D loops class; secrets scan re-run and classified (the two changelog false positives documented); lock diff vs main = wave-introduced resolutions only. Return (JSON): { ciGreen, checks: [{name, conclusion}], installRc, lockDiffClass, secretsClassified, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). One review at the new head: (a) lockfile P1 fixed (frozen install rc=0, CI green or RULING D only at the head), (b) no version/changeset changes beyond the wave's own, (c) secrets classified (no real credential; false positives documented), (d) mergeability vs CURRENT origin/main (merge-tree clean). Post '[REVIEW] <GO|NO_GO> — wave708 @ <sha> — lens: next-wave lockfile remediation, reviewer wave708-lockfix-review' to #board. Block ONLY concrete P0/P1 defects. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge 708 --squash --body-file ending 'Agent: wave708-lockfix-ship', record merged sha, post [SHIP-READY] on git-publishing with the bumped package set (name@version per package, count, read from the merged head's package.json files — NEVER the PR body) + merged sha. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, shipReadyPosted, bumpSet: {count, packages: [string]}, residue: [] }
`

const FIX_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, lockSummary: { type: 'string' }, frozenInstallRc: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed'] }
const VERIFY_SCHEMA = { type: 'object', properties: { ciGreen: { type: 'boolean' }, checks: { type: 'array' }, installRc: { type: 'number' }, lockDiffClass: { type: 'string' }, secretsClassified: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['ciGreen', 'checks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, shipReadyPosted: { type: 'boolean' }, bumpSet: { type: 'object' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Fix')
const fix = await agent(FIX, { label: 'wave708-lockfix-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' })

phase('Verify')
const verify = fix && fix.pushed ? await agent(VERIFY, { label: 'wave708-lockfix-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'wave708-lockfix-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'fix/verify did not complete', detail: JSON.stringify({ fix, verify }) }] }

phase('Ship')
const ship = review && review.verdict === 'GO'
  ? await agent(SHIP, { label: 'wave708-lockfix-ship', phase: 'Ship', schema: SHIP_SCHEMA })
  : { merged: false, mergedSha: null, shipReadyPosted: false, bumpSet: null, residue: ['NO_GO — remediation lane must re-enter per findings'] }

return { fix: fix && { newHead: fix.newHead, frozenInstallRc: fix.frozenInstallRc }, verify: verify && { ciGreen: verify.ciGreen, checks: verify.checks }, review: review && review.verdict, ship }
