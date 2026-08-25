export const meta = {
  name: 'calendar-serve-help-r2',
  description: 'CYCLE 2 (FINAL) remediation for row dd27cac0 (PR 784, calendar-serve --help binds before answering): the r1 lane (wf_1432177b-260) found the PRIOR r1 instance (todos 495) had already rebased fix/calendar-serve-help-before-bind to 01b6590c sitting directly on 0ab74a73 with gates green (declared LAND-READY 13:56Z, no verdict posted), and the review NO_GO was base-movement: main advanced to f1b21aad (browser #771, 13:57:40Z) after that rebase — merge-tree differs, UNREVIEWED AT HEAD. Resume condition recorded: rebase onto the then-live tip, re-run gates, fresh same-lens verdict at the new sha, base gate + LAND IMMEDIATELY, complete the row. Two-cycle cap: this is the LAST cycle in the lineage — on NO_GO the candidate terminates.',
  phases: [
    { title: 'Remediate', detail: 'idempotency check; rebase PR 784 onto LIVE origin/main tip; suite + two-sided probes + frozen install + CI per-check at final head' },
    { title: 'Review-2', detail: 'same-lens Fable re-review at the final head naming the LIVE origin/main (merge-tree equality); scope = rebase result + direct regressions only' },
    { title: 'Land', detail: 'base-movement gate vs LIVE origin/main + squash merge --body-file Agent trailer + complete row dd27cac0' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = 'dd27cac0'
const PR = '784'
const OLD_HEAD = '01b6590cf4d59952ba0698b55da52632c99d3dd1'

const CONST = `
You are the calendar-serve-help CYCLE-2 (FINAL) remediation lane (row ${ROW}; owner-authorized via the task-drain queue; cycle 2 of 2 in the SAME review lineage — the bounded-review cap means NO further cycle exists after this one). Final text = machine-readable JSON.

Context: the calendar-serve-help fix is VERIFIED COMPLETE at head ${OLD_HEAD} (branch fix/calendar-serve-help-before-bind): the prior r1 instance (todos 495) rebased it onto 0ab74a73 — patch byte-identical to the reviewed fdb96bccd content (3 files: apps/calendar/src/server/index.ts early-args answer, early-args.test.ts, .changeset/calendar-serve-help-before-bind.md), local gates green (--help rc=0 no-bind, --version rc=0, plain serve rc=1 + credential refusal, calendar suite, frozen install), CI fully classified with zero calendar-caused failures, declared LAND-READY at 13:56Z — but posted no fresh [REVIEW] verdict and did not land. The r1 lane (wf_1432177b-260) stopped on idempotency (stale brief) and its review NO_GO was base-movement: main advanced to f1b21aad (browser #771, landed 13:57:40Z) after that rebase — merge-tree(f1b21aad, ${OLD_HEAD}) differs from the head tree, UNREVIEWED AT HEAD. This lane executes exactly the recorded resume condition: rebase onto the LIVE tip, re-run gates, fresh same-lens verdict at the new sha, base gate + LAND IMMEDIATELY, complete the row. Two-cycle cap: this is the FINAL cycle — on NO_GO the candidate terminates.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: (a) row ${ROW} is pending and unowned; (b) PR ${PR} is OPEN with headRefOid exactly ${OLD_HEAD} (nothing landed since the prior r1 instance's rebase); (c) no OTHER open PR fixes the calendar serve-help class; (d) the cycle-1 NO_GO + resume condition are on record (row comment + PR comments). If ANY check fails, record the exact state and STOP.
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} fetch origin main -q; never discard local work). Resolve CURRENT origin/main from FETCH_HEAD and verify FETCH_HEAD == gh api repos/hasna/apps/commits/heads/main --jq .sha (a stale fetch produced a wrong base-gate verdict on 2026-08-21). MAIN MOVES SEVERAL COMMITS PER HOUR — re-measure the tip at the start, after every rebase, and immediately before the land gate; whenever the tip advanced, re-rebase onto the NEW tip. The final head MUST sit directly on the live tip measured at land time.
- REMEDIATE (in the lane worktree ~/.hasna/repos/worktrees/apps/calendar-serve-help-r2 cut from the LIVE origin/main tip): rebase fix/calendar-serve-help-before-bind onto the live tip; mechanical conflicts only within the PR's own files (the PR is confined to apps/calendar); push the rebased head with force-with-lease ONLY after verifying the remote head still equals ${OLD_HEAD}. Do NOT add new content beyond the rebase.
- VERIFY at the final head (bounded): 'calendar-serve --help' rc=0 + usage WITHOUT binding (literal); '--version' rc=0 (literal); plain serve rc=1 with the credential refusal and the bind/start still attempted (negative probe intact — literal); calendar suite green (literal counts); 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules, literal); CI per-check table at the final head (bounded polling — classify EVERY failure against the LIVE origin/main state: main's own run must fail identically for a main-state residual (contracts 0.13.3 standard-adherence, versioning-integrity, todos frozen-lockfile, browser publish-guard); calendar-caused failures MUST be green); secrets scan clean.
- REVIEW-2 (one Fable adversarial reviewer, SAME lens — calendar-serve-help-review): re-review ONLY the rebase result and its direct regressions: (1) the rebased diff is the same apps/calendar early-args fix, nothing else added; (2) 'calendar-serve --help' rc=0 no-bind at the final head (literal); (3) plain serve still refuses without credential (literal); (4) calendar suite green; (5) base-movement gate vs the LIVE origin/main — merge-tree == head tree (literal); (6) no other-lane interference. Do NOT relitigate the GO'd fix shape and do NOT discover new issues outside the rebase. Post '[REVIEW] <GO|NO_GO> — calendar-serve-help-r2 @ <sha> — lens: rebase result of GO'd fix, reviewer calendar-serve-help-review' to #board. Block ONLY concrete P0/P1 defects.
- LAND: on GO, re-measure the LIVE origin/main tip ONE MORE TIME, base-movement gate (merge-tree vs THAT tip; <merge-ref>^{tree} == <head>^{tree}), gh pr merge ${PR} --squash --body-file ending 'Agent: calendar-serve-help-fix-land' (last line; never Co-Authored-By), record the merged sha, LIVE-VERIFY 'calendar-serve --help' rc=0 at the merged main tip (bounded), complete row ${ROW} with evidence. LAND IMMEDIATELY — do not defer. On NO_GO: comment findings + resume condition, leave open, row stays pending (candidate terminates — no further cycle exists).
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on PR ${PR} and row ${ROW}, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8.
`

const REMEDIATE = CONST + `
ROLE: remediate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Rebase PR ${PR} onto the LIVE origin/main tip in the lane worktree; re-rebase onto every newer tip; mechanical conflicts only; push (force-with-lease after verifying remote head == ${OLD_HEAD}); run the gates at the final head (help/version rc=0 no-bind, plain serve refusal intact, suite, frozen install, CI per-check with main-state classification vs the LIVE tip, secrets). Return (JSON): { mainTip, newHead, diffFiles: [string], helpRc, versionRc, serveRefusalRc, suiteCounts: {passed, failed}, frozenInstallRc, ciGreen, checks: [{name, conclusion, classification}], secretsClean, pushed, evidence }
`

const REVIEW2 = CONST + `
ROLE: cycle-2 re-reviewer (Fable, SAME lens — calendar-serve-help-review). Re-review ONLY the rebase result and its direct regressions (per CONST): (1) diff = the same apps/calendar early-args fix, (2) 'calendar-serve --help' rc=0 no-bind at the final head (literal), (3) plain serve still refuses without credential (literal), (4) calendar suite green, (5) base-movement gate vs the LIVE origin/main (merge-tree == head tree), (6) no other-lane interference. Do NOT relitigate the GO'd fix shape or discover unrelated issues. Post '[REVIEW] <GO|NO_GO> — calendar-serve-help-r2 @ <sha> — lens: rebase result of GO'd fix, reviewer calendar-serve-help-review' to #board. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: re-measure the LIVE origin/main tip, base-movement gate (merge-tree vs that tip; <merge-ref>^{tree} == <head>^{tree}), gh pr merge ${PR} --squash --body-file ending 'Agent: calendar-serve-help-fix-land', record merged sha, LIVE-VERIFY 'calendar-serve --help' rc=0 at the merged main tip (bounded), complete row ${ROW} with evidence. LAND IMMEDIATELY. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, liveHelpRc, rowState, residue: [] }
`

const REMEDIATE_SCHEMA = { type: 'object', properties: { mainTip: { type: 'string' }, newHead: { type: 'string' }, diffFiles: { type: 'array' }, helpRc: { type: 'number' }, versionRc: { type: 'number' }, serveRefusalRc: { type: 'number' }, suiteCounts: { type: 'object' }, frozenInstallRc: { type: 'number' }, ciGreen: { type: 'boolean' }, checks: { type: 'array' }, secretsClean: { type: 'boolean' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'helpRc', 'ciGreen'] }
const REVIEW2_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, liveHelpRc: { type: ['number', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Remediate')
const remediate = await agent(REMEDIATE, { label: 'calendar-help-r2-remediate', phase: 'Remediate', schema: REMEDIATE_SCHEMA, model: 'opus' })

phase('Review-2')
const review2 = remediate && remediate.pushed
  ? await agent(REVIEW2, { label: 'calendar-help-r2-review2', phase: 'Review-2', schema: REVIEW2_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'remediation did not complete', detail: JSON.stringify({ remediate }) }] }

phase('Land')
const land = review2 && review2.verdict === 'GO'
  ? await agent(LAND, { label: 'calendar-help-r2-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, liveHelpRc: null, rowState: 'pending', residue: ['NO_GO at cycle 2 — candidate terminated; adjudication required'] }

return { remediate: remediate && { newHead: remediate.newHead, helpRc: remediate.helpRc, suiteCounts: remediate.suiteCounts, ciGreen: remediate.ciGreen }, review2: review2 && review2.verdict, land }
