export const meta = {
  name: 'rebase-lane-pass',
  description: 'Rebase lane pass for task b30590ab (filed by the drain census, 2026-08-21f): rebase PRs 736/445/505 onto CURRENT origin/main 436242975b, push, bounded CI verify, report. PR 445 carries an active drain3-fix445 lane for its send-suppression SEMANTIC conflict — this lane performs only the mechanical rebase and records semantic conflict hunks for that lane; it never resolves semantics.',
  phases: [
    { title: 'Rebase', detail: 'per-PR: sync, resolve CURRENT origin/main, rebase branch onto it in a lane worktree, resolve mechanical conflicts only, push, bounded CI per-check at new head' },
    { title: 'Report', detail: 'aggregate per-PR state, comment + complete task b30590ab' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const TASK = 'b30590ab'
const MAIN_TIP = '436242975b39704dc3f2db8a95b1818abdf57234'

const CONST = `
You are the rebase-lane-pass 2026-08-21f lane (task ${TASK}, filed by the pr-drain census; owner-authorized via the drain queue). Final text = machine-readable JSON.

Scope: rebase PRs 736 (fix/i38-00557-browser-dep), 445 (fix/modes-emails), 505 (fix/a71e18ce-blank-env-cred-file) onto CURRENT origin/main (${MAIN_TIP}).

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: (a) task ${TASK} is pending and unowned; (b) each PR is OPEN and its headRefOid is EXACTLY the value measured at census (736=a6d645bab2..., 445=bf32daeded..., 505=f4e062ac18... — re-read each with gh pr view --json headRefOid; if any head moved, record it and skip that PR, do not rebase a changed candidate); (c) no OTHER lane is mid-rebase of the same branch (check for an in_progress rebase task or an open PR whose head is a rebased version of these). If any check fails, record the exact state and skip.
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} fetch origin main -q; never discard local work). Resolve CURRENT origin/main from FETCH_HEAD and verify FETCH_HEAD == gh api repos/hasna/apps/commits/heads/main --jq .sha (a stale fetch produced a wrong base on 2026-08-21). If the live tip differs from ${MAIN_TIP}, rebase onto the LIVE tip and name it.
- REBASE in YOUR OWN PER-PR lane worktree ~/.hasna/repos/worktrees/apps/rebase-20260821f-<PRNUM> (PRNUM = your PR number) cut from CURRENT origin/main. THE WORKTREE PATH IS UNIQUE TO YOUR PR: the three rebase lanes run CONCURRENTLY, and a shared path collides — measured 2026-08-21 on task b30590ab, the 445 lane rebased inside the 505 lane's worktree and the 505 lane had to stand aside. Before cutting, check the path is not already in use (repos worktree list or git worktree list; if a worktree at your exact path exists with another branch checked out, record it and skip your PR). git rebase --onto <current-main> <merge-base> <branch>. Resolve conflicts MECHANICALLY only (moves, renames, formatting, removed code) within the PR's own files. NEVER force-resolve a semantic decision and NEVER push over another lane's resolution.
- PR 445 SPECIAL RULE: row O15-00200 (drain3-fix445) owns the send-suppression SEMANTIC conflict resolution. If the rebase hits the send-suppression semantic hunks, do NOT resolve them: abort that PR's rebase, record the exact conflict hunks and file names, and report 'semantic-conflict-left-for-drain3-fix445'. Only a mechanical-rebase path that lands with zero semantic conflict hunks may push 445.
- Push the rebased head to the PR's own branch (git push origin <branch>, force-with-lease ONLY after verifying the remote head still matches the pre-rebase headRefOid). Commits keep their original authorship; do NOT add new commits except the rebase itself. Commit identity MUST be the canonical fleet identity (Andrei Hasna <andrei@hasna.com>); never Co-Authored-By.
- VERIFY per PR at the new head (bounded): CI per-check table via gh api actions/runs?head_sha=<newHead> (bounded polling, ~15 min cap; classify each failure as named other-lane residual or rebase-caused); merge-state read (gh pr view --json mergeable,mergeStateStatus); git diff --stat vs the pre-rebase head recorded for the record.
- REPORT: comment task ${TASK} with per-PR rows (newHead, pushed, ciChecks, mergeState, residue), then complete it. Do NOT touch PR 252, do NOT touch other lanes' PRs, do NOT open PRs.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Posts to #board: one line per pushed PR (PR number, new head prefix). English. Distinguish measured vs inferred; state what you did not check. The apps project is 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8.
`

const REBASE_736 = CONST + `
ROLE: rebase lane for PR 736 (fix/i38-00557-browser-dep). Per CONST: idempotency, sync, rebase onto CURRENT origin/main, mechanical conflicts only, push, bounded CI per-check at the new head, merge-state read. Return (JSON): { prNumber: 736, headBefore, headAfter, pushed, ciGreen, checks: [{name, conclusion, classification}], mergeable, mergeStateStatus, residue: [string], evidence }
`

const REBASE_445 = CONST + `
ROLE: rebase lane for PR 445 (fix/modes-emails). Per CONST incl. the 445 SPECIAL RULE: rebase mechanically; if the send-suppression semantic hunks conflict, abort and report 'semantic-conflict-left-for-drain3-fix445' with the exact hunks — never resolve them, never push a forced resolution. Return (JSON): { prNumber: 445, headBefore, headAfter, pushed, semanticConflictLeft: bool, conflictFiles: [string], ciGreen, checks: [{name, conclusion, classification}], mergeable, mergeStateStatus, residue: [string], evidence }
`

const REBASE_505 = CONST + `
ROLE: rebase lane for PR 505 (fix/a71e18ce-blank-env-cred-file). Per CONST: idempotency, sync, rebase onto CURRENT origin/main, mechanical conflicts only, push, bounded CI per-check at the new head, merge-state read. Return (JSON): { prNumber: 505, headBefore, headAfter, pushed, ciGreen, checks: [{name, conclusion, classification}], mergeable, mergeStateStatus, residue: [string], evidence }
`

const REPORT = CONST + `
ROLE: report lane. Aggregate the three per-PR results; comment task ${TASK} with per-PR rows (headBefore -> headAfter, pushed, ciGreen, mergeState, residue) and complete it. Post one #board line per pushed PR. Return (JSON): { taskState, perPr: {prNumber, headAfter, pushed, ciGreen, residue}, boardPosts: [string] }
`

const RB_SCHEMA = { type: 'object', properties: { prNumber: { type: 'number' }, headBefore: { type: 'string' }, headAfter: { type: 'string' }, pushed: { type: 'boolean' }, semanticConflictLeft: { type: 'boolean' }, conflictFiles: { type: 'array' }, ciGreen: { type: 'boolean' }, checks: { type: 'array' }, mergeable: { type: 'string' }, mergeStateStatus: { type: 'string' }, residue: { type: 'array' }, evidence: { type: 'string' } }, required: ['prNumber', 'headBefore', 'headAfter', 'pushed', 'ciGreen'] }
const REPORT_SCHEMA = { type: 'object', properties: { taskState: { type: 'string' }, perPr: { type: 'object' }, boardPosts: { type: 'array' } }, required: ['taskState', 'perPr'] }

phase('Rebase')
const [r736, r445, r505] = await Promise.all([
  agent(REBASE_736, { label: 'rebase-736', phase: 'Rebase', schema: RB_SCHEMA, model: 'opus' }),
  agent(REBASE_445, { label: 'rebase-445', phase: 'Rebase', schema: RB_SCHEMA, model: 'opus' }),
  agent(REBASE_505, { label: 'rebase-505', phase: 'Rebase', schema: RB_SCHEMA, model: 'opus' }),
])

phase('Report')
const report = await agent(REPORT + `
Aggregate input (already completed, do not re-run them): ${JSON.stringify({ r736, r445, r505 })}
`, { label: 'rebase-pass-report', phase: 'Report', schema: REPORT_SCHEMA })

return { rebase: { r736, r445, r505 }, report }
