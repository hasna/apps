export const meta = {
  name: 'attachments-help-bind-r3',
  description: 'THE LINEAGE\'S ONE SUCCESSOR for row 970d7c6f (PR 766) after the cycle-2 NO_GO (wf_39d6b34d-cfb, board 720671): the fix content is byte-identical and GO\'d at every head (c2113193, 8658ebef, 4e2dd7065); every NO_GO/hold was base movement (main moved 4x mid-lane: 054b69e5 -> 0a462730 -> 4bc89b39 -> 5e66a4a6 -> 4374c497). Remediation cap reached -> this is the adjudication successor, NOT a third remediation cycle. Lane: rebase the same 3-file fix onto the LIVE origin/main tip (re-measure at run time and at every rebase step), suite + probes, fresh same-lens verdict, base gate, LAND IMMEDIATELY after GO (main moves several commits/hour). If this successor also returns NO_GO, the lineage STOPS as an engineering blocker — no further successors.',
  phases: [
    { title: 'Remediate', detail: 'idempotency check; rebase PR 766 onto LIVE origin/main tip (re-measure at run time, re-rebase onto every newer tip); suite 61/61 + two-sided probes at final head' },
    { title: 'Review-3', detail: 'same-lens Fable re-review at the final head naming the LIVE origin/main (merge-tree equality); scope = rebase result + direct regressions only' },
    { title: 'Land', detail: 'base-movement gate vs LIVE origin/main + squash merge --body-file Agent trailer + complete row 970d7c6f' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '970d7c6f'
const PR = '766'
const OLD_HEAD = '4e2dd7065a5dbfd30766ce90abff8ead74e597af'

const CONST = `
You are the attachments-help-bind-r3 lane (row ${ROW}; owner-authorized via the task-drain queue; THE LINEAGE'S ONE SUCCESSOR — the bounded-review policy's single adjudication successor, NOT a third remediation cycle). Final text = machine-readable JSON.

Context: PR ${PR} (branch fix/970d7c6f-attachments-serve-help-before-bind) fixes the bind-before-help defect (3 files: apps/attachments/src/serve/index.ts + early-args.test.ts + changeset). The fix content is BYTE-IDENTICAL and GO'd at every head: base review GO at c21131933, cycle-1 re-review GO at 8658ebef, cycle-2 re-review NO_GO at 4e2dd7065 (P1: base-movement gate fails vs CURRENT origin/main 4374c497 — main advanced 4 commits past the head parent; P2: CI red main-state-classified, attachments itself green). Every refusal in this lineage was base movement, never a fix finding. Remediation cap (2 cycles) is REACHED — this lane is the adjudication successor. If THIS lane also returns NO_GO, the lineage STOPS as an engineering blocker: row stays pending with the findings, no further successor.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: (a) row ${ROW} is pending and unowned; (b) PR ${PR} is OPEN with headRefOid exactly ${OLD_HEAD} (nothing landed since the r2 lane); (c) no OTHER open PR fixes the attachments-serve help-before-bind class; (d) the GO lineage and every base-movement refusal are on record (PR comments 5368953590/5369333356/5369734138, board 720413/720549/720671). If ANY check fails, record the exact state and STOP.
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} fetch origin main -q; never discard local work). Resolve CURRENT origin/main from FETCH_HEAD and verify FETCH_HEAD == gh api repos/hasna/apps/commits/heads/main --jq .sha (a stale fetch produced a wrong base-gate verdict on 2026-08-21). MAIN MOVES SEVERAL COMMITS PER HOUR — re-measure the tip at the start, after every rebase, and immediately before the land gate; whenever the tip advanced, re-rebase onto the NEW tip (r1/r2 precedent: re-rebased mid-lane twice each). The final head MUST sit directly on the live tip measured at land time.
- REMEDIATE (in the lane worktree ~/.hasna/repos/worktrees/apps/attachments-help-bind-r3 cut from the LIVE origin/main tip): rebase fix/970d7c6f-attachments-serve-help-before-bind onto the live tip; resolve mechanical conflicts only within the PR's own files (the PR is 3 files, delta confined to apps/attachments); push the rebased head with force-with-lease ONLY after verifying the remote head still equals ${OLD_HEAD}. Do NOT add new content beyond the rebase. Verify the rebased patch is byte-identical to the reviewed fix (cmp the patch vs the 4e2dd7065 patch, literal).
- VERIFY at the final head (bounded): attachments suite 61/61 green (literal counts); the two-sided probes re-run (--help/--version rc=0 WITHOUT pool creation; plain serve still creates the pool/binds — literal); 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules, literal); CI per-check table at the final head (bounded polling — classify EVERY failure against the LIVE origin/main state: main's own run must fail identically for it to be a main-state residual; attachments-caused failures MUST be green); secrets scan clean.
- REVIEW-3 (one Fable adversarial reviewer, SAME lens — attachments-help-bind-review): re-review ONLY the rebase result and its direct regressions: (1) the rebased diff is the same 3-file attachments fix, byte-identical to the reviewed content; (2) attachments suite 61/61 green at the final head (literal); (3) the two-sided probes pass (literal); (4) base-movement gate vs the LIVE origin/main — merge-tree == head tree (literal); (5) no other-lane interference. Do NOT relitigate the GO'd fix shape and do NOT discover new issues outside the rebase. Post '[REVIEW] <GO|NO_GO> — attachments-help-bind-r3 @ <sha> — lens: rebase result of GO'd fix, reviewer attachments-help-bind-review' to #board. Block ONLY concrete P0/P1 defects.
- LAND: on GO, re-measure the LIVE origin/main tip ONE MORE TIME, base-movement gate (merge-tree vs THAT tip; <merge-ref>^{tree} == <head>^{tree}), gh pr merge ${PR} --squash --body-file ending 'Agent: attachments-help-bind-fix-land' (last line; never Co-Authored-By), record the merged sha, LIVE-VERIFY the attachments suite at the merged main tip (bounded), complete row ${ROW} with evidence. LAND IMMEDIATELY — do not defer. On NO_GO: comment findings + the lineage-stop note, leave open, row stays pending.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on PR ${PR} and row ${ROW}, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8.
`

const REMEDIATE = CONST + `
ROLE: remediate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Rebase PR ${PR} onto the LIVE origin/main tip in the lane worktree; re-rebase onto every newer tip; mechanical conflicts only; verify patch byte-identical to the reviewed 4e2dd7065 fix; push (force-with-lease after verifying remote head == ${OLD_HEAD}); then run the gates at the final head (suite 61/61, probes, frozen install, CI per-check with main-state classification vs the LIVE tip, secrets). Return (JSON): { mainTip, newHead, patchByteIdentical, diffFiles: [string], suiteCounts: {passed, failed}, probes: {helpNoPool, serveBinds}, frozenInstallRc, ciGreen, checks: [{name, conclusion, classification}], secretsClean, pushed, evidence }
`

const REVIEW3 = CONST + `
ROLE: cycle successor re-reviewer (Fable, SAME lens — attachments-help-bind-review). Re-review ONLY the rebase result and its direct regressions (per CONST): (1) diff = the same 3-file attachments fix, byte-identical, (2) suite 61/61 green at final head (literal), (3) probes pass (literal), (4) base-movement gate vs the LIVE origin/main (merge-tree == head tree), (5) no other-lane interference. Do NOT relitigate the GO'd fix shape or discover unrelated issues. Post '[REVIEW] <GO|NO_GO> — attachments-help-bind-r3 @ <sha> — lens: rebase result of GO'd fix, reviewer attachments-help-bind-review' to #board. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: re-measure the LIVE origin/main tip, base-movement gate (merge-tree vs that tip; <merge-ref>^{tree} == <head>^{tree}), gh pr merge ${PR} --squash --body-file ending 'Agent: attachments-help-bind-fix-land', record merged sha, LIVE-VERIFY the attachments suite at the merged main tip (bounded), complete row ${ROW} with evidence. LAND IMMEDIATELY. If NO_GO: comment findings + the lineage-stop note, leave open. Return (JSON): { merged, mergedSha, liveSuiteCounts: {passed, failed}, rowState, residue: [] }
`

const REMEDIATE_SCHEMA = { type: 'object', properties: { mainTip: { type: 'string' }, newHead: { type: 'string' }, patchByteIdentical: { type: 'boolean' }, diffFiles: { type: 'array' }, suiteCounts: { type: 'object' }, probes: { type: 'object' }, frozenInstallRc: { type: 'number' }, ciGreen: { type: 'boolean' }, checks: { type: 'array' }, secretsClean: { type: 'boolean' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'suiteCounts', 'ciGreen'] }
const REVIEW3_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, liveSuiteCounts: { type: ['object', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Remediate')
const remediate = await agent(REMEDIATE, { label: 'attachments-help-r3-remediate', phase: 'Remediate', schema: REMEDIATE_SCHEMA, model: 'opus' })

phase('Review-3')
const review3 = remediate && remediate.pushed
  ? await agent(REVIEW3, { label: 'attachments-help-r3-review3', phase: 'Review-3', schema: REVIEW3_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'remediation did not complete', detail: JSON.stringify({ remediate }) }] }

phase('Land')
const land = review3 && review3.verdict === 'GO'
  ? await agent(LAND, { label: 'attachments-help-r3-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, liveSuiteCounts: null, rowState: 'pending', residue: ['NO_GO — lineage STOPPED as engineering blocker per bounded-review policy; row stays pending'] }

return { remediate: remediate && { newHead: remediate.newHead, patchByteIdentical: remediate.patchByteIdentical, suiteCounts: remediate.suiteCounts, ciGreen: remediate.ciGreen }, review3: review3 && review3.verdict, land }
