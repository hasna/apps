export const meta = {
  name: 'closed-pr-audit',
  description: 'Owner-authorized 2026-08-19: audit closed-unmerged hasna/apps PRs (last 30d) — legitimately closed (superseded/duplicate/premise-done/abandoned-with-reason/moot) vs mistakenly closed (should have been fixed+merged) vs closed-on-NO_GO needing reopen; reopen+fix+merge the mistaken; stats; recurring catch mechanism (task 1a5373b1)',
  phases: [
    { title: 'Audit', detail: 'enumerate closed-unmerged PRs, classify each with evidence (comments, linked rows, did the content land elsewhere)' },
    { title: 'Recover', detail: 'reopen + rebase the mistaken/needs-reopen onto origin/main (unambiguous only), per-PR lanes' },
    { title: 'Review', detail: 'Fable adversarial review at the new head' },
    { title: 'Merge', detail: 'merge GO at head with base-movement gate' },
    { title: 'Report', detail: 'stats + per-PR outcomes' },
    { title: 'Harvest', detail: 'independent harvest — file the recurring closed-PR audit cadence + taxonomy so mistakes get caught going forward' },
  ],
}

const TASK = '1a5373b1-b898-43e5-b670-2f9dc7b5185e'
const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'

const CONST = `
You are a lane of the closed-pr-audit workflow (owner-authorized 2026-08-19, task ${TASK}). Mission: audit every PR on hasna/apps closed WITHOUT merge in the last 30 days (2026-07-20..now). For each: was it TRULY ok to close, or was it a mistake — real change that should have been fixed and merged? Reopen + fix + merge the mistaken ones properly. Produce stats. Build the recurring mechanism so these mistakes get caught going forward. The workflow NEVER closes a PR — legit-closed ones stay closed and are recorded as audited-legit. Final text = machine-readable JSON.

Non-negotiable rules (all agents):
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} pull, fast-forward; never discard local work). Work in task worktrees ~/.hasna/repos/worktrees/apps/closed-pr-<n> from origin/main. Never push to main. Force-push (--force-with-lease) ONLY on the PR's own branch for a rebase. Merges ONLY via gh pr merge <n> --squash --body-file <file whose LAST line is 'Agent: closed-pr-audit-<your-role>'>. NEVER close a PR — the audit only reopens and merges.
- IDEMPOTENCY FIRST: state-check before acting (gh pr view <n> --json state,headRefOid — projected). If a PR was reopened by another lane between census and action, re-measure and adjust. A merge already landed -> record and skip.
- VERDICT DISCIPLINE: a merge requires a [REVIEW] GO at the CURRENT head sha (search 'conversations search "hasna/apps#<n>" --channel git-prs -j' AND the PR's comments; verdict sha must equal the current head). No verdict at head -> REVIEW lane, not merge. NO_GO with open P0/P1 -> comment, leave open, record as needs-fix.
- BASE-MOVEMENT GATE before every merge: TREE=$(git -C ${MONOREPO} merge-tree --write-tree origin/main <head>); git -C ${MONOREPO} diff --quiet <head> "$TREE" (equal OR the delta is disjoint from the PR's own files, verified with git diff --name-only). If main moved over the PR's own files -> rebase, never merge.
- No secrets: never print/capture/commit credential values; consume ONLY via 'secrets exec <key> --as VAR -- <cmd>'. Staged secrets scan (redirect + 'secrets scan input', rc 0 clean) before every commit/push. No internal-infra strings in artifacts. Capture path: redirect to files, never pipe large reads. Paste literal output lines.
- Record as you go: comments on each touched PR (audit verdict, reopen, rebase, merge), posts to #board, comments on ${TASK}. English. Lineage identity 'conversations agents register' named closed-pr-<your-role>. Distinguish measured vs inferred; state what you did not check.
- The audit verdict must be EVIDENCE-BASED per PR, never inferred from the title alone: read the PR body + comments + linked todos rows + check whether the change's substance landed another way (git log -S / diff search on main for the change signature).
`

const AUDIT = CONST + `
ROLE: audit lane (Opus). Enumerate the closed-unmerged PRs: gh pr list --repo hasna/apps --state closed --limit 200 --json number,title,closedAt,mergedAt,headRefName,headRefOid,body,comments,labels,url (redirect to a file, never pipe; comments may need per-PR 'gh pr view <n> --json comments' for full text). Filter: closedAt >= 2026-07-20 AND mergedAt == null. Cap the pass at 100 PRs (oldest first beyond the cap -> record as unprocessed with the bound stated).
For EACH PR classify with evidence:
(a) LEGIT-superseded — content folded into another PR that landed (name the PR);
(b) LEGIT-duplicate — duplicate of a merged PR (name it);
(c) LEGIT-premise-done — the change already landed by another route (git log/diff evidence);
(d) LEGIT-abandoned — closed with a recorded reason (owner decision, out of scope, experiment) that still holds;
(e) LEGIT-moot — main-side change made it inapplicable (evidence: the files/behavior it touched were replaced);
(f) MISTAKE — real change, never landed anywhere, no valid recorded reason for closing (the change is still needed: its fix/feature class still exists on main);
(g) NEEDS-REOPEN — closed on a NO_GO with open P0/P1 findings (the findings should have been fixed, not the PR closed) OR closed while CI/review was incomplete with no recorded reason.
Record per-PR: the closing actor (who closed it, from the timeline/events — if unmeasurable say so), the close date, the evidence lines for the class.
Return (JSON): { prs: [{number, title, closedAt, classification, evidence: string, closingActor: string|null}], stats: {total, legit, mistake, needsReopen, unprocessed: number}, residue: [string] }
`

