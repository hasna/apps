export const meta = {
  name: 'wave708-rebase-remediation',
  description: 'Wave #708 cycle-2 remediation: REVIEW NO_GO #2 (718094) — main advanced to 855a4d1b5 (automations 0.3.0 landed via PR 710); conflicts in automations CHANGELOG/package.json + bun.lock. This lane: rebase release/version-wave-3 onto CURRENT origin/main, resolve per evidence (automations changeset consumed by PR 710 -> drop the wave automations entry; else bump from 0.3.0), regen bun.lock, verify frozen install + CI, one Fable focused cycle-2 review, base gate, merge, [SHIP-READY].',
  phases: [
    { title: 'Rebase', detail: 'rebase #708 onto CURRENT origin/main, resolve automations conflicts per evidence' },
    { title: 'Verify', detail: 'frozen install rc=0 + CI per-check at the new head' },
    { title: 'Review', detail: 'one Fable focused cycle-2 review' },
    { title: 'Ship', detail: 'base gate + merge + [SHIP-READY]' },
  ],
}

const CONST = `
You are the wave708-rebase-remediation lane (owner-authorized; cycle-2 remediation of hasna/apps#708). Final text = machine-readable JSON.

Context (measured, review 718094/718098 2026-08-21): PR #708 'Version Packages' (release/version-wave-3, head fe0055234, 33 bumps) — cycle-1 lockfile remediation REVIEW NO_GO #2: lock/scope/secrets pass, but CURRENT origin/main is 855a4d1b5 (main advanced after the wave branch was pushed — automations 0.3.0 landed via PR 710, consuming the automations changeset), and the wave branch conflicts with it in automations CHANGELOG.md, automations package.json, and bun.lock. The wave is the successor of the merged #670 (ff340cc40). This is remediation cycle-2 on the same review lineage — a focused re-review of the named defects only.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: confirm #708 is still OPEN and unmerged (gh pr view 708); confirm CURRENT origin/main sha (gh api repos/hasna/apps/commits/heads/main --jq .sha — must be 855a4d1b5 or newer); read the NO_GO review comments on #708 (718094 exact text). If #708 already merged, verify + record + stop.
- /home/hasna/workspace/repos/hasna/apps is READ/context only. Sync first (git -C <checkout> fetch origin main -q; never discard local work). File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/wave708-rebase-remediation cut from origin/main. Work on the existing release/version-wave-3 branch (fetch from origin) — the existing wave PR #708, never a duplicate PR. Commits end with 'Agent: wave708-rebase-remediation-<role>' (the ONLY attribution line; never Co-Authored-By).
- REBASE: rebase release/version-wave-3 onto CURRENT origin/main (855a4d1b5). Resolve the automations conflicts per EVIDENCE, not preference: read .changeset/*.md on the wave branch — if the automations changeset was consumed by PR 710's release (the bump target it names was already released as 0.3.0 on main), DROP the wave's automations entry (changeset file, package.json bump, CHANGELOG delta) so main's 0.3.0 stands; if the wave carries a NEW automations changeset not yet released, keep it and bump from 0.3.0. Record which decision the evidence forced. Then regenerate bun.lock at the resolved head so all wave dependency-range updates resolve. Do NOT touch any other version numbers or changesets. Keep the diff version/lock/changeset-class only.
- VERIFY: fresh-checkout 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules); CI per-check table at the new head (gh api actions/runs?head_sha=<sha> + per-job conclusions; wait with bounded polling) — 5/5 green or exactly the RULING D loops class; secrets scan re-run and classified (the two changelog npm_-name false positives documented); lock diff vs main contains only wave-introduced resolution entries; the automations resolution matches the evidence decision.
- REVIEW (one Fable adversarial reviewer — focused cycle-2): (a) the named defects are fixed: rebase onto CURRENT main clean (no stray conflicts), automations resolution matches the evidence (consumed changeset dropped OR new changeset bumped — not guessed), bun.lock regenerated, frozen install rc=0, CI green or RULING D only at the head, (b) no OTHER version/changeset changes beyond the wave's own (the rebase did not alter unrelated bumps), (c) secrets classified, (d) mergeability vs CURRENT origin/main (merge-tree clean). Post '[REVIEW] <GO|NO_GO> — wave708 @ <sha> — lens: next-wave rebase remediation cycle-2, reviewer wave708-rebase-remediation-review' to #board. Block ONLY concrete P0/P1 defects.
- SHIP: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge 708 --squash --body-file ending 'Agent: wave708-rebase-remediation-ship', record merged sha, post [SHIP-READY] on git-publishing with the ACTUAL bumped package set (read from the merged head's package.json files — NEVER the PR body; the automations count reflects the evidence resolution) + merged sha. publish-all is the ONLY publisher — this lane never calls npm publish.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on PR #708 and #board. English. Distinguish measured vs inferred; state what you did not check.
`

