export const meta = {
  name: 'modes-removal-r2',
  description: 'Second wave of the deployment-mode removal: merge the 14 open modes PRs (rebase the 5 conflicting, verify verdicts from #git-prs, base-movement gate), purge stale generated storage-kit mode.ts carriers in 12 apps + STORAGE_MODE refs in 16 generated files',
  phases: [
    { title: 'Rebase', detail: '5 conflicting PRs (410, 411, 418, 421, 424): rebase onto origin/main, tests, secrets scan' },
    { title: 'VerifyMerge', detail: 'all 14: verdict from #git-prs at current head, merge-tree gate, merge GO with attribution' },
    { title: 'Purge', detail: '3 lanes, 4 apps each: regenerate/delete stale generated storage-kit mode.ts + backend.ts STORAGE_MODE refs, tests, PR' },
    { title: 'Review', detail: 'Fable review of the purge PRs' },
    { title: 'Merge2', detail: 'merge the GO\'d purge PRs' },
    { title: 'Report', detail: 'per-PR state + residue' },
  ],
}

const APPS = '3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8'
const TASK = 'a48e420b-0b2b-48c5-9562-e3e2b7f4f6c3'
const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const CONFLICTING = [410, 411, 418, 421, 424]
const OPEN_PRS = [445, 431, 428, 426, 424, 421, 419, 418, 415, 411, 410, 406, 405, 401]
const PURGE_APPS = ['access', 'attachments', 'domains', 'files', 'fleet', 'holdings', 'logs', 'secrets', 'sessions', 'tenants', 'testers', 'workforce']

const CONST = `
You are a lane of the modes-removal-r2 workflow (owner-authorized, task ${TASK}). Second wave of the deployment-mode removal (owner directive 2026-07-29: no mode enums, no compat shims, full refactoring; "self_hosted"/"remote"/"hybrid"/deploymentMode(s) are dead vocabulary). Wave 1 (wf_999e25d4-041) merged 7 PRs; this wave lands the 14 remaining open modes PRs and purges stale generated storage-kit mode.ts carriers. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first: git -C ${MONOREPO} pull (fast-forward; never discard local work). Work in task worktrees ~/.hasna/repos/worktrees/apps/modes-r2-<n> from origin/main. Never push to main. Force-push (--force-with-lease) ONLY on the PR's own branch for the rebase. Merges ONLY via gh pr merge <n> --squash --body-file <file whose LAST line is 'Agent: modes-r2-<your-role>'>.
- IDEMPOTENCY CHECK FIRST: if a PR is already merged (gh pr view <n> --json state,mergedAt), record its merged sha and SKIP. If its premise is already satisfied, record that.
- VERDICT DISCIPLINE: a merge REQUIRES a [REVIEW] GO verdict on the PR's CURRENT head sha (search 'conversations search "<repo>#<n>" --channel git-prs -j'; verify the verdict's sha == current head). NO verdict at head, or NO_GO with open P0/P1: do NOT merge; comment and leave open.
- BASE-MOVEMENT GATE before every merge: git merge-tree --write-tree origin/main <head> must equal <head> tree, or the delta must be disjoint from the PR's own files. If main moved since the review, re-verify.
- No secrets: never print/capture/commit credential values in any encoding; consume ONLY via 'secrets exec <key> --as VAR -- <cmd>'. Staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings in artifacts.
- Capture path: redirect to files, read both + $?; never pipe large reads. Paste literal output lines when reporting.
- Record as you go: comments on ${TASK}, posts to #board. English. Register a lineage identity ('conversations agents register') named modes-r2-<your-role>.
- Distinguish measured vs inferred; state what you did not check. Plain register.
- NO NEW MODE VOCAB: the fix never reintroduces 'mode'/'self_hosted'/'remote'/'hybrid'/'deploymentMode' as an active concept — only test files may name the words to prove rejection, plus CHANGELOG/digest-anchored evidence.
`