const RECOVER = CONST + `
ROLE: recover lane for PRs {PRS} (each: number, classification). For EACH PR classified MISTAKE or NEEDS-REOPEN:
1. State-check: still closed? merged? (gh pr view <n> --json state,mergedAt — projected). Merged -> record, skip. Already reopened -> re-measure and proceed.
2. REOPEN: gh pr reopen <n> (record the exact outcome). NEVER re-close.
3. REBASE onto origin/main: fetch the head (git -C ${MONOREPO} fetch origin pull/<n>/head:closed-pr-<n>; worktree ~/.hasna/repos/worktrees/apps/closed-pr-<n>; checkout the actual headRefName — never guess a branch name). git rebase origin/main. Unambiguous conflicts only; ambiguous -> abort, leave reopened with a comment naming the conflict, record.
4. RE-VERIFY the change is still needed at the new head: the fix/feature class it addresses still exists on main (the audit's evidence) — if main-side change made it moot AFTER the audit, reclassify to legit-moot (record) and leave closed... NO — it is reopened by step 2; if it is genuinely moot, comment the reclassification and the reason, and leave it open for the report to record (the workflow never closes).
5. Run the touched app's tests (bounded 8 min, record counts), secrets scan the diff, push --force-with-lease, re-fetch, verify base-freshness.
6. Comment on the PR: audit classification + reopen + new head + tests + secrets.
Return (JSON): { prs: [{number, reopened: bool, newHead: string, rebased: bool, conflict: string|null, reclassifiedMoot: bool, tests: {passed, failed}, secretsClean: bool}] }
`

const REVIEW = CONST + `
ROLE: adversarial reviewer (Fable). PRs: {PRS} (each: number). For EACH reopened PR: state-check first (merged/closed -> record). Review the diff vs origin/main at the current head: substance matches the audit classification (the change is real and needed), tests green (verify or record), secrets clean, scope confined, no mode vocabulary regression. Post '[REVIEW] <GO|NO_GO> — hasna/apps#<n> @ <sha> — lens: closed-PR recovery, reviewer closed-pr-review ({I} of {N})'. Block ONLY concrete P0/P1 defects; P2/P3 non-blocking (list as follow-ups).
Return (JSON): { prs: [{number, verdict: GO|NO_GO, findings: [{severity, title, detail}]}] }
`

const MERGE = CONST + `
ROLE: merge lane. PRs: {BATCH} (each: number). For EACH: verify head unchanged since the verdict (gh pr view <n> --json headRefOid == the reviewed sha), base-movement gate at CURRENT origin/main (re-measure; if the delta is not disjoint, send back to rebase, do not merge), then gh pr merge <n> --squash --body-file <file ending 'Agent: closed-pr-audit-ship'>. Record the merged sha. NO_GO or unverified: comment and leave open (the workflow never closes).
Return (JSON): { prs: [{number, merged: bool, mergedSha: string|null, reason: string|null}] }
`

const REPORT = CONST + `
ROLE: report (execute). Aggregate per-PR state (audited-legit / reopened / rebased / reviewed / merged / needs-fix / needs-owner-decision) and the STATS for the owner: total closed-unmerged in window, classified legit (by subclass), classified mistake, reopened, merged after recovery, still needs owner/fix action. Post the pass summary to #board naming the stats. Return the residue as follow-up strings.
Return (JSON): { stats: {total, legit: {superseded, duplicate, premiseDone, abandoned, moot}, mistake, needsReopen, reopened, mergedAfterRecovery, needsAction}, prs: [{number, classification, outcome}], residue: [string] }
`

