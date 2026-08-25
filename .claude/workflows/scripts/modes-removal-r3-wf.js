export const meta = {
  name: 'modes-removal-r3',
  description: 'Wave 3 of the deployment-mode removal — rebuild on current main (the rebase path hit its limit in r2): config-class P1s (Dockerfiles/compose mode vars), re-review the rebased heads (411/418), resolve the bun.lock-blocked purges (512/513/521), rebase 431, and the big emails selfhosted refactor (445)',
  phases: [
    { title: 'Config', detail: 'Dockerfile/compose mode-var P1s: 401 domains, 406 economy, 419 testers, 426 calendar, plus 405 contracts-client and 428 storage-kit-compat' },
    { title: 'Mergeable', detail: 're-review 411/418 (rebased heads), verdict 415, rebase+re-review 431, bun.lock-disciplined rebases of 512/513/521' },
    { title: 'Emails', detail: '445: the ~713-line selfhosted refactor, rebuilt on main' },
    { title: 'Review', detail: 'Fable review of new PRs' },
    { title: 'Merge2', detail: 'merge the GO\'d PRs with base-movement gate' },
    { title: 'Report', detail: 'per-PR state + residue' },
  ],
}

const TASK = 'a48e420b-0b2b-48c5-9562-e3e2b7f4f6c3'
const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'

const CONST = `
You are a lane of the modes-removal-r3 workflow (owner-authorized 2026-08-18, task ${TASK}). The deployment-mode removal (owner directive 2026-07-29: no mode enums, no compat shims, full refactoring) hit the rebase limit in wave 2 — old branches cut before the port lanes landed. This wave REBUILDS the removals on current origin/main instead of rebasing stale branches. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). Work in task worktrees ~/.hasna/repos/worktrees/apps/modes-r3-<n> from origin/main. Never push to main. PR-first; merges ONLY via gh pr merge <n> --squash --body-file <file whose LAST line is 'Agent: modes-r3-<your-role>'>.
- IDEMPOTENCY CHECK FIRST: if the target already validates clean at HEAD (grep the app's shipped surfaces for the mode vocabulary — src non-test, Dockerfiles, compose, docs, generated — zero occurrences), record and SKIP. If the app's existing PR was already merged or superseded, record.
- NO COMPAT SHIMS: never leave a mode alias, a legacy env read, or a transitional guard. Remove the concept; tests may name the words only to prove rejection/inertness. Dockerfiles/compose: remove the mode env vars entirely (HASNA_APP_MODE, STORAGE_MODE, *_MODE) — the app's runtime config decides by env contract, never by a mode enum.
- VERDICT DISCIPLINE: merging requires a [REVIEW] GO at the CURRENT head (search 'conversations search "hasna/apps#<n>" --channel git-prs -j'; verify the verdict sha == head). Base-movement gate: merge-tree --write-tree origin/main <head> == head, or delta disjoint from the PR's own files. bun.lock: when the delta overlaps the lockfile, regenerate via 'bun install --lockfile-only' in the worktree so the lockfile diff is the tool's own, then re-verify.
- No secrets: never print/capture/commit credential values; consume ONLY via 'secrets exec <key> --as VAR -- <cmd>'. Staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings in artifacts. Capture path: redirect to files, never pipe large reads. Paste literal output lines.
- Record as you go: comments on ${TASK}, posts to #board. English. Lineage identity 'conversations agents register' named modes-r3-<your-role>. Distinguish measured vs inferred; state what you did not check.
`