const REBASE = CONST + `
ROLE: rebase lane (execute). Your PRs: {PRS} (each: number). For EACH PR:
1. gh pr view <n> --repo hasna/apps --json headRefName,headRefOid,state,mergedAt (projected fields only). If merged or closed: record and skip.
2. Fetch the head: git -C ${MONOREPO} fetch origin pull/<n>/head:modes-r2-<n>; worktree ~/.hasna/repos/worktrees/apps/modes-r2-<n>; git checkout -B <THE ACTUAL headRefName> modes-r2-<n> — never guess a branch name.
3. git rebase origin/main. Resolve ONLY unambiguous conflicts (single-sided deletions, non-overlapping hunks); ambiguous -> ABORT + record the conflict (PR stays open with a comment naming it).
4. Verify the app's affected tests (bounded 10 min; bun test on the touched app's test files — record counts). Secrets scan the diff.
5. Push: git push --force-with-lease origin HEAD:<branch>. Re-fetch the new head sha. Verify merge-tree equality: TREE=$(git -C ${MONOREPO} merge-tree --write-tree origin/main <new-head>); git -C ${MONOREPO} diff --quiet <new-head> "$TREE" — must be EQUAL.
6. Comment the rebase on the PR: new head sha, tests, secrets scan result.
Return (JSON): { prs: [{number, newHead, rebased: bool, conflict: string|null, mergedAlready: bool, tests: {passed, failed}, secretsClean: bool}] }
`

const VERIFY_MERGE = CONST + `
ROLE: verify-and-merge lane (execute). Your PRs: {PRS} (each: number). For EACH PR:
1. IDEMPOTENCY: gh pr view <n> --repo hasna/apps --json state,headRefOid,mergeable. Merged -> record sha, skip. Closed -> record.
2. VERDICT: search 'conversations search "hasna/apps#<n>" --channel git-prs -j' for the [REVIEW] GO|NO_GO line; the verdict's @ sha must equal the CURRENT headRefOid. Also check the PR's own comments for a [REVIEW] line. NO GO at the exact head -> comment 'modes-r2: awaiting/refusing merge — no GO verdict at head <sha>' and leave open (do NOT merge).
3. If GO at head: BASE-MOVEMENT GATE — TREE=$(git -C ${MONOREPO} merge-tree --write-tree origin/main <head>); git -C ${MONOREPO} diff --quiet <head> "$TREE" (equal OR delta disjoint from the PR's own file list, verified with git diff --name-only <head> "$TREE" against git diff --name-only origin/main...<head>).
4. Merge: gh pr merge <n> --squash --body-file <file ending 'Agent: modes-r2-ship'>. Record the merged sha.
Return (JSON): { prs: [{number, merged: bool, mergedSha: string|null, reason: string|null}] }
`

const PURGE = CONST + `
ROLE: purge lane (execute). Your apps: {APPS} (each: app name). For EACH app:
1. Locate the stale generated storage-kit carrier: 'git -C ${MONOREPO} ls-files apps/<app>/src/generated/storage-kit/' — mode.ts (and any file carrying STORAGE_MODE/_MODE handling, e.g. generated backend.ts transport) is STALE because the contracts kit generator no longer emits it (RETIRED_KIT_FILES, proven in contracts tests/no-deployment-modes.test.ts:138).
2. Purge via the owning generator: if the app ships a regenerate verb (bun run generate / the storage-kit generator), REGENERATE and verify mode.ts is absent from the output and backend.ts no longer carries STORAGE_MODE. If no generator exists for that app, delete the stale generated file(s) and fix imports in the app's source that referenced them (the generated file is inert; the app's real transport does not depend on it — verify with a build).
3. TDD where behavior changes: a failing test first if the app's behavior is affected; at minimum the app's existing suite must pass (bun test, bounded 10 min, record counts). grep the app's src for 'STORAGE_MODE' and 'EmailsMode'-style selectors: shipped surfaces must be zero.
4. Worktree ~/.hasna/repos/worktrees/apps/modes-r2-purge-<app> from origin/main; commit 'Agent: modes-r2-purge-<app>' trailer LAST; secrets scan; push branch fix/modes-purge-<app>; open the PR with a one-line description naming the stale files purged and the test counts.
Return (JSON): { apps: [{app, prNumber: number|null, regenerated: bool, deleted: string[], tests: {passed, failed}, vocabRemaining: number, evidence: string}] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review {PRS} (each: number). Per PR: (a) shipped surfaces (non-test src, docs, generated, manifests) carry ZERO deployment-mode vocabulary — 'mode' as an active concept, self_hosted/remote/hybrid/deploymentMode; test files may name the words to prove rejection; (b) the app's tests pass; (c) secrets clean; (d) the change is confined to the app's dir. Post '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: modes residue purge, reviewer modes-r2-review ({I} of {N})'. Block ONLY concrete P0/P1 defects (mode vocab reaching a shipped surface, broken build, secrets). P2/P3 non-blocking.
Return (JSON): { prs: [{number, verdict: GO|NO_GO, findings: [{severity, title, detail}]}] }
`

