export const meta = {
  name: 'loops-runner-episodes-r2c2',
  description: 'CYCLE 2 (FINAL) remediation for row b3d57dd3 (PR 790, loops runner-failure-episodes successor): the r2 lane (wf_143b4ddf-0a7) delivered PR 790 at 512ed05c with all 5 findings closed and every non-base gate green, and the cycle-1 re-review returned ONE P1: base-movement — head cut from 738590fc, main moved to 0ab74a73, merge-tree differs (53 main-side files), UNREVIEWED AT HEAD (resume condition recorded on the row). This lane: rebase fix/loops-runner-episodes-r1 onto the LIVE origin/main tip (re-measure at every step), re-verify (suite, F1..F5 regressions, frozen install, CI per-check vs the then-live main, diff, secrets), fresh same-lens verdict at the final head, base gate + LAND IMMEDIATELY after GO, complete row b3d57dd3 + comment 75810ba9. Two-cycle cap: this is the LAST cycle in the lineage — on NO_GO the candidate terminates.',
  phases: [
    { title: 'Remediate', detail: 'idempotency check; rebase PR 790 onto LIVE origin/main tip; suite + F1..F5 regressions + frozen install + CI per-check at final head' },
    { title: 'Review-2', detail: 'same-lens Fable re-review at the final head naming the LIVE origin/main (merge-tree equality); scope = rebase result + direct regressions only' },
    { title: 'Land', detail: 'base-movement gate vs LIVE origin/main + squash merge --body-file Agent trailer + complete row b3d57dd3 + comment on 75810ba9' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = 'b3d57dd3'
const FEATURE_ROW = '75810ba9'
const PR = '790'
const OLD_HEAD = '512ed05c5cab292899c4b3b87eef7c02d3d14f1c'

const CONST = `
You are the loops-runner-episodes-r2 CYCLE-2 (FINAL) remediation lane (row ${ROW}; owner-authorized via the task-drain queue; cycle 2 of 2 in the SAME review lineage — the bounded-review cap means NO further cycle exists after this one). Final text = machine-readable JSON.

Context: the r2 successor lane (wf_143b4ddf-0a7) delivered PR ${PR} (branch fix/loops-runner-episodes-r1, head ${OLD_HEAD}) carrying the runner-failure-episodes feature with all 5 terminated-PR-778 findings closed (F1..F5, red-before/green-after) — suite 1318 pass/8 fail (the 8 fail identically on a pristine origin/main 0ab74a73 checkout), CI 4 failing jobs each matching current main's own run failure-for-failure, diff gate apps/loops + changeset only, secrets scan rc=0/0 findings, canonical identity, single Agent trailer. The cycle-1 re-review returned exactly ONE P1: base-movement — the head was cut from origin/main 738590fc, main moved to 0ab74a73, merge-tree(0ab74a73, ${OLD_HEAD}) differs from the head tree (53 files, all main-side), so the PR is UNREVIEWED AT HEAD as-is. Everything else passed. This lane executes exactly the recorded resume condition: rebase onto the LIVE tip, re-verify, fresh same-lens verdict, land immediately. Two-cycle cap: this is the FINAL cycle — on NO_GO the candidate terminates and the row stays pending for a fresh adjudication.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: (a) row ${ROW} is pending and unowned; (b) PR ${PR} is OPEN with headRefOid exactly ${OLD_HEAD} (nothing landed since the r2 lane); (c) no OTHER open PR fixes the runner-failure-episodes class; (d) the cycle-1 NO_GO + resume condition are on record (row comment + PR comment). If ANY check fails, record the exact state and STOP.
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} fetch origin main -q; never discard local work). Resolve CURRENT origin/main from FETCH_HEAD and verify FETCH_HEAD == gh api repos/hasna/apps/commits/heads/main --jq .sha (a stale fetch produced a wrong base-gate verdict on 2026-08-21). MAIN MOVES SEVERAL COMMITS PER HOUR — re-measure the tip at the start, after every rebase, and immediately before the land gate; whenever the tip advanced, re-rebase onto the NEW tip. The final head MUST sit directly on the live tip measured at land time.
- REMEDIATE (in the lane worktree ~/.hasna/repos/worktrees/apps/loops-runner-episodes-r2c2 cut from the LIVE origin/main tip): rebase fix/loops-runner-episodes-r1 onto the live tip; mechanical conflicts only within the PR's own files (apps/loops + the changeset); push the rebased head with force-with-lease ONLY after verifying the remote head still equals ${OLD_HEAD}. Do NOT add new content beyond the rebase.
- VERIFY at the final head (bounded): loops suite green (literal counts — the 8 main-state failures must be named and must fail identically on the then-live main checkout); every per-finding regression F1..F5 passes (literal); 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules, literal); CI per-check table at the final head (bounded polling — classify EVERY failure against the LIVE origin/main state: main's own run must fail identically for a main-state residual (contracts 0.13.3 standard-adherence, versioning-integrity, todos frozen-lockfile, browser publish-guard); loops-caused failures MUST be green); diff gate (apps/loops + .changeset/loops-runner-episodes.md only); secrets scan clean.
- REVIEW-2 (one Fable adversarial reviewer, SAME lens — loops-runner-episodes-review): re-review ONLY the rebase result and its direct regressions: (1) the rebased diff is the same apps/loops feature with the 5 findings closed, nothing else added; (2) F1..F5 regressions pass at the final head (literal); (3) loops suite green at the final head with named main-state residuals; (4) base-movement gate vs the LIVE origin/main — merge-tree == head tree (literal); (5) no other-lane interference. Do NOT relitigate the GO'd fix shape and do NOT discover new issues outside the rebase. Post '[REVIEW] <GO|NO_GO> — loops-runner-episodes-r2c2 @ <sha> — lens: rebase result of cycle-1-GO'd candidate, reviewer loops-runner-episodes-review' to #board. Block ONLY concrete P0/P1 defects.
- LAND: on GO, re-measure the LIVE origin/main tip ONE MORE TIME, base-movement gate (merge-tree vs THAT tip; <merge-ref>^{tree} == <head>^{tree}), gh pr merge ${PR} --squash --body-file ending 'Agent: loops-runner-episodes-r1-land' (last line; never Co-Authored-By), record the merged sha, LIVE-VERIFY the runner-episodes surface at the merged main tip (bounded), complete row ${ROW} with evidence and add a landing-evidence comment on feature row ${FEATURE_ROW} (already completed as superseded 12:49:26Z — comment only, never re-complete). LAND IMMEDIATELY — do not defer. On NO_GO: comment findings + resume condition, leave open, row stays pending (candidate terminates — no further cycle exists).
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on PR ${PR} and rows ${ROW}/${FEATURE_ROW}, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8.
`

const REMEDIATE = CONST + `
ROLE: remediate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Rebase PR ${PR} onto the LIVE origin/main tip in the lane worktree; re-rebase onto every newer tip; mechanical conflicts only; push (force-with-lease after verifying remote head == ${OLD_HEAD}); run the gates at the final head (loops suite with main-state classification, F1..F5 regressions, frozen install, CI per-check vs the LIVE tip, diff gate, secrets). Return (JSON): { mainTip, newHead, diffFiles: [string], suiteCounts: {passed, failed}, regressions: [{finding, rc}], frozenInstallRc, ciGreen, checks: [{name, conclusion, classification}], diffGatePass, secretsClean, pushed, evidence }
`

const REVIEW2 = CONST + `
ROLE: cycle-2 re-reviewer (Fable, SAME lens — loops-runner-episodes-review). Re-review ONLY the rebase result and its direct regressions (per CONST): (1) diff = the same apps/loops feature with the 5 findings closed, (2) F1..F5 regressions pass at the final head (literal), (3) loops suite green with named main-state residuals, (4) base-movement gate vs the LIVE origin/main (merge-tree == head tree), (5) no other-lane interference. Do NOT relitigate the cycle-1-GO'd fix shape or discover unrelated issues. Post '[REVIEW] <GO|NO_GO> — loops-runner-episodes-r2c2 @ <sha> — lens: rebase result of cycle-1-GO'd candidate, reviewer loops-runner-episodes-review' to #board. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: re-measure the LIVE origin/main tip, base-movement gate (merge-tree vs that tip; <merge-ref>^{tree} == <head>^{tree}), gh pr merge ${PR} --squash --body-file ending 'Agent: loops-runner-episodes-r1-land', record merged sha, LIVE-VERIFY the runner-episodes surface at the merged main tip (bounded), complete row ${ROW} with evidence and comment landing evidence on ${FEATURE_ROW} (comment only). LAND IMMEDIATELY. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, liveVerifyRc, rowState, featureRowState, residue: [] }
`

const REMEDIATE_SCHEMA = { type: 'object', properties: { mainTip: { type: 'string' }, newHead: { type: 'string' }, diffFiles: { type: 'array' }, suiteCounts: { type: 'object' }, regressions: { type: 'array' }, frozenInstallRc: { type: 'number' }, ciGreen: { type: 'boolean' }, checks: { type: 'array' }, diffGatePass: { type: 'boolean' }, secretsClean: { type: 'boolean' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'suiteCounts', 'ciGreen'] }
const REVIEW2_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, liveVerifyRc: { type: ['number', 'null'] }, rowState: { type: 'string' }, featureRowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Remediate')
const remediate = await agent(REMEDIATE, { label: 'loops-episodes-r2c2-remediate', phase: 'Remediate', schema: REMEDIATE_SCHEMA, model: 'opus' })

phase('Review-2')
const review2 = remediate && remediate.pushed
  ? await agent(REVIEW2, { label: 'loops-episodes-r2c2-review2', phase: 'Review-2', schema: REVIEW2_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'remediation did not complete', detail: JSON.stringify({ remediate }) }] }

phase('Land')
const land = review2 && review2.verdict === 'GO'
  ? await agent(LAND, { label: 'loops-episodes-r2c2-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, liveVerifyRc: null, rowState: 'pending', featureRowState: 'completed', residue: ['NO_GO at cycle 2 — candidate terminated; adjudication required'] }

return { remediate: remediate && { newHead: remediate.newHead, suiteCounts: remediate.suiteCounts, ciGreen: remediate.ciGreen }, review2: review2 && review2.verdict, land }