const CONFIG = CONST + `
ROLE: config-class lane (execute). Rebuild these removals on current origin/main:
- apps/domains (PR #401 head 9fc48efe): Dockerfile:33 ENV HASNA_APP_MODE=self_hosted — remove the mode var; check for other mode vocabulary in domains' Dockerfile/compose/src.
- apps/economy (PR #406): Dockerfile/compose STORAGE_MODE=cloud — remove; check the economy src for mode vocabulary.
- apps/testers (PR #419): Dockerfile:30 STORAGE_MODE=cloud — remove.
- apps/calendar (PR #426): Dockerfile sets a removed mode var and the code throws — remove the var and any dead throw path.
- apps/attachments (PR #405): contracts-client transport routes hosted on API key alone — the client transport must fail-closed per the two-backend contract (API URL + credential -> http, else local; no mode selection). Fix the transport, TDD.
- apps/contracts or the storage-kit owner (PR #428): storage-kit-compat test red at head — the compat test must be removed/replaced per the no-compat mandate, not kept green.
For EACH: fresh worktree from origin/main, TDD where behavior changes, grep the app's shipped surfaces for mode vocabulary (must be zero after), tests (bounded 10 min), secrets scan, commit ('Agent: modes-r3-config' trailer LAST), push, open a NEW PR naming the P1s it closes (reference the old PR number). Close the old PR by evidence ONLY if this new PR supersedes it completely; otherwise leave it open with a pointer comment.
Return (JSON): { apps: [{app, prNumber: number|null, oldPr: number|null, vocabRemaining: number, tests: {passed, failed}, evidence: string}] }
`

const MERGEABLE = CONST + `
ROLE: mergeable lane (execute). Handle:
1. RE-REVIEW the rebased heads: #411 files @ ae160a19 (GO was stale at fcb861df; 248 pass/2 fail at the rebased head — check the 2 failures), #418 contracts @ 22435a07 (GO stale at 97aab942; 1445/0; secretsClean was false — resolve that). For EACH: verify the rebased head's diff vs origin/main is the intended removal, run the affected tests, secrets scan; if clean, post '[REVIEW] GO — hasna/apps#<n> @ <head> — lens: modes-r3 rebased-head re-review, reviewer modes-r3-rebase' (or NO_GO with findings).
2. #415 (awaiting verdict): fetch its current head, review it for the mode removal substance, post the verdict.
3. #431 (todos): the GO at a7caca8a is base-movement-blocked (main moved apps/todos/src/cli/cloud-router.ts via #371/#260/#236). REBUILD the removal on origin/main in a fresh worktree (cloud-router mode vocabulary removal), TDD, tests, push, and either update the PR's branch (force-with-lease on its own branch) or open a new PR — same lineage, reference #431.
4. bun.lock-blocked purges: #512 fleet, #513 holdings, #521 logs — GO'd at their heads but the merge-tree delta overlaps bun.lock. Rebuild each purge on origin/main (the stale generated storage-kit mode.ts removal), regenerate the lockfile with 'bun install --lockfile-only' in the worktree, tests, push --force-with-lease on the PR's own branch, and re-run the base-movement gate; if still blocked, record the exact overlap.
Return (JSON): { prs: [{number, action: 're-reviewed'|'rebuilt'|'blocked', verdict: string|null, newHead: string|null, mergedReady: bool, evidence: string}] }
`

const EMAILS = CONST + `
ROLE: emails lane (execute). PR #445 was NO_GO at bab22331: ~713 selfhosted lines retained in live src (isSelfHostedTuiMode() predicate, 25+ SELF_HOSTED_* constants, src/server/self-hosted/ tree). REBUILD the emails mode removal on current origin/main — this is the largest remaining refactor: the EMAILS_MODE selector (local|self_hosted), the .remote.ts/.local.ts file-pair routing, the server/self-hosted serve arm, DomainType 'self_hosted' DB value, storage-kit mode files, and the self-hosted constants — all removed; the two-backend contract (local SQLite OR hosted API, fail-closed, DATABASE_URL -> postgresql else sqlite) is the only selector. ~90 behavior tests lock in the transitional state — refactor the source AND the tests together, never leave a test asserting a mode. TDD: the removal tests first (vocabulary must be zero in shipped surfaces), see them fail, then refactor. Run the full emails suite (bounded 15 min), typecheck, secrets scan, commit ('Agent: modes-r3-emails' trailer LAST), push, open the PR referencing #445. This is a large lane — work methodically app-directory by app-directory and record progress on ${TASK} as you go.
Return (JSON): { apps: [{app: 'emails', prNumber: number|null, vocabRemaining: number, filesTouched: number, tests: {passed, failed}, evidence: string}] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). Review {PRS} (each: number). Per PR: (a) shipped surfaces (non-test src, Dockerfiles, compose, docs, generated, manifests) carry ZERO deployment-mode vocabulary (mode as an active concept, self_hosted/remote/hybrid/deploymentMode, mode env vars); (b) the two-backend contract holds (fail-closed; DATABASE_URL the only server selector); (c) tests pass, secrets clean; (d) scope confined. Post '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: modes removal r3, reviewer modes-r3-review ({I} of {N})'. Block ONLY concrete P0/P1 defects. P2/P3 non-blocking.
Return (JSON): { prs: [{number, verdict: GO|NO_GO, findings: [{severity, title, detail}]}] }
`

