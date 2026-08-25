export const meta = {
  name: 'main-lockfile-fix',
  description: 'Main-side Fix Once: bun install --frozen-lockfile FAILS on merged hasna/apps main tip (run 32430869139: "lockfile had changes, but lockfile is frozen") — holding PRs 709/715 at GO and blocking ~20 queue PRs sharing the class. This lane: reproduce at origin/main, fix the lockfile at the source, prove frozen install rc=0 + CI green at head, one Fable review, merge, live-verify main tip.',
  phases: [
    { title: 'Investigate', detail: 'reproduce frozen-install failure on main tip, name the exact drifted entries' },
    { title: 'Fix', detail: 'smallest owned lockfile repair at origin/main, PR' },
    { title: 'Verify', detail: 'frozen install rc=0 fresh + CI per-check green at the head' },
    { title: 'Review', detail: 'one Fable adversarial review' },
    { title: 'Land', detail: 'base gate + merge + live-verify main tip frozen install' },
  ],
}

const CONST = `
You are the main-lockfile-fix lane CYCLE-2 REMEDIATION (owner-authorized; main-side Fix Once for the hasna/apps frozen-lockfile CI class). Final text = machine-readable JSON.

Context (measured 2026-08-21): cycle-1 of this lane opened PR #718 (branch main-lockfile-fix, head e5c06c08) regenerating bun.lock for the wave-717 drift (16 packages; local frozen install rc=0) but REVIEW NO_GO with two P1s: (P1-1) CI at the head is 0/5 — publish guard FAIL (18 apps npm pack --dry-run), test-suites FAIL, gates FAIL, build+test FAIL (turbo cyclic dep @hasna/secrets <-> @hasna/contracts), verify generated artifacts FAIL — and the cycle-1 fix report's remaining-failure set was inexact (omitted publish guard + build+test); (P1-2) PR-introduced regression: commit e5c06c0 retargets apps/contracts exports-map 'types' entries from ./dist/*.d.ts to ./types/*.d.ts (0 at main, 19 at head), breaking tests/testing/packed-consumer.test.ts (reproduced rc=1, expects package/dist/... paths). The main-side install failure (run 32430869139, 23:59:30Z, 'lockfile had changes, but lockfile is frozen') holds PRs 709/715 at GO and blocks ~20 queue PRs. This lane's purpose is to END the class on main — RULING D is NOT an acceptable residual.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: sync the checkout (git -C /home/hasna/workspace/repos/hasna/apps fetch origin main -q; never discard local work). Confirm PR #718 is OPEN with branch main-lockfile-fix (gh pr view 718). Reproduce BOTH: (a) fresh checkout of origin/main tip, 'bun install --frozen-lockfile' with zero node_modules — literal rc; (b) the packed-consumer failure at the current PR head — 'bun test tests/testing/packed-consumer.test.ts' rc=1 with the dist-vs-types literal. If main frozen install now passes rc=0, main recovered: record it, complete the lane with the evidence, STOP.
- WORK THE EXISTING PR #718 BRANCH main-lockfile-fix — NEVER a duplicate PR, never a new branch. File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/main-lockfile-fix (fetch the branch from origin; work on it; force-push only your own fixes). Commits end with 'Agent: main-lockfile-fix-<role>' (the ONLY attribution line; never Co-Authored-By). /home/hasna/workspace/repos/hasna/apps is READ/context only. Never push to main.
- FIX the two P1s at the root: (P1-2) restore the apps/contracts exports-map 'types' entries to ./dist/*.d.ts exactly as at origin/main (19 head entries -> 0) so the PR diff is LOCK-ONLY; re-run the packed-consumer test to green. (P1-1) then drive CI to 5/5 GREEN at the head: enumerate the EXACT failing check per job (gh api actions/runs?head_sha=<sha> + per-job conclusions, bounded polling) — gates, verify-generated artifacts, test-suites, build+test (the turbo secrets<->contracts cycle: fix the wiring at the root, do not classify away), publish guard (name which of the 18 apps fail npm pack --dry-run and why) — and fix each at the source. The stop condition is 5/5 green; report the exact remaining failures if a check cannot be fixed (never a partial or classified list).
- VERIFY: fresh-checkout 'bun install --frozen-lockfile' rc=0 at the PR head (bun 1.3.14, zero node_modules, literal); CI per-check table 5/5 GREEN at the head; the packed-consumer test green; the PR diff LOCK-ONLY (git diff origin/main...HEAD --stat: bun.lock + nothing unrelated); secrets scan clean.
- REVIEW (one Fable adversarial reviewer — focused cycle-2 on the named defects): (a) P1-1 fixed: CI 5/5 green at the head MEASURED (per-check table, no RULING D), (b) P1-2 fixed: contracts exports-map back to dist/*.d.ts, packed-consumer test green (literal), (c) the PR diff is lock-only (no package.json exports-map or unrelated changes), (d) frozen install rc=0, (e) mergeability vs CURRENT origin/main (merge-tree). Post '[REVIEW] <GO|NO_GO> — main-lockfile-fix @ <sha> — lens: main-side frozen-lockfile repair cycle-2, reviewer main-lockfile-fix-review' to #board. Block ONLY concrete P0/P1 defects.
- LAND: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge 718 --squash --body-file ending 'Agent: main-lockfile-fix-land', record merged sha, then LIVE-VERIFY: fresh checkout at the merged main tip, 'bun install --frozen-lockfile' rc=0 (literal). Comment the result on the PR. The merges of 709/715 at their GO'd heads follow via the pr-drain lanes.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on the PR and #board. English. Distinguish measured vs inferred; state what you did not check.
`

