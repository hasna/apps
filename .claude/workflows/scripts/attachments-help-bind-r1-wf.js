export const meta = {
  name: 'attachments-help-bind-r1',
  description: 'Cycle-1 remediation for row 970d7c6f (PR 766): the land phase correctly refused the merge on the base-movement gate (review GO at c21131933 vs origin/main advanced to 054b69e5 wave #764 — UNREVIEWED AT HEAD). This lane executes the recorded resume condition: rebase fix/970d7c6f-attachments-serve-help-before-bind onto CURRENT origin/main, re-run the gates at the new head, fresh [REVIEW] verdict naming CURRENT origin/main, base gate + squash merge + complete the row.',
  phases: [
    { title: 'Remediate', detail: 'idempotency check; rebase PR 766 onto CURRENT origin/main; re-run attachments gates at the new head (suite 61/61, --help/--version rc=0 no-pool probes, plain-serve fatal probe, frozen install, secrets)' },
    { title: 'Review-2', detail: 'same-lens Fable re-review at the new head naming CURRENT origin/main (merge-tree equality); scope = rebase result + direct regressions only' },
    { title: 'Land', detail: 'base-movement gate vs CURRENT origin/main + squash merge --body-file Agent trailer + complete row 970d7c6f' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = '970d7c6f'
const PR = '766'
const OLD_HEAD = 'c21131933b3d3d3347d57fc58a432764f8d03ea6'

const CONST = `
You are the attachments-help-bind-r1 remediation lane (row ${ROW}; owner-authorized via the task-drain queue). Final text = machine-readable JSON.

Context: the attachments-help-bind lane (wf_b2587511-22c) fixed the bind-before-help defect (PR ${PR}, branch fix/970d7c6f-attachments-serve-help-before-bind, head ${OLD_HEAD}), its Fable review returned GO at that head, but the land phase correctly REFUSED the merge: origin/main advanced from 43624297 to 054b69e5 (version wave #764) after the review — merge-tree(054b69e5, ${OLD_HEAD}) != reviewed tree, UNREVIEWED AT HEAD (PR comment 5368953590, board 720413). This lane executes exactly that recorded resume condition — one remediation step in the SAME review lineage, NOT a new candidate.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: (a) row ${ROW} is pending and unowned; (b) PR ${PR} is OPEN with headRefOid exactly ${OLD_HEAD} (nothing landed since the land lane); (c) no OTHER open PR fixes the attachments-serve help-before-bind class; (d) the GO at ${OLD_HEAD} and the base-movement refusal are both on record. If ANY check fails, record the exact state and STOP.
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} fetch origin main -q; never discard local work). Resolve CURRENT origin/main from FETCH_HEAD and verify FETCH_HEAD == gh api repos/hasna/apps/commits/heads/main --jq .sha (a stale fetch produced a wrong base-gate verdict on 2026-08-21).
- REMEDIATE (in the lane worktree ~/.hasna/repos/worktrees/apps/attachments-help-bind-r1 cut from CURRENT origin/main): rebase fix/970d7c6f-attachments-serve-help-before-bind onto CURRENT origin/main; resolve mechanical conflicts only within the PR's own files (the PR is 3 files, delta confined to apps/attachments); push the rebased head with force-with-lease ONLY after verifying the remote head still equals ${OLD_HEAD}. Do NOT add new content beyond the rebase.
- VERIFY at the new head (bounded): attachments suite 61/61 green (literal counts); the two-sided probes re-run (--help/--version rc=0 WITHOUT pool creation; plain serve still creates the pool/binds — literal); 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules, literal); CI per-check table at the new head (gh api actions/runs?head_sha=<sha> + per-job conclusions, bounded polling — classify the publish-guard failure against CURRENT main state: the apps/browser TS2307 member-prepack class is owned by row 0cbbd621 with a fix lane in flight; attachments-caused failures MUST be green); secrets scan clean.
- REVIEW-2 (one Fable adversarial reviewer, SAME lens — attachments-help-bind-review): re-review ONLY the rebase result and its direct regressions: (1) the rebased diff is the same 3-file attachments fix, nothing else added; (2) attachments suite 61/61 green at the new head (literal); (3) the two-sided probes pass (literal); (4) base-movement gate vs CURRENT origin/main — merge-tree == head tree (literal); (5) no other-lane interference. Do NOT relitigate the GO'd fix shape (help-before-pool startup order) and do NOT discover new issues outside the rebase. Post '[REVIEW] <GO|NO_GO> — attachments-help-bind-r1 @ <sha> — lens: rebase result of GO'd fix, reviewer attachments-help-bind-review' to #board.
- LAND: on GO, base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge ${PR} --squash --body-file ending 'Agent: attachments-help-bind-fix-land' (last line; never Co-Authored-By), record the merged sha, LIVE-VERIFY the attachments suite at the merged main tip (bounded), complete row ${ROW} with evidence. On NO_GO: comment findings + resume condition, leave open, row stays pending.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on PR ${PR} and row ${ROW}, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8.
`

const REMEDIATE = CONST + `
ROLE: remediate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Rebase PR ${PR} onto CURRENT origin/main in the lane worktree; mechanical conflicts only; push (force-with-lease after verifying remote head == ${OLD_HEAD}); then run the gates at the new head (suite 61/61, probes, frozen install, CI per-check with publish-guard classified vs row 0cbbd621's live fix lane, secrets). Return (JSON): { mainTip, newHead, diffFiles: [string], suiteCounts: {passed, failed}, probes: {helpNoPool, serveBinds}, frozenInstallRc, ciGreen, checks: [{name, conclusion, classification}], publishGuardClassified: bool, secretsClean, pushed, evidence }
`

const REVIEW2 = CONST + `
ROLE: cycle re-reviewer (Fable, SAME lens — attachments-help-bind-review). Re-review ONLY the rebase result and its direct regressions (per CONST): (1) diff = the same 3-file attachments fix, (2) suite 61/61 green at new head (literal), (3) probes pass (literal), (4) base-movement gate vs CURRENT origin/main (merge-tree == head tree), (5) no other-lane interference. Do NOT relitigate the GO'd fix shape or discover unrelated issues. Post '[REVIEW] <GO|NO_GO> — attachments-help-bind-r1 @ <sha> — lens: rebase result of GO'd fix, reviewer attachments-help-bind-review' to #board. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: base-movement gate (merge-tree vs CURRENT origin/main; <merge-ref>^{tree} == <head>^{tree}), gh pr merge ${PR} --squash --body-file ending 'Agent: attachments-help-bind-fix-land', record merged sha, LIVE-VERIFY the attachments suite at the merged main tip (bounded), complete row ${ROW} with evidence. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, liveSuiteCounts: {passed, failed}, rowState, residue: [] }
`

const REMEDIATE_SCHEMA = { type: 'object', properties: { mainTip: { type: 'string' }, newHead: { type: 'string' }, diffFiles: { type: 'array' }, suiteCounts: { type: 'object' }, probes: { type: 'object' }, frozenInstallRc: { type: 'number' }, ciGreen: { type: 'boolean' }, checks: { type: 'array' }, publishGuardClassified: { type: 'boolean' }, secretsClean: { type: 'boolean' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'suiteCounts', 'ciGreen'] }
const REVIEW2_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, liveSuiteCounts: { type: ['object', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Remediate')
const remediate = await agent(REMEDIATE, { label: 'attachments-help-r1-remediate', phase: 'Remediate', schema: REMEDIATE_SCHEMA, model: 'opus' })

phase('Review-2')
const review2 = remediate && remediate.pushed
  ? await agent(REVIEW2, { label: 'attachments-help-r1-review2', phase: 'Review-2', schema: REVIEW2_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'remediation did not complete', detail: JSON.stringify({ remediate }) }] }

phase('Land')
const land = review2 && review2.verdict === 'GO'
  ? await agent(LAND, { label: 'attachments-help-r1-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, liveSuiteCounts: null, rowState: 'pending', residue: ['NO_GO — see findings; row stays pending'] }

return { remediate: remediate && { newHead: remediate.newHead, suiteCounts: remediate.suiteCounts, ciGreen: remediate.ciGreen }, review2: review2 && review2.verdict, land }
