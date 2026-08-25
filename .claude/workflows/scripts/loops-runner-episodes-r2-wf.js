export const meta = {
  name: 'loops-runner-episodes-r2',
  description: 'Fresh successor driver for row b3d57dd3 (critical): close the 5 review findings that TERMINATED PR #778 (feat(loops): runner failure episodes). The investigate of wf_eb0a14ef-c77 COMPLETED and recorded the 5 findings with owning surfaces (journal-extracted) — this lane CONSUMES that record and runs Fix -> Verify -> one Fable review -> base gate + merge -> complete b3d57dd3 (+ comment 75810ba9). Feature files episodes.ts/errors.ts are ABSENT on main (only on the terminated 778 branch) — the successor PR carries the feature fresh with all 5 findings fixed at the root. Publish rides publish-all (the ONLY publisher).',
  phases: [
    { title: 'Fix', detail: 'idempotency check; deliver the runner-failure-episodes feature fresh in apps/loops with the 5 recorded findings fixed at the owning surface; regression per finding (red-before/green-after); changeset; NEW PR' },
    { title: 'Verify', detail: 'loops suite green (literal counts); regression per finding passes (literal); frozen install; CI per-check at head; diff gate (apps/loops + changeset only); secrets clean' },
    { title: 'Review', detail: 'one Fable adversarial reviewer' },
    { title: 'Land', detail: 'base gate + squash merge + complete b3d57dd3 + evidence comment on 75810ba9' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = 'b3d57dd3'
const FEATURE_ROW = '75810ba9'
const TERMINATED_PR = '778'

const CONST = `
You are the loops-runner-episodes-r2 lane (row ${ROW}; owner-authorized via the task-drain queue; fresh successor of wf_eb0a14ef-c77 whose investigate COMPLETED — the 5 findings are RECORDED below, do NOT re-investigate them, verify only what you need). Final text = machine-readable JSON.

RECORDED 5 FINDINGS (from PR ${TERMINATED_PR} termination comment 5369970440, mapped to owning surfaces by the r1 investigate; treat as given):
- F1: apps/loops/src/runner/episodes.test.ts — the notifier-delivery test (\`the default notifier spawn delivers the event JSON on stdin to an env-pointed command\`, lines ~529-595) can exceed Bun's 5s default per-test timeout in no-spawn sandboxes (shell-capability probe 20x25ms + delivery poll 100x50ms = ~5.5s worst case) before its degraded assertions run. Fix: bound the loops to fit the timeout (repo prior art: apps/loops/src/test-time patterns) so the degraded branch executes.
- F2: apps/loops/src/runner/episodes.ts recordSuccess (lines 482-537) calling withLock (292-309)/acquireLock (262-290): lock contention beyond LOCK_ATTEMPTS=8 x LOCK_RETRY_MS=15 (~105ms) returns undefined and recordSuccess's whole body — including the final recovery emit (521-530) — is skipped; the success observation is DROPPED (recovery never emitted if those were the final two successes). Fix: persist the success intent on a contention skip so no transition is lost.
- F3: episodes.ts emitEvent (375-396): appendEventOnce returns true both when freshly appended AND when already present (348-372), and spawnNotifier fires unconditionally whenever notifierCommand is set — a re-emit after a lost confirm-write DOUBLE-FIRES the notifier. Fix: appendEventOnce must return whether it FRESHLY appended; notifier fires only on fresh append.
- F4: episodes.ts appendEventOnce (342-372): OUTBOX_DEDUP_TAIL=256; the dedup scan readFileSync(outboxPath).split('\\n')...slice(-256) reads the ENTIRE outbox into memory under the lock (unbounded I/O) and loses dedup once the prior event is >256 lines back — duplicate outbox events (probe: target_open_events_after=2). Fix: bounded dedup that cannot miss (shares root with F3).
- F5: episodes.ts withLock finally (297-308): after closeSync, rmSync(lockPath, {force:true}) runs UNCONDITIONALLY; combined with takeOverStaleLock (246-260, LOCK_STALE_MS=10000), a displaced still-live holder's finally deletes the SUCCESSOR's lock → concurrent entry once a critical section exceeds 10s. Fix: the holder deletes its lock only if it still owns it (compare identity before rmSync).

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: (a) row ${ROW} is still pending and unowned (no in_progress fixer row); (b) PR ${TERMINATED_PR} is OPEN but TERMINATED — do NOT reopen it, do NOT push to its branch; (c) no OTHER open PR in the runner-failure-episodes class exists yet (gh pr list --repo hasna/apps --search 'runner episodes in:title,body' — only ${TERMINATED_PR} must appear; your new PR is the successor shape); (d) feature row ${FEATURE_ROW} is completed as superseded (comment-only on it, never re-complete). The recorded findings are NOT the fix — a finding list alone leaves the row pending.
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} fetch origin main -q; never discard local work). Resolve CURRENT origin/main from FETCH_HEAD and verify FETCH_HEAD == gh api repos/hasna/apps/commits/heads/main --jq .sha. File mutation in YOUR OWN task worktree ~/.hasna/repos/worktrees/apps/loops-runner-episodes cut from CURRENT origin/main. NEW BRANCH fix/loops-runner-episodes-r1. PR-first; never push to main. Commits end with 'Agent: loops-runner-episodes-r1-<role>' (the ONLY attribution line; never Co-Authored-By). Commit identity MUST be the canonical fleet identity (Andrei Hasna <andrei@hasna.com>).
- DELIVER THE FEATURE FRESH with all 5 findings fixed: the feature is the runner failure-episodes recorder (persisted state ~/.hasna/loops/runner-episodes.json atomic tmp+rename, open after 3 failures spanning >=120s, close after 2 successes, pending-delivery retry) + structured events + outbox hook + RunnerRefusalError/VersionProbeError extraction + LoopsApiError. The r1 investigate verified the PR ${TERMINATED_PR} head 75abf65f2d carries the full implementation (episodes.ts 553 lines, episodes.test.ts 637 lines) — you may READ that branch's code as reference (gh pr diff ${TERMINATED_PR} or fetch the branch) and rebuild it with the 5 fixes; never cherry-pick the terminated branch wholesale without the fixes. Add a regression PER FINDING (red-before/green-after, literal) + a .changeset/loops-runner-episodes.md patch changeset. HARD SCOPE GATE: the PR diff MUST be limited to apps/loops (feature files + directly-flowing files + the regressions + the changeset) — any other app file is a self-inflicted NO_GO.
- VERIFY at the head (bounded): loops suite green (literal passed/failed counts); every per-finding regression passes (literal, named F1..F5); 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules, literal); CI per-check table at the head (bounded polling — classify every failure against CURRENT origin/main state: main's own run must fail identically for a main-state residual (contracts 0.13.3 resolution class, versioning-integrity); loops-caused failures MUST be green); diff gate (apps/loops + changeset only); secrets scan clean.
- REVIEW (one Fable adversarial reviewer): (a) all 5 recorded findings closed at the owning surface (each named, red-before/green-after measured), (b) the successor is a NEW PR (not a recycled terminated candidate), (c) loops suite green + regressions pass (literal), (d) CI at the head green for the loops reason (or the exact named non-this-lane residual), (e) diff gate within scope, (f) mergeability vs CURRENT origin/main (merge-tree clean), (g) secrets clean. Post '[REVIEW] <GO|NO_GO> — loops-runner-episodes-r2 @ <sha> — lens: 5 terminated findings closed at the root, reviewer loops-runner-episodes-review' to #board. Block ONLY concrete P0/P1 defects; two remediation cycles max.
- LAND: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: loops-runner-episodes-r1-land', record the merged sha, LIVE-VERIFY the loops runner-episodes surface at the merged main tip (bounded), complete row ${ROW} with evidence and add a landing-evidence comment on feature row ${FEATURE_ROW} (completed as superseded 2026-08-21T12:49:26Z — comment only, never re-complete). If NO_GO: comment findings + resume condition, leave open. The package publishes via publish-all's next census (the ONLY publisher) — this lane never calls npm publish.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on the PR and rows ${ROW}/${FEATURE_ROW}, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8.
`

const FIX = CONST + `
ROLE: fix lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Deliver the runner-failure-episodes feature fresh in apps/loops with all 5 recorded findings fixed at the owning surface; regression PER FINDING (F1..F5, red-before/green-after, literal); changeset; NEW BRANCH fix/loops-runner-episodes-r1; canonical commit identity; commit; push; open the NEW PR referencing rows ${ROW}/${FEATURE_ROW}. Return (JSON): { newHead, findingsClosed: [string], regressionsAdded: [string], diffStatSummary, prNumber, pushed, evidence }
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). At the new head: loops suite green (literal counts); every per-finding regression passes (literal, named F1..F5); 'bun install --frozen-lockfile' rc=0 (literal, bun 1.3.14, zero node_modules); CI per-check table at the head (bounded polling; every failure classified vs CURRENT origin/main — main-state residuals named, loops-caused MUST be green); diff gate (apps/loops + changeset only); secrets scan clean. Return (JSON): { suiteCounts: {passed, failed}, regressions: [{finding, rc}], frozenInstallRc, ciGreen, checks: [{name, conclusion, classification}], ciResiduals: [string], diffGatePass, secretsClean, evidence }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). One review at the new head: (a) all 5 recorded findings closed at the owning surface (each named, red-before/green-after measured), (b) the successor is a NEW PR (not a recycled terminated candidate), (c) loops suite green + regressions pass (literal), (d) CI at the head green for the loops reason (or the exact named non-this-lane residual), (e) diff gate within scope, (f) mergeability vs CURRENT origin/main (merge-tree clean), (g) secrets clean. Post '[REVIEW] <GO|NO_GO> — loops-runner-episodes-r2 @ <sha> — lens: 5 terminated findings closed at the root, reviewer loops-runner-episodes-review' to #board. Block ONLY concrete P0/P1 defects. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge --squash --body-file ending 'Agent: loops-runner-episodes-r1-land', record merged sha, LIVE-VERIFY the runner-episodes surface at the merged main tip (bounded), complete row ${ROW} with evidence and add a landing-evidence comment on feature row ${FEATURE_ROW} (already completed as superseded 12:49:26Z — comment only, never re-complete). If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, liveVerifyRc, rowState, featureRowState, residue: [] }
`

const FIX_SCHEMA = { type: 'object', properties: { newHead: { type: 'string' }, findingsClosed: { type: 'array' }, regressionsAdded: { type: 'array' }, diffStatSummary: { type: 'string' }, prNumber: { type: 'number' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'prNumber'] }
const VERIFY_SCHEMA = { type: 'object', properties: { suiteCounts: { type: 'object' }, regressions: { type: 'array' }, frozenInstallRc: { type: 'number' }, ciGreen: { type: 'boolean' }, checks: { type: 'array' }, ciResiduals: { type: 'array' }, diffGatePass: { type: 'boolean' }, secretsClean: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['suiteCounts', 'ciGreen', 'checks'] }
const REVIEW_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, liveVerifyRc: { type: ['number', 'null'] }, rowState: { type: 'string' }, featureRowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Fix')
const fix = await agent(FIX, { label: 'loops-episodes2-fix', phase: 'Fix', schema: FIX_SCHEMA, model: 'opus' })

phase('Verify')
const verify = fix && fix.pushed ? await agent(VERIFY, { label: 'loops-episodes2-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' }) : null

phase('Review')
const review = verify
  ? await agent(REVIEW, { label: 'loops-episodes2-review', phase: 'Review', schema: REVIEW_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'fix/verify did not complete', detail: JSON.stringify({ fix, verify }) }] }

phase('Land')
const land = review && review.verdict === 'GO'
  ? await agent(LAND, { label: 'loops-episodes2-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, liveVerifyRc: null, rowState: 'pending', featureRowState: 'completed', residue: ['NO_GO — fix lane must remediate per findings (two-cycle cap)'] }

return { fix: fix && { newHead: fix.newHead, prNumber: fix.prNumber, findingsClosed: fix.findingsClosed }, verify: verify && { suiteCounts: verify.suiteCounts, ciGreen: verify.ciGreen, ciResiduals: verify.ciResiduals }, review: review && review.verdict, land }