const INVESTIGATE = CONST + `
ROLE: investigate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Reproduce the frozen-install failure on origin/main tip (literal rc + output); identify the exact drifted entries and the introducing commit. Return (JSON): { mainTip, reproRc, reproOutput, driftedEntries: [string], introducingCommit, driftDirection: 'lockfile-behind'|'packagejson-behind', notChecked: [string] }
`

const FIX = CONST + `
ROLE: fix lane (Opus). At the head after investigate: apply the smallest owned lockfile repair at origin/main (regen bun.lock; exact-name excludes only if the quarantine blocks; no unrelated churn); fresh frozen install rc=0 in your worktree; commit; push; open the PR. Return (JSON): { newHead, lockSummary, driftedEntriesFixed: [string], frozenInstallRc, prNumber, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head: fresh-checkout 'bun install --frozen-lockfile' rc=0 (literal output, bun 1.3.14, zero node_modules); CI per-check table (gh api actions/runs?head_sha=<sha> + per-job conclusions, bounded polling) — 5/5 GREEN (RULING D NOT acceptable for this lane); secrets scan clean; lock diff minimal. Return (JSON): { ciGreen, checks: [{name, conclusion}], installRc, installOutput, secretsClean, lockDiffClass, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). One review at the new head: (a) red-before reproduced (literal), (b) frozen install rc=0 measured at the head, (c) CI 5/5 green at the head (the RULING D class fixed — not reclassified), (d) smallest owned change, (e) mergeability vs CURRENT origin/main (merge-tree clean), (f) secrets clean. Post '[REVIEW] <GO|NO_GO> — main-lockfile-fix @ <sha> — lens: main-side frozen-lockfile repair, reviewer main-lockfile-fix-review' to #board. Block ONLY concrete P0/P1 defects. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: main-lockfile-fix-land', record merged sha, LIVE-VERIFY: fresh checkout at merged main tip, 'bun install --frozen-lockfile' rc=0 (literal), comment on the PR. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, liveVerifyRc, liveVerifyOutput, residue: [] }
`

const INVESTIGATE_SCHEMA = { type: 'object', properties: { mainTip: { type: 'string' }, reproRc: { type: 'number' }, reproOutput: { type: 'string' }, driftedEntries: { type: 'array' }, introducingCommit: { type: 'string' }, driftDirection: { type: 'string' }, notChecked: { type: 'array' } }, required: ['mainTip', 'reproRc', 'driftedEntries'] }
const FIX_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, lockSummary: { type: 'string' }, driftedEntriesFixed: { type: 'array' }, frozenInstallRc: { type: 'number' }, prNumber: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'prNumber'] }
const VERIFY_SCHEMA = { type: 'object', properties: { ciGreen: { type: 'boolean' }, checks: { type: 'array' }, installRc: { type: 'number' }, installOutput: { type: 'string' }, secretsClean: { type: 'boolean' }, lockDiffClass: { type: 'string' }, evidence: { type: 'string' } }, required: ['ciGreen', 'checks', 'installRc'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, liveVerifyRc: { type: ['number', 'null'] }, liveVerifyOutput: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Investigate')
const investigate = await agent(INVESTIGATE, { label: 'main-lockfile-investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA, model: 'opus' })

phase('Fix')
const fix = investigate && investigate.reproRc !== 0 ? await agent(FIX, { label: 'main-lockfile-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' }) : null

phase('Verify')
const verify = fix && fix.pushed ? await agent(VERIFY, { label: 'main-lockfile-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'main-lockfile-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'investigate/fix/verify did not complete or main already recovered', detail: JSON.stringify({ investigate, fix, verify }) }] }

phase('Land')
const land = review && review.verdict === 'GO'
  ? await agent(LAND, { label: 'main-lockfile-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, liveVerifyRc: null, liveVerifyOutput: '', residue: ['NO_GO — fix lane must remediate per findings'] }

return { investigate: investigate && { mainTip: investigate.mainTip, reproRc: investigate.reproRc, driftedEntries: investigate.driftedEntries }, fix: fix && { newHead: fix.newHead, prNumber: fix.prNumber }, verify: verify && { ciGreen: verify.ciGreen, installRc: verify.installRc }, review: review && review.verdict, land }
