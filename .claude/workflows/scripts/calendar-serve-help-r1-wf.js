export const meta = {
  name: 'calendar-serve-help-r1',
  description: 'Cycle-1 remediation for row dd27cac0 (PR 784, calendar-serve --help binds before answering): the initial review was GO but the land phase correctly REFUSED on the base-movement gate (main advanced to 6c2bb4d3 — contracts 0.13.3 #788, test-guard #782, +1 — after the head was cut from aeec5c4c; merge-tree differs, UNREVIEWED AT HEAD; resume condition on PR 784 comment 5370238689 + row). This lane: rebase PR 784 onto the LIVE origin/main tip (re-measure at run time), re-run gates, fresh same-lens verdict, base gate + LAND IMMEDIATELY after GO. Same review lineage, cycle 1 of 2.',
  phases: [
    { title: 'Remediate', detail: 'idempotency check; rebase PR 784 onto LIVE origin/main tip; suite + two-sided probes at final head; CI per-check classified' },
    { title: 'Review-1', detail: 'same-lens Fable re-review at the final head naming the LIVE origin/main (merge-tree equality); scope = rebase result + direct regressions only' },
    { title: 'Land', detail: 'base-movement gate vs LIVE origin/main + squash merge --body-file Agent trailer + complete row dd27cac0' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = 'dd27cac0'
const PR = '784'
const OLD_HEAD = 'fdb96bccd129f1112b9bf8fbdc804ff44bd2971f'

const CONST = `
You are the calendar-serve-help-r1 remediation lane (row ${ROW}; owner-authorized via the task-drain queue; cycle 1 of 2 in the SAME review lineage). Final text = machine-readable JSON.

Context: the calendar-serve-help fix lane (wf_dbe6e782-d6a) delivered PR ${PR} (branch fix/calendar-serve-help-before-bind, head ${OLD_HEAD}) — the --help/--version answer moved to the top of main() in apps/calendar/src/server/index.ts beside the existing --version check, BEFORE parsePort/import/serve/auth-posture (the PR 766 attachments shape). Its verification was green (helpRc=0, calendar suite, CI green for the calendar reason) and the Fable review returned GO. The land phase correctly REFUSED on the base-movement gate: main advanced to 6c2bb4d3 (contracts 0.13.3 release #788, test-guard auto-rearm #782, +1; 46 files/884 ins, none in apps/calendar) after the head was cut from aeec5c4c — merge-tree(6c2bb4d3, ${OLD_HEAD}) != head tree, UNREVIEWED AT HEAD. Resume condition recorded on PR ${PR} comment 5370238689 and the row. This lane executes exactly that recorded condition.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: (a) row ${ROW} is pending and unowned; (b) PR ${PR} is OPEN with headRefOid exactly ${OLD_HEAD} (nothing landed since the fix lane); (c) no OTHER open PR fixes the calendar serve-help class; (d) the GO + base-movement refusal are on record. If ANY check fails, record the exact state and STOP.
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} fetch origin main -q; never discard local work). Resolve CURRENT origin/main from FETCH_HEAD and verify FETCH_HEAD == gh api repos/hasna/apps/commits/heads/main --jq .sha (a stale fetch produced a wrong base-gate verdict on 2026-08-21). MAIN MOVES SEVERAL COMMITS PER HOUR — re-measure the tip at the start, after every rebase, and immediately before the land gate; whenever the tip advanced, re-rebase onto the NEW tip. The final head MUST sit directly on the live tip measured at land time.
- REMEDIATE (in the lane worktree ~/.hasna/repos/worktrees/apps/calendar-serve-help-r1 cut from the LIVE origin/main tip): rebase fix/calendar-serve-help-before-bind onto the live tip; mechanical conflicts only within the PR's own files (the PR is confined to apps/calendar); push the rebased head with force-with-lease ONLY after verifying the remote head still equals ${OLD_HEAD}. Do NOT add new content beyond the rebase.
- VERIFY at the final head (bounded): 'calendar-serve --help' rc=0 + usage WITHOUT binding (literal); '--version' rc=0 (literal); plain serve rc=1 with the credential refusal and the bind/start still attempted (negative probe intact — literal); calendar suite green (literal counts); 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules, literal); CI per-check table at the final head (bounded polling — classify EVERY failure against the LIVE origin/main state: main's own run must fail identically for a main-state residual; calendar-caused failures MUST be green; note the contracts 0.13.3 release #788 may already have landed on the registry — re-measure rather than assuming the old resolution class); secrets scan clean.
- REVIEW-1 (one Fable adversarial reviewer, SAME lens — calendar-serve-help-review): re-review ONLY the rebase result and its direct regressions: (1) the rebased diff is the same apps/calendar early-args fix, nothing else added; (2) 'calendar-serve --help' rc=0 no-bind at the final head (literal); (3) plain serve still refuses without credential (literal); (4) calendar suite green; (5) base-movement gate vs the LIVE origin/main — merge-tree == head tree (literal); (6) no other-lane interference. Do NOT relitigate the GO'd fix shape and do NOT discover new issues outside the rebase. Post '[REVIEW] <GO|NO_GO> — calendar-serve-help-r1 @ <sha> — lens: rebase result of GO'd fix, reviewer calendar-serve-help-review' to #board. Block ONLY concrete P0/P1 defects.
- LAND: on GO, re-measure the LIVE origin/main tip ONE MORE TIME, base-movement gate (merge-tree vs THAT tip; <merge-ref>^{tree} == <head>^{tree}), gh pr merge ${PR} --squash --body-file ending 'Agent: calendar-serve-help-fix-land' (last line; never Co-Authored-By), record the merged sha, LIVE-VERIFY 'calendar-serve --help' rc=0 at the merged main tip (bounded), complete row ${ROW} with evidence. LAND IMMEDIATELY — do not defer. On NO_GO: comment findings + resume condition, leave open, row stays pending.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on PR ${PR} and row ${ROW}, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8.
`

const REMEDIATE = CONST + `
ROLE: remediate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Rebase PR ${PR} onto the LIVE origin/main tip in the lane worktree; re-rebase onto every newer tip; mechanical conflicts only; push (force-with-lease after verifying remote head == ${OLD_HEAD}); run the gates at the final head (help/version rc=0 no-bind, plain serve refusal intact, suite, frozen install, CI per-check with main-state classification vs the LIVE tip, secrets). Return (JSON): { mainTip, newHead, diffFiles: [string], helpRc, versionRc, serveRefusalRc, suiteCounts: {passed, failed}, frozenInstallRc, ciGreen, checks: [{name, conclusion, classification}], secretsClean, pushed, evidence }
`

const REVIEW1 = CONST + `
ROLE: cycle re-reviewer (Fable, SAME lens — calendar-serve-help-review). Re-review ONLY the rebase result and its direct regressions (per CONST): (1) diff = the same apps/calendar early-args fix, (2) 'calendar-serve --help' rc=0 no-bind at the final head (literal), (3) plain serve still refuses without credential (literal), (4) calendar suite green, (5) base-movement gate vs the LIVE origin/main (merge-tree == head tree), (6) no other-lane interference. Do NOT relitigate the GO'd fix shape or discover unrelated issues. Post '[REVIEW] <GO|NO_GO> — calendar-serve-help-r1 @ <sha> — lens: rebase result of GO'd fix, reviewer calendar-serve-help-review' to #board. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: re-measure the LIVE origin/main tip, base-movement gate (merge-tree vs that tip; <merge-ref>^{tree} == <head>^{tree}), gh pr merge ${PR} --squash --body-file ending 'Agent: calendar-serve-help-fix-land', record merged sha, LIVE-VERIFY 'calendar-serve --help' rc=0 at the merged main tip (bounded), complete row ${ROW} with evidence. LAND IMMEDIATELY. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, liveHelpRc, rowState, residue: [] }
`

const REMEDIATE_SCHEMA = { type: 'object', properties: { mainTip: { type: 'string' }, newHead: { type: 'string' }, diffFiles: { type: 'array' }, helpRc: { type: 'number' }, versionRc: { type: 'number' }, serveRefusalRc: { type: 'number' }, suiteCounts: { type: 'object' }, frozenInstallRc: { type: 'number' }, ciGreen: { type: 'boolean' }, checks: { type: 'array' }, secretsClean: { type: 'boolean' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'helpRc', 'ciGreen'] }
const REVIEW1_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, liveHelpRc: { type: ['number', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Remediate')
const remediate = await agent(REMEDIATE, { label: 'calendar-help-r1-remediate', phase: 'Remediate', schema: REMEDIATE_SCHEMA, model: 'opus' })

phase('Review-1')
const review1 = remediate && remediate.pushed
  ? await agent(REVIEW1, { label: 'calendar-help-r1-review1', phase: 'Review-1', schema: REVIEW1_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'remediation did not complete', detail: JSON.stringify({ remediate }) }] }

phase('Land')
const land = review1 && review1.verdict === 'GO'
  ? await agent(LAND, { label: 'calendar-help-r1-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, liveHelpRc: null, rowState: 'pending', residue: ['NO_GO — see findings; row stays pending'] }

return { remediate: remediate && { newHead: remediate.newHead, helpRc: remediate.helpRc, suiteCounts: remediate.suiteCounts, ciGreen: remediate.ciGreen }, review1: review1 && review1.verdict, land }