const MERGE2 = CONST + `
ROLE: merge lane. {BATCH} (each: number). For EACH GO'd PR: head == reviewed sha; merge-tree equality at CURRENT origin/main (re-measure; if main moved, verify the delta is disjoint and proceed); gh pr merge <n> --squash --body-file <file ending 'Agent: modes-r2-ship'>; record merged sha. NO_GO: comment findings, leave open.
Return (JSON): { prs: [{number, merged: bool, mergedSha: string|null, reason: string|null}] }
`

const REPORT = CONST + `
ROLE: report. Aggregate: per-PR state across the 14 (merged/rebased/conflicting/awaiting-verdict), per-app purge state, residue remaining (any PR still open with a reason, any app whose purge PR is open). Comment the final state on ${TASK}, post the summary to #board.
Return (JSON): { mergeOutcome: [{number, state, mergedSha}], purgeOutcome: [{app, state, prNumber}], residue: [string] }
`

const PR_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const APP_SCHEMA = { type: 'object', properties: { apps: { type: 'array', items: { type: 'object' } } }, required: ['apps'] }
const REPORT_SCHEMA = { type: 'object', properties: { mergeOutcome: { type: 'array' }, purgeOutcome: { type: 'array' }, residue: { type: 'array' } }, required: ['mergeOutcome', 'purgeOutcome'] }

phase('Rebase')
const rebaseResults = await parallel(CONFLICTING.map((n, i) => () =>
  agent(REBASE.replace('{PRS}', JSON.stringify([n])), { label: `modes-r2-rebase-${i + 1}`, phase: 'Rebase', schema: PR_SCHEMA }),
))
const rebased = rebaseResults.filter(Boolean).flatMap(r => r.prs || [])
log(`rebase: ${rebased.length} PRs processed`)

phase('VerifyMerge')
const remaining = OPEN_PRS.filter(n => !CONFLICTING.includes(n))
const verifyBatches = []
for (let i = 0; i < remaining.length; i += 4) verifyBatches.push(remaining.slice(i, i + 4))
const vmResults = await parallel(verifyBatches.map((batch, i) => () =>
  agent(VERIFY_MERGE.replace('{PRS}', JSON.stringify(batch)), { label: `modes-r2-vm-${i + 1}`, phase: 'VerifyMerge', schema: PR_SCHEMA }),
))
log(`verify-merge: ${vmResults.filter(Boolean).length} lanes`)

phase('Purge')
const purgeBatches = []
for (let i = 0; i < PURGE_APPS.length; i += 4) purgeBatches.push(PURGE_APPS.slice(i, i + 4))
const purgeResults = await parallel(purgeBatches.map((batch, i) => () =>
  agent(PURGE.replace('{APPS}', JSON.stringify(batch)), { label: `modes-r2-purge-${i + 1}`, phase: 'Purge', schema: APP_SCHEMA }),
))
const purgeApps = purgeResults.filter(Boolean).flatMap(r => r.apps || [])
const purgePrs = purgeApps.filter(a => a.prNumber).map(a => ({ number: a.prNumber }))
log(`purge: ${purgeApps.length} apps, ${purgePrs.length} PRs`)

phase('Review')
let reviewResults = []
const reviewBatches = []
for (let i = 0; i < purgePrs.length; i += 4) reviewBatches.push(purgePrs.slice(i, i + 4))
if (reviewBatches.length) {
  reviewResults = await parallel(reviewBatches.map((rb, i) => () =>
    agent(REVIEW.replace('{PRS}', JSON.stringify(rb)).replace('{I}', String(i + 1)).replace('{N}', String(reviewBatches.length)), {
      label: `modes-r2-review-${i + 1}`, phase: 'Review', schema: PR_SCHEMA, model: 'fable',
    }),
  ))
}

phase('Merge2')
let merge2Results = []
if (reviewResults.length) {
  const verdictMap = {}
  for (const rv of reviewResults.filter(Boolean)) {
    for (const p of (rv.prs || [])) verdictMap[p.number] = p.verdict
  }
  merge2Results = await parallel(reviewBatches.map((rb, i) => () => {
    const go = rb.map(p => p.number).filter(n => verdictMap[n] === 'GO')
    return agent(MERGE2.replace('{BATCH}', JSON.stringify(go)), { label: `modes-r2-merge2-${i + 1}`, phase: 'Merge2', schema: PR_SCHEMA })
  }))
}

phase('Report')
const report = await agent(REPORT, { label: 'modes-r2-report', phase: 'Report', schema: REPORT_SCHEMA })

return { rebase: rebaseResults.filter(Boolean), verifyMerge: vmResults.filter(Boolean), purge: purgeResults.filter(Boolean), reviews: reviewResults.filter(Boolean), merges: merge2Results.filter(Boolean), report }