const HARVEST = CONST + `
ROLE: harvest (Opus, independent — you did NOT do the audit/recovery work). ROW-DEDUPE FIRST: before creating anything, search the oss-apps project for an existing open HARVEST row carrying this task's signature (title prefix 'HARVEST: closed-pr-audit' AND a reference to ${TASK}); if one exists, comment the categories on IT and DO NOT create a new row. Comment each category the moment it is decided (create/update/none + reason; dedupe the artefact first; 'none' is complete):
- TODOS: what surfaced nobody filed — per-PR needs-action rows, the recurring-audit cadence row.
- MEMENTOS: what the next agent would re-learn at full cost (the mistaken-close classes observed, their close patterns).
- KNOWLEDGE: ratifiable doctrine — the closed-PR audit taxonomy (legit vs mistaken classes with the evidence test: 'did the change land anywhere?') as a knowledge item, plus the recurring audit as a convention.
- SKILLS: a repeated procedure worth a skill (the closed-PR audit recipe)?
- FILES: the audit matrix belongs in hasna/files rather than scratch?
CRITICAL — THE RECURRING MECHANISM (owner's 'so we can catch these mistakes'): file ONE todos row (or extend the drain task) proposing the standing cadence: the closed-PR audit runs recurring (daily or per drain pass) — the drain's census gains a closed-unmerged check, or a loops entry is registered for it. Name the exact cadence proposal and the owner of the row.
Close the row completed only after all categories are commented.
Return (JSON): { categories: {skills: {decision, reason, rowId}, todos: {...}, mementos: {...}, knowledge: {...}, files: {...}}, recurringMechanismRow: string|null }
Report: {REPORT}
`

const AUDIT_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } }, stats: { type: 'object' }, residue: { type: 'array' } }, required: ['prs', 'stats'] }
const PR_SCHEMA = { type: 'object', properties: { prs: { type: 'array', items: { type: 'object' } } }, required: ['prs'] }
const REPORT_SCHEMA = { type: 'object', properties: { stats: { type: 'object' }, prs: { type: 'array' }, residue: { type: 'array' } }, required: ['stats', 'prs'] }
const HARVEST_SCHEMA = { type: 'object', properties: { categories: { type: 'object' }, recurringMechanismRow: { type: ['string', 'null'] } }, required: ['categories'] }

phase('Audit')
const audit = await agent(AUDIT, { label: 'closed-pr-audit', phase: 'Audit', schema: AUDIT_SCHEMA, model: 'opus' })
const mistake = (audit && audit.prs || []).filter(p => p.classification === 'MISTAKE' || p.classification === 'NEEDS-REOPEN')
log(`audit: ${audit ? JSON.stringify(audit.stats) : 'FAILED'} — to recover ${mistake.length}`)

phase('Recover')
let recoverResults = []
if (mistake.length) {
  const waves = []
  for (let i = 0; i < mistake.length; i += 6) waves.push(mistake.slice(i, i + 6))
  recoverResults = await parallel(waves.map((w, i) => () =>
    agent(RECOVER.replace('{PRS}', JSON.stringify(w)), { label: `closed-pr-recover-${i + 1}`, phase: 'Recover', schema: PR_SCHEMA }),
  ))
}

phase('Review')
let reviewResults = []
const reopened = recoverResults.filter(Boolean).flatMap(r => r.prs || []).filter(p => p.reopened)
if (reopened.length) {
  const reviewWaves = []
  for (let i = 0; i < reopened.length; i += 8) reviewWaves.push(reopened.slice(i, i + 8))
  reviewResults = await parallel(reviewWaves.map((w, i) => () =>
    agent(REVIEW.replace('{PRS}', JSON.stringify(w.map(p => p.number))).replace('{I}', String(i + 1)).replace('{N}', String(reviewWaves.length)), {
      label: `closed-pr-review-${i + 1}`, phase: 'Review', schema: PR_SCHEMA, model: 'fable',
    }),
  ))
}

phase('Merge')
let mergeResults = []
const goPrs = []
const verdictMap = {}
for (const rv of reviewResults.filter(Boolean)) {
  for (const p of (rv.prs || [])) verdictMap[p.number] = p.verdict
}
for (const p of reopened) {
  if (verdictMap[p.number] === 'GO') goPrs.push(p)
}
if (goPrs.length) {
  const mergeWaves = []
  for (let i = 0; i < goPrs.length; i += 6) mergeWaves.push(goPrs.slice(i, i + 6))
  mergeResults = await parallel(mergeWaves.map((w, i) => () =>
    agent(MERGE.replace('{BATCH}', JSON.stringify(w.map(p => p.number))), { label: `closed-pr-merge-${i + 1}`, phase: 'Merge', schema: PR_SCHEMA }),
  ))
}

phase('Report')
const report = await agent(REPORT, { label: 'closed-pr-report', phase: 'Report', schema: REPORT_SCHEMA })

phase('Harvest')
const harvest = await agent(HARVEST.replace('{REPORT}', JSON.stringify(report || { stats: null })), {
  label: 'closed-pr-harvest', phase: 'Harvest', schema: HARVEST_SCHEMA, model: 'opus',
})

return { audit, recover: recoverResults.filter(Boolean), reviews: reviewResults.filter(Boolean), merges: mergeResults.filter(Boolean), report, harvest }