const REBASE = CONST + `
ROLE: rebase lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Rebase release/version-wave-3 onto CURRENT origin/main; resolve automations conflicts per the evidence decision; regen bun.lock; commit; force-push release/version-wave-3. Return (JSON): { currentMain, newHead, automationsDecision: 'consumed-dropped'|'new-changeset-bumped', automationsDecisionEvidence, conflictFiles: [string], frozenInstallRc, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head: fresh-checkout 'bun install --frozen-lockfile' rc=0 (literal output); CI per-check table (gh api actions/runs?head_sha=<sha> + per-job conclusions, bounded polling) — 5/5 green or exactly the RULING D loops class; secrets scan re-run and classified; lock diff vs main = wave-introduced resolutions only; automations package.json version matches the evidence decision. Return (JSON): { ciGreen, checks: [{name, conclusion}], installRc, lockDiffClass, secretsClassified, automationsVersion, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Focused cycle-2 review at the new head: (a) named defects fixed (rebase clean vs CURRENT main, automations resolution matches evidence, lock regenerated, frozen install rc=0, CI green or RULING D only), (b) no unrelated version/changeset changes introduced by the rebase, (c) secrets classified, (d) mergeability vs CURRENT origin/main (merge-tree clean). Post '[REVIEW] <GO|NO_GO> — wave708 @ <sha> — lens: next-wave rebase remediation cycle-2, reviewer wave708-rebase-remediation-review' to #board. Block ONLY concrete P0/P1 defects. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const SHIP = CONST + `
ROLE: ship lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge 708 --squash --body-file ending 'Agent: wave708-rebase-remediation-ship', record merged sha, post [SHIP-READY] on git-publishing with the ACTUAL bumped package set (name@version per package, count, read from the merged head's package.json files — NEVER the PR body) + merged sha. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, shipReadyPosted, bumpSet: {count, packages: [string]}, residue: [] }
`

const REBASE_SCHEMA = { type: 'object', properties: { currentMain: { type: 'string' }, newHead: { type: 'string' }, automationsDecision: { type: 'string' }, automationsDecisionEvidence: { type: 'string' }, conflictFiles: { type: 'array' }, frozenInstallRc: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'automationsDecision', 'pushed'] }
const VERIFY_SCHEMA = { type: 'object', properties: { ciGreen: { type: 'boolean' }, checks: { type: 'array' }, installRc: { type: 'number' }, lockDiffClass: { type: 'string' }, secretsClassified: { type: 'boolean' }, automationsVersion: { type: 'string' }, evidence: { type: 'string' } }, required: ['ciGreen', 'checks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const SHIP_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, shipReadyPosted: { type: 'boolean' }, bumpSet: { type: 'object' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Rebase')
const rebase = await agent(REBASE, { label: 'wave708-rebase', phase: 'Rebase', schema: REBASE_SCHEMA, model: 'opus' })

phase('Verify')
const verify = rebase && rebase.pushed ? await agent(VERIFY, { label: 'wave708-rebase-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'wave708-rebase-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'rebase/verify did not complete', detail: JSON.stringify({ rebase, verify }) }] }

phase('Ship')
const ship = review && review.verdict === 'GO'
  ? await agent(SHIP, { label: 'wave708-rebase-ship', phase: 'Ship', schema: SHIP_SCHEMA })
  : { merged: false, mergedSha: null, shipReadyPosted: false, bumpSet: null, residue: ['NO_GO — wave lineage terminates per bounded review (cycle-2 exhausted)'] }

return { rebase: rebase && { newHead: rebase.newHead, automationsDecision: rebase.automationsDecision }, verify: verify && { ciGreen: verify.ciGreen, checks: verify.checks }, review: review && review.verdict, ship }