const MERGE2 = CONST + `
ROLE: merge lane. {BATCH} (each: number). For EACH GO'd PR: head == reviewed sha; base-movement gate at CURRENT origin/main (re-measure; bun.lock overlap -> regenerate then re-verify); gh pr merge <n> --squash --body-file <file ending 'Agent: modes-r3-ship'>; record merged sha. NO_GO: comment findings, leave open.
Return (JSON): { prs: [{number, merged: bool, mergedSha: string|null, reason: string|null}] }
`

const REPORT = CONST + `
ROLE: report. Aggregate per-PR state (merged/reviewed/rebuilt/blocked with reason), vocab-remaining counts, residue. Comment ${TASK}, post to #board.
Return (JSON): { prs: [{number, state, mergedSha}], residue: [string] }
`

const APP_SCHEMA = { type: 'object', properties: { apps: { type: 'array', items: { type: 'object' } } }, required: ['apps'] }
const PR_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REPORT_SCHEMA = { type: 'object', properties: { prs: { type: 'array' }, residue: { type: 'array' } }, required: ['prs'] }

phase('Config')
const config = await agent(CONFIG, { label: 'modes-r3-config', phase: 'Config', schema: APP_SCHEMA })
const configPrs = (config && config.apps ? config.apps : []).filter(a => a.prNumber).map(a => ({ number: a.prNumber }))
log(`config: ${configPrs.length} PRs`)

phase('Mergeable')
const mergeable = await agent(MERGEABLE, { label: 'modes-r3-mergeable', phase: 'Mergeable', schema: PR_SCHEMA })

phase('Emails')
const emails = await agent(EMAILS, { label: 'modes-r3-emails', phase: 'Emails', schema: APP_SCHEMA })
const emailsPr = (emails && emails.apps && emails.apps[0] && emails.apps[0].prNumber) || null
log(`emails: pr=${emailsPr}`)

phase('Review')
const allPrs = [...configPrs]
if (emailsPr) allPrs.push({ number: emailsPr })
let reviewResults = []
const reviewBatches = []
for (let i = 0; i < allPrs.length; i += 4) reviewBatches.push(allPrs.slice(i, i + 4))
if (reviewBatches.length) {
  reviewResults = await parallel(reviewBatches.map((rb, i) => () =>
    agent(REVIEW.replace('{PRS}', JSON.stringify(rb)).replace('{I}', String(i + 1)).replace('{N}', String(reviewBatches.length)), {
      label: `modes-r3-review-${i + 1}`, phase: 'Review', schema: PR_SCHEMA, model: 'fable',
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
    return agent(MERGE2.replace('{BATCH}', JSON.stringify(go)), { label: `modes-r3-merge2-${i + 1}`, phase: 'Merge2', schema: PR_SCHEMA })
  }))
}

phase('Report')
const report = await agent(REPORT, { label: 'modes-r3-report', phase: 'Report', schema: REPORT_SCHEMA })

return { config, mergeable, emails, reviews: reviewResults.filter(Boolean), merges: merge2Results.filter(Boolean), report }
