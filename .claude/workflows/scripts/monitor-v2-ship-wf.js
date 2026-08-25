export const meta = {
  name: 'monitor-v2-ship',
  description: 'Successor to monitor-v2 (wf_60186692-20e): re-review the 13 open monitor-v2 PRs at their current heads, bounded remediation within the cycle cap, merge the GO\'d with base-movement gate, ship @hasna/monitor with live smoke (MON-V2-16)',
  phases: [
    { title: 'Census', detail: 'per-PR state at head: verdict sha, cycle count, class' },
    { title: 'ReReview', detail: 'adversarial re-review at current heads (Fable)' },
    { title: 'Fix', detail: 'bounded remediation for within-cap NO_GOs (one cycle)' },
    { title: 'Merge', detail: 'merge GO\'d PRs with base-movement gate' },
    { title: 'Ship', detail: 'release @hasna/monitor only when a merged candidate has a GO at head' },
    { title: 'Report', detail: 'per-PR state + residue' },
  ],
}

const TASK = '6a43f43e-3a36-49c0-9708-b2c6cb0e2fe9'
const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'

const CONST = `
You are a lane of the monitor-v2-ship workflow (successor to wf_60186692-20e, feature task ${TASK}, 2026-08-18). The monitor-v2 build wave is complete (16 plan nodes, 14 PRs, all suites green at their heads) but the ship lane refused to publish: no merged candidate carried a [REVIEW] GO at head. THIS wave re-reviews the open PRs at their CURRENT heads, remediates only within the bounded-review cycle cap (at most 2 remediation cycles per PR — a 3rd NO_GO terminates that candidate), merges the GO'd, and ships @hasna/monitor only when the ship gate passes. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). Work in task worktrees ~/.hasna/repos/worktrees/apps/monitor-v2-ship-<n> from origin/main. Never push to main. Force-push (--force-with-lease) ONLY on the PR's own branch. Merges ONLY via gh pr merge <n> --squash --body-file <file whose LAST line is 'Agent: monitor-v2-ship-<your-role>'>.
- IDEMPOTENCY FIRST: check state before acting (gh pr view <n> --json state,headRefOid — projected). Merged/closed -> record and skip. A PR already carrying a [REVIEW] GO at its CURRENT head -> go to merge, never re-review.
- VERDICT DISCIPLINE: a merge requires a [REVIEW] GO at the CURRENT head sha (search 'conversations search "hasna/apps#<n>" --channel git-prs -j' AND the PR's comments; verdict sha must equal the current head). NO verdict at head -> re-review, not merge. NO_GO with open P0/P1 -> comment if not already, leave open, record.
- CYCLE CAP: count remediation cycles per PR from its comment history (fix-lane comments + re-review verdicts). At cycle cap with NO_GO standing -> terminate that candidate: leave open, record as blocked-at-cap, do NOT start another fix cycle and do NOT merge.
- BASE-MOVEMENT GATE before every merge: TREE=$(git -C ${MONOREPO} merge-tree --write-tree origin/main <head>); git -C ${MONOREPO} diff --quiet <head> "$TREE" (equal OR the delta is disjoint from the PR's own files, verified with git diff --name-only). If main moved over the PR's own files -> rebase first, then re-review at the new head, never merge unreviewed.
- MONITOR-V2-SCOPE: this wave owns the monitor-v2 PRs (#480 #482 #483 #504 #492 #479 #493 #496 #484 #497 #488 #491 #486 and any successor PRs the fix lanes opened). Do NOT touch PRs outside the monitor-v2 lineage; a PR whose comments carry '[merge-open]', 'modes-r3', 'contracts-r2/r3', 'backlog-', 'consolidate-r3' markers from another active workstream is HELD — record and skip.
- No secrets: never print/capture/commit credential values; consume ONLY via 'secrets exec <key> --as VAR -- <cmd>'. Staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings in artifacts. Capture path: redirect to files, never pipe large reads. Paste literal output lines.
- Record as you go: comments on ${TASK}, posts to #board. English. Lineage identity 'conversations agents register' named monitor-v2-ship-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const CENSUS = CONST + `
ROLE: census lane (execute). For EACH of #480 #482 #483 #504 #492 #479 #493 #496 #484 #497 #488 #491 #486: gh pr view <n> --json state,headRefOid,title,mergeable (redirect to a file). Then search 'conversations search "hasna/apps#<n>" --channel git-prs -j' + the PR's comments for the LAST [REVIEW] verdict line: extract verdict, sha, and count the remediation cycles (fix-lane remediation comments + re-review verdicts per PR). Classify each: (a) mergeReady — GO at current head; (b) reReview — NO verdict at current head (or verdict sha != head); (c) blockedAtCap — NO_GO at head AND cycle count >= 2 with no fix in flight; (d) held — marker from another workstream; (e) closed — merged/closed. Return exact heads and verdict shas.
Return (JSON): { prs: [{number, state: 'mergeReady'|'reReview'|'blockedAtCap'|'held'|'closed', head, verdictSha, verdict, cycles}], totals: {open, mergeReady, reReview, blockedAtCap, held, closed} }
`

const REREVIEW = CONST + `
ROLE: adversarial re-reviewer (Fable). PRs: {PRS} (each: number). For EACH: state-check first (gh pr view <n> --json state,headRefOid — projected); closed -> record and skip. Read the PR's diff at the CURRENT head vs origin/main, and the PRIOR review's P1 findings (from the PR comments). A prior NO_GO's P1 findings are the review contract: verify EACH named P1 is fixed at the current head with its regression test, and check for direct regressions of those fixes. Review the FULL current-head diff for the same defect classes (per the app's adapter/daemon contract in the PR description). Tests at the current head (run the app's suite, bounded 10 min, record counts). Post '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: monitor-v2 re-review (cycle <c>), reviewer monitor-v2-ship-review ({I} of {N})'. GO only when zero open P0/P1 at the current head; P2/P3 are non-blocking follow-ups. On NO_GO, name the cycle count so the fix lane knows the cap.
Return (JSON): { prs: [{number, verdict: GO|NO_GO, cycle, findings: [{severity, title, detail}]}] }
`

const FIX = CONST + `
ROLE: bounded remediation lane. PRs: {PRS} (each: {number, findings}). For EACH with NO_GO and cycle count < 2: fix ONLY the named P1 findings + their direct regressions (re-review scope discipline — never unrelated issues), TDD (regression test first, see it fail, then fix), run the app's suite (bounded 10 min, record counts), secrets scan, commit ('Agent: monitor-v2-ship-fix' trailer LAST), push --force-with-lease on the PR's own branch. Do NOT open new PRs. If the fix touches a file another monitor-v2 PR also touches, coordinate: keep the PRs' file sets disjoint by fixing on each PR's own branch only what that PR owns. Cycle count >= 2 -> record blockedAtCap, do not fix.
Return (JSON): { prs: [{number, fixed: bool, cycle, tests: {passed, failed}, newHead, blockedAtCap: bool, evidence: string}] }
`

const MERGE = CONST + `
ROLE: merge lane. {BATCH} (each: number). For EACH GO'd PR: head == reviewed sha (re-verify gh pr view <n> --json headRefOid); base-movement gate at CURRENT origin/main (re-measure; bun.lock overlap -> regenerate via 'bun install --lockfile-only' in the worktree and re-verify; delta not disjoint -> back to re-review, do not merge); gh pr merge <n> --squash --body-file <file ending 'Agent: monitor-v2-ship-ship'>; record merged sha.
Return (JSON): { prs: [{number, merged: bool, mergedSha: string|null, reason: string|null}] }
`

const SHIP = CONST + `
ROLE: ship lane. IDEMPOTENCY FIRST: @hasna/monitor@0.1.27 was ALREADY published on 2026-08-19 by the prior ship lane of this workflow (rc=0, 160 files, shasum acbb6cfb; [PUBLISH-CONFIRM] #git-publishing 711697; changeset PR #573 merged @ 8c11987c7) with install and live smoke completed. Verify that state (npm view @hasna/monitor version == 0.1.27; installed version; the live-test fixture artifacts), and if it holds, SKIP the publish/install/live-test steps and return the verified state. Ship gate (all must hold): (1) a monitor-v2 PR is MERGED on origin/main at the current head, (2) that merged content carried a [REVIEW] GO at its merged sha, (3) apps/monitor suite green at origin/main (bounded 10 min), (4) secrets scan staged rc=0. If ANY gate fails, refuse to publish and return published=false with the exact failing gate — NEVER publish without a GO'd merged candidate. If the gate passes and 0.1.27 is NOT yet published: changeset for @hasna/monitor (patch bump from the current published version — check 'npm view @hasna/monitor version'), commit + push the changeset PR and merge it (GO at head + base-movement), then publish: temp npmrc with the placeholder '//registry.npmjs.org/:_authToken=\${NODE_AUTH_TOKEN}' (mode 600), 'secrets exec hasna/npm/live/publish-token --as NODE_AUTH_TOKEN -- npm publish --userconfig <npmrc>' from the apps/monitor dir, delete the npmrc. Announce [PUBLISH INTENT] on #git-publishing BEFORE the publish, [PUBLISH-CONFIRM] after. Then INSTALL: add '@hasna/monitor' to ~/.bunfig.toml minimumReleaseAgeExcludes if absent, 'bun install -g @hasna/monitor@<version>', verify the installed version. LIVE TEST: a live fixture defines a slug, starts the monitor (daemon), executes one run, produces a terminal receipt, stops gracefully — the real user-visible path. Never print/capture token values.
Return (JSON): { gatePassed: bool, failedGate: string|null, published: bool, version: string|null, installed: bool, installedVersion: string|null, liveTest: {slug, started, receipt: bool, stopped, evidence: string} | null }
`

const REPORT = CONST + `
ROLE: report. Aggregate per-PR state (merged/reviewed/blockedAtCap/held), residue (blockedAtCap PRs with their standing NO_GO findings, NO_GO-at-head PRs within cap needing the next wave, ship result). Comment ${TASK}, post to #board. Distinguish measured vs inferred.
Return (JSON): { prs: [{number, state, mergedSha}], residue: [string] }
`

const CENSUS_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } }, totals: { type: 'object' } }, required: ['prs'] }
const PR_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const SHIP_SCHEMA = { type: 'object', properties: { gatePassed: { type: 'boolean' }, failedGate: { type: ['string', 'null'] }, published: { type: 'boolean' }, version: { type: ['string', 'null'] }, installed: { type: 'boolean' }, installedVersion: { type: ['string', 'null'] }, liveTest: { type: ['object', 'null'] } }, required: ['gatePassed', 'published'] }
const REPORT_SCHEMA = { type: 'object', properties: { prs: { type: 'array' }, residue: { type: 'array' } }, required: ['prs'] }

const ALL_PRS = [480, 482, 483, 504, 492, 479, 493, 496, 484, 497, 488, 491, 486]

phase('Census')
const census = await agent(CENSUS, { label: 'monitor-v2-ship-census', phase: 'Census', schema: CENSUS_SCHEMA })
const prs = (census && census.prs) || []
const reReview = prs.filter(p => p.state === 'reReview')
const mergeReady = prs.filter(p => p.state === 'mergeReady')
log(`census: reReview ${reReview.length}, mergeReady ${mergeReady.length}, blockedAtCap ${prs.filter(p => p.state === 'blockedAtCap').length}`)

phase('ReReview')
let reReviewResults = []
const rrBatches = []
for (let i = 0; i < reReview.length; i += 4) rrBatches.push(reReview.slice(i, i + 4))
if (rrBatches.length) {
  reReviewResults = await parallel(rrBatches.map((b, i) => () =>
    agent(REREVIEW.replace('{PRS}', JSON.stringify(b)).replace('{I}', String(i + 1)).replace('{N}', String(rrBatches.length)), {
      label: `monitor-v2-ship-rereview-${i + 1}`, phase: 'ReReview', schema: PR_SCHEMA, model: 'fable',
    }),
  ))
}
const rrMap = {}
for (const rv of reReviewResults.filter(Boolean)) {
  for (const p of (rv.prs || [])) rrMap[p.number] = p
}
// GO verdicts from re-review flow straight to the merge list (verified at their
// current heads by the re-review lanes; the merge lane re-verifies head + base).
for (const p of reReview) {
  if (rrMap[p.number] && rrMap[p.number].verdict === 'GO') mergeReady.push({ number: p.number, head: rrMap[p.number].head || p.head })
}

phase('Fix')
let fixResults = []
const toFix = reReview.filter(p => rrMap[p.number] && rrMap[p.number].verdict === 'NO_GO' && (rrMap[p.number].cycle || 0) < 2)
if (toFix.length) {
  fixResults = await parallel(toFix.map((p, i) => () =>
    agent(FIX.replace('{PRS}', JSON.stringify([{ number: p.number, findings: (rrMap[p.number].findings || []).map(f => f.title) }])), {
      label: `monitor-v2-ship-fix-${i + 1}`, phase: 'Fix', schema: PR_SCHEMA,
    }),
  ))
  for (const f of fixResults.filter(Boolean)) {
    for (const p of (f.prs || [])) {
      if (p.fixed) mergeReady.push({ number: p.number, head: p.newHead })
    }
  }
}
const blockedAtCap = reReview.filter(p => rrMap[p.number] && rrMap[p.number].verdict === 'NO_GO' && (rrMap[p.number].cycle || 0) >= 2).map(p => p.number)

phase('Merge')
let mergeResults = []
if (mergeReady.length) {
  const mBatches = []
  for (let i = 0; i < mergeReady.length; i += 4) mBatches.push(mergeReady.slice(i, i + 4))
  mergeResults = await parallel(mBatches.map((b, i) => () =>
    agent(MERGE.replace('{BATCH}', JSON.stringify(b)), { label: `monitor-v2-ship-merge-${i + 1}`, phase: 'Merge', schema: PR_SCHEMA }),
  ))
}

phase('Ship')
const ship = await agent(SHIP, { label: 'monitor-v2-ship-release', phase: 'Ship', schema: SHIP_SCHEMA })
log(`ship: gate=${ship && ship.gatePassed} published=${ship && ship.published}`)

phase('Report')
const report = await agent(REPORT, { label: 'monitor-v2-ship-report', phase: 'Report', schema: REPORT_SCHEMA })

return { census, reReviews: reReviewResults.filter(Boolean), fixes: fixResults.filter(Boolean), merges: mergeResults.filter(Boolean), ship, report }
