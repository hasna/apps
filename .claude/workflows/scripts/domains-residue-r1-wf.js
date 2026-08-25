export const meta = {
  name: 'domains-residue-r1',
  description: 'Remediation lane for row 4b6d85af (wave residue): per the on-record GO at current main tip (board 720053, reviewer domains-ts2367-review — "rebase (store.ts:920 hunk now no-ops) and land"), rebase fix/domains-ts2367 onto CURRENT origin/main, re-verify at the new head, same-lens re-review scoped to the rebase result, base gate + merge + complete row.',
  phases: [
    { title: 'Remediate', detail: 'idempotency check; rebase fix/domains-ts2367 onto CURRENT origin/main (drop/adapt the now no-op store.ts:920 hunk); member build + suite + frozen install + secrets at the new head' },
    { title: 'Review-2', detail: 'same-lens Fable re-review scoped ONLY to the rebase result and its direct regressions' },
    { title: 'Land', detail: 'base gate vs CURRENT origin/main + squash merge + complete row 4b6d85af' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '4b6d85af'
const PR = '759'
const OLD_HEAD = 'd5b09fdcb8bcff98a5319ba933895b74a71f9f77'

const CONST = `
You are the domains-residue-r1 remediation lane (row ${ROW}; owner-authorized via the task-drain queue). Final text = machine-readable JSON.

Context: the domains-residue land lane (wf_19e2e655-333) refused to merge PR ${PR} because the base-movement gate failed at CURRENT origin/main (merge tree != head tree; main 4 commits ahead of the branch base). The on-record GO (board 720053, '[REVIEW] GO — domains-ts2367 @ ccf0fc06c', reviewer domains-ts2367-review) reviewed the fix shape at the current tip and explicitly directs: "rebase (store.ts:920 hunk now no-ops) and land". PR ${PR} is open at head ${OLD_HEAD} with the divergence + resume condition commented (issuecomment-5367494546). This lane executes exactly that named resume condition — one remediation step within the same review lineage, NOT a new candidate.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: (a) row ${ROW} is pending and unowned; (b) PR ${PR} is OPEN with headRefOid exactly ${OLD_HEAD} (nothing landed since the land lane); (c) no OTHER open PR touches the 6 PR-759 files (.changeset/domains-ts2367.md, apps/domains/src/cli/commands/doctor.ts, apps/domains/src/db/store.ts, store-mode.test.ts, store-runner-context.test.ts, store-test-isolation.test.ts); (d) the GO at 720053 is on record naming the rebase-and-land resume condition. If ANY check fails, record the exact state and STOP.
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} fetch origin main -q; never discard local work). Resolve CURRENT origin/main from FETCH_HEAD and verify FETCH_HEAD == gh api repos/hasna/apps/commits/heads/main --jq .sha.
- REMEDIATE (in the lane worktree ~/.hasna/repos/worktrees/apps/domains-residue or a fresh one cut from CURRENT origin/main): rebase the PR-759 branch fix/domains-ts2367 onto CURRENT origin/main. Per the review's direction: the store.ts:920 hunk is now a NO-OP (PR 754 already changed the comparison to !== 'http') — drop it from the rebased diff (the hunk no longer applies cleanly or changes nothing; keep the rest: store.ts:88 union 'local'|'http', :259 ApiStore const 'http', doctor.ts:53-54 banner, the 3 test files' transport-token expectations, .changeset/domains-ts2367.md). DO NOT add new content, DO NOT touch files outside the 6 PR-759 files. Push the rebased head to fix/domains-ts2367. If the rebase conflicts with new main content, resolve only within the 6 files, record what changed, and name it in evidence.
- VERIFY at the new head (bounded): domains member build rc=0 (literal); domains suite green — zero cloud-http expectations (literal counts); 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules, literal); secrets scan clean (redirect + 'secrets scan input', rc 0 clean); grep proof that no 'cloud-http' token remains in apps/domains; CI per-check table at the new head (gh api actions/runs?head_sha=<sha> + per-job conclusions, bounded polling — classify each failure as named other-lane residual or wave-caused).
- REVIEW-2 (one Fable adversarial reviewer, SAME lens — domains-ts2367-review): re-review ONLY the rebase result and its direct regressions: (1) the rebased diff is the 6 PR-759 files with the no-op store.ts:920 hunk dropped, nothing else added; (2) member build passes at the new head (literal); (3) domains suite green — zero cloud-http tokens (literal); (4) base-movement gate vs CURRENT origin/main (merge-tree == head tree, literal); (5) no other-lane interference in the diff. Do NOT relitigate the reviewed fix shape (union 'local'|'http', const 'http', banner, tests — GO'd at 720053) or discover new issues outside the rebase. Post '[REVIEW] <GO|NO_GO> — domains-residue-r1 @ <sha> — lens: rebase result of GO'd fix, reviewer domains-ts2367-review' to #board.
- LAND: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge ${PR} --squash --body-file ending 'Agent: domains-residue-r1-land' (last line; never Co-Authored-By), record merged sha, LIVE-VERIFY the domains member build + suite at the merged main tip (bounded), complete row ${ROW} with evidence. On NO_GO: comment findings + resume condition on PR and row, leave open.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on PR ${PR} and row ${ROW}, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8.
`

const REMEDIATE = CONST + `
ROLE: remediate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Rebase fix/domains-ts2367 onto CURRENT origin/main in the lane worktree; drop the no-op store.ts:920 hunk per the review direction; keep only the 6 PR-759 files; verify member build rc=0 + suite green (zero cloud-http) + frozen install rc=0 + secrets clean + grep zero; push. Return (JSON): { mainTip, newHead, noOpHunkDropped: bool, diffFiles: [string], memberBuildRc, suiteCounts: {passed, failed}, cloudHttpGrepZero: bool, frozenInstallRc, secretsClean, pushed, evidence }
`

const REVIEW2 = CONST + `
ROLE: cycle re-reviewer (Fable, SAME lens — domains-ts2367-review). Re-review ONLY the rebase result and its direct regressions (per CONST): (1) diff = 6 PR-759 files with the no-op hunk dropped, (2) member build passes at new head (literal), (3) domains suite green — zero cloud-http tokens (literal), (4) base-movement gate vs CURRENT origin/main (merge-tree == head tree), (5) no other-lane interference. Do NOT relitigate the GO'd fix shape or discover unrelated issues. Post '[REVIEW] <GO|NO_GO> — domains-residue-r1 @ <sha> — lens: rebase result of GO'd fix, reviewer domains-ts2367-review' to #board. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge ${PR} --squash --body-file ending 'Agent: domains-residue-r1-land', record merged sha, LIVE-VERIFY domains member build + suite at merged main tip (bounded), complete row ${ROW}. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, liveBuildRc, liveSuiteCounts: {passed, failed}, rowState, residue: [] }
`

const REMEDIATE_SCHEMA = { type: 'object', properties: { mainTip: { type: 'string' }, newHead: { type: 'string' }, noOpHunkDropped: { type: 'boolean' }, diffFiles: { type: 'array' }, memberBuildRc: { type: 'number' }, suiteCounts: { type: 'object' }, cloudHttpGrepZero: { type: 'boolean' }, frozenInstallRc: { type: 'number' }, secretsClean: { type: 'boolean' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'memberBuildRc', 'cloudHttpGrepZero'] }
const REVIEW2_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, liveBuildRc: { type: ['number', 'null'] }, liveSuiteCounts: { type: ['object', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Remediate')
const remediate = await agent(REMEDIATE, { label: 'domains-residue-r1-remediate', phase: 'Remediate', schema: REMEDIATE_SCHEMA, model: 'opus' })

phase('Review-2')
const review2 = remediate && remediate.pushed
  ? await agent(REVIEW2, { label: 'domains-residue-r1-review2', phase: 'Review-2', schema: REVIEW2_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'remediation did not complete', detail: JSON.stringify({ remediate }) }] }

phase('Land')
const land = review2 && review2.verdict === 'GO'
  ? await agent(LAND, { label: 'domains-residue-r1-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, liveBuildRc: null, liveSuiteCounts: null, rowState: 'pending', residue: ['NO_GO — see findings; row stays pending'] }

return { remediate: remediate && { newHead: remediate.newHead, noOpHunkDropped: remediate.noOpHunkDropped, memberBuildRc: remediate.memberBuildRc, suiteCounts: remediate.suiteCounts, cloudHttpGrepZero: remediate.cloudHttpGrepZero }, review2: review2 && review2.verdict, land }
