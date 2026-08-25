export const meta = {
  name: 'domains-residue-land',
  description: 'Land lane for row 4b6d85af (dead cloud-http transport vocabulary in @hasna/domains after #754): reopen the GO-reviewed PR 759 (head d5b09fdc, closed-unmerged by the domains-ts2367 lane recovery) -> re-measure the base-movement gate vs CURRENT origin/main -> bounded CI -> squash merge with Agent trailer -> live-verify domains member build -> complete row with evidence.',
  phases: [
    { title: 'Verify', detail: 'idempotency check; PR 759 closed + head d5b09fdc intact + GO verdict recorded; base-movement gate vs CURRENT origin/main; CI at head bounded' },
    { title: 'Reopen', detail: 'reopen PR 759, confirm head unchanged' },
    { title: 'Merge', detail: 'base gate + squash merge --body-file with Agent trailer' },
    { title: 'Complete', detail: 'live-verify domains member build at merged main, complete row 4b6d85af with evidence' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '4b6d85af'
const PR = '759'
const HEAD = 'd5b09fdcb8bcff98a5319ba933895b74a71f9f77'

const CONST = `
You are the domains-residue land lane (row ${ROW}; owner-authorized via the task-drain queue). Final text = machine-readable JSON.

Context: row ${ROW} tracks dead 'cloud-http' transport vocabulary remaining in @hasna/domains after PR 754 merged (store.ts:88 union member, :259 ApiStore const, doctor.ts:53-54 banner, transport-token expectations in 3 test files). The domains-ts2367 lane built the fix (branch fix/domains-ts2367, head ${HEAD}, PR ${PR}), its Fable review returned GO at that exact head, but the land phase closed the PR unmerged (08:07:05Z) because row 0fdd8998 was already completed by recovery. The GO verdict + the candidate are intact; this lane lands the exact reviewed candidate.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: (a) row ${ROW} is pending and unowned (no in_progress fixer row; comments carry no live workstream); (b) PR ${PR} is CLOSED with headRefOid EXACTLY ${HEAD} (gh pr view ${PR} --repo hasna/apps --json state,headRefOid); (c) no OTHER open PR touches the same files (gh pr list --repo hasna/apps --search 'domains in:title,body' --state open — an open PR fixing the same cloud-http residue means the lane is complete by another route: record and STOP); (d) the GO review is on record (search #board / git-publishing for '[REVIEW] GO' naming PR ${PR} or head ${HEAD}; the domains-ts2367 workflow result recorded review GO at ${HEAD}). If ANY check fails, record the exact state and STOP (no force-merge of a changed candidate).
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} fetch origin main -q; never discard local work). Resolve CURRENT origin/main from FETCH_HEAD, and verify FETCH_HEAD == gh api repos/hasna/apps/commits/heads/main --jq .sha (a stale fetch produced a wrong base-gate verdict on 2026-08-21).
- BASE-MOVEMENT GATE (mandatory, measure at CURRENT origin/main): TREE=$(git merge-tree --write-tree origin/main ${HEAD}); 'git diff --quiet ${HEAD}^{tree} "$TREE"' rc=0 REQUIRED (merge tree == head tree — the merged result is exactly the reviewed content). Also confirm 'git merge-base --is-ancestor origin/main ${HEAD}' (head contains current main). If either fails, DO NOT merge: record the divergence, leave PR open, return merged:false with the reason.
- REOPEN: gh pr reopen ${PR} --repo hasna/apps; confirm headRefOid still ${HEAD} after reopen. Do NOT push anything; do NOT change the head. If reopen fails, record and STOP.
- MERGE: gh pr merge ${PR} --repo hasna/apps --squash --body-file <file ending with 'Agent: domains-residue-land' as its LAST line> (never Co-Authored-By; canonical identity Andrei Hasna <andrei@hasna.com>). Record the merged sha. If the merge is refused for any reason, capture the literal error and return merged:false with the reason — do not retry aggressively.
- LIVE-VERIFY (bounded): at the merged main tip, the domains member build passes (bun run build in apps/domains after a frozen install in a THROWAWAY worktree cut from the merged main — or reuse the canonical worktree if one exists at the merged state; literal rc + output). Bounded: one attempt; if the build is slow, cap at 20 min.
- COMPLETE: complete row ${ROW} with the evidence (merged sha, base-gate result, review verdict pointer, live build rc). If merged:false, comment the exact resume condition on the row and leave pending.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on PR ${PR} and row ${ROW}, one post to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8.
`

const VERIFY = CONST + `
ROLE: verify lane (Opus). Run the IDEMPOTENCY CHECK FIRST + the base-movement gate at CURRENT origin/main (merge-tree == head tree, literal rc; head contains current main, literal). Confirm PR ${PR} closed with head ${HEAD}, GO verdict on record, no competing open PR. Return (JSON): { mainTip, prState, headIntact: bool, goVerdictOnRecord: bool, competingPr: number|null, mergeTreeEqual: bool, headContainsMain: bool, evidence }
`

const REOPEN = CONST + `
ROLE: reopen lane. gh pr reopen ${PR} --repo hasna/apps; verify headRefOid still ${HEAD} and state OPEN. Return (JSON): { reopened: bool, state, headRefOid, evidence }
`

const MERGE = CONST + `
ROLE: merge lane. At the verified state: gh pr merge ${PR} --squash --body-file ending 'Agent: domains-residue-land' (last line), record merged sha (gh pr view ${PR} --json mergedAt,mergeCommit). If refused, capture the literal error. Return (JSON): { merged: bool, mergedSha: string|null, reason: string|null, evidence }
`

const COMPLETE = CONST + `
ROLE: complete lane. If merged: LIVE-VERIFY the domains member build at the merged main tip (bounded, literal rc); complete row ${ROW} with the evidence (merged sha, base-gate result, review verdict pointer, live build rc). If not merged: comment the exact resume condition on the row, leave pending. Return (JSON): { rowState, liveBuildRc: number|null, mergedSha: string|null, residue: [string] }
`

const VERIFY_SCHEMA = { type: 'object', properties: { mainTip: { type: 'string' }, prState: { type: 'string' }, headIntact: { type: 'boolean' }, goVerdictOnRecord: { type: 'boolean' }, competingPr: { type: ['number', 'null'] }, mergeTreeEqual: { type: 'boolean' }, headContainsMain: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['mainTip', 'headIntact', 'mergeTreeEqual', 'headContainsMain'] }
const REOPEN_SCHEMA = { type: 'object', properties: { reopened: { type: 'boolean' }, state: { type: 'string' }, headRefOid: { type: 'string' }, evidence: { type: 'string' } }, required: ['reopened', 'headRefOid'] }
const MERGE_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, reason: { type: ['string', 'null'] }, evidence: { type: 'string' } }, required: ['merged'] }
const COMPLETE_SCHEMA = { type: 'object', properties: { rowState: { type: 'string' }, liveBuildRc: { type: ['number', 'null'] }, mergedSha: { type: ['string', 'null'] }, residue: { type: 'array' } }, required: ['rowState'] }

phase('Verify')
const verify = await agent(VERIFY, { label: 'domains-residue-verify', phase: 'Verify', schema: VERIFY_SCHEMA, model: 'opus' })

phase('Reopen')
const reopen = verify && verify.headIntact && verify.mergeTreeEqual && verify.headContainsMain && verify.goVerdictOnRecord && !verify.competingPr
  ? await agent(REOPEN, { label: 'domains-residue-reopen', phase: 'Reopen', schema: REOPEN_SCHEMA })
  : null

phase('Merge')
const merge = reopen && reopen.reopened && reopen.headRefOid === HEAD
  ? await agent(MERGE, { label: 'domains-residue-merge', phase: 'Merge', schema: MERGE_SCHEMA })
  : { merged: false, mergedSha: null, reason: 'verify/reopen gate not passed: ' + JSON.stringify({ verify, reopen }), evidence: '' }

phase('Complete')
const complete = await agent(COMPLETE, { label: 'domains-residue-complete', phase: 'Complete', schema: COMPLETE_SCHEMA })

return { verify, reopen, merge, complete }
