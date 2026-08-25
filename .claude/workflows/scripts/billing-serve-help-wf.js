export const meta = {
  name: 'billing-serve-help-r1',
  description: 'Cycle-1 remediation for row ad3ae2fe (PR 785, billing-serve --help/--version bind before answering): the initial review NO_GO was BASE-MOVEMENT ONLY (P1: main advanced to 738590fc via attachments #766 after PR 785 was cut from aeec5c4c; merge-tree differs -> UNREVIEWED AT HEAD; P3 informational openapi-cwd pre-existing). The fix itself verified green (helpRc=0, suite, CI-for-billing). This lane: rebase PR 785 onto the LIVE origin/main tip (re-measure at run time), re-run gates, fresh same-lens verdict, base gate + LAND IMMEDIATELY after GO (main moves several commits/hour). Same review lineage, cycle 1 of 2.',
  phases: [
    { title: 'Remediate', detail: 'idempotency check; rebase PR 785 onto LIVE origin/main tip; suite + two-sided probes at final head; CI per-check classified' },
    { title: 'Review-1', detail: 'same-lens Fable re-review at the final head naming the LIVE origin/main (merge-tree equality); scope = rebase result + direct regressions only' },
    { title: 'Land', detail: 'base-movement gate vs LIVE origin/main + squash merge --body-file Agent trailer + complete row ad3ae2fe' },
  ],
}

const MONOREPO = '/home/hasna/workspace/repos/hasna/apps'
const ROW = 'ad3ae2fe'
const PR = '785'
const OLD_HEAD = 'b653bf59653356cb1cc9084cbf8b327716f9f8b7'

const CONST = `
You are the billing-serve-help-r1 remediation lane (row ${ROW}; owner-authorized via the task-drain queue; cycle 1 of 2 in the SAME review lineage). Final text = machine-readable JSON.

Context: the billing-serve-help fix lane (wf_3743f873-cc4) delivered PR ${PR} (branch fix/billing-serve-help-before-bind, head ${OLD_HEAD}) — early-args answer (--help/--version) BEFORE startServer() in apps/billing/src/server/index.ts, mirroring attachments PR 766 / calendar lane shape. Its verification was green (helpRc=0, suite, CI green for the billing reason). The initial review NO_GO was BASE-MOVEMENT ONLY: main advanced to 738590fc (attachments #766 merge 12:43Z) after the head was cut from aeec5c4c — merge-tree(738590fc, ${OLD_HEAD}) differs from the head tree, UNREVIEWED AT HEAD. P3 informational: apps/billing openapi-contract test reads openapi.json relative to cwd — pre-existing, NOT part of this lane. This lane executes exactly the recorded resume condition — one remediation step in the same lineage.

Non-negotiable rules:
- IDEMPOTENCY CHECK FIRST: (a) row ${ROW} is pending and unowned; (b) PR ${PR} is OPEN with headRefOid exactly ${OLD_HEAD} (nothing landed since the fix lane); (c) no OTHER open PR fixes the billing serve-help class; (d) the NO_GO + resume condition are on record. If ANY check fails, record the exact state and STOP.
- ${MONOREPO} is READ/context only. Sync first (git -C ${MONOREPO} fetch origin main -q; never discard local work). Resolve CURRENT origin/main from FETCH_HEAD and verify FETCH_HEAD == gh api repos/hasna/apps/commits/heads/main --jq .sha (a stale fetch produced a wrong base-gate verdict on 2026-08-21). MAIN MOVES SEVERAL COMMITS PER HOUR — re-measure the tip at the start, after every rebase, and immediately before the land gate; whenever the tip advanced, re-rebase onto the NEW tip. The final head MUST sit directly on the live tip measured at land time.
- REMEDIATE (in the lane worktree ~/.hasna/repos/worktrees/apps/billing-serve-help-r1 cut from the LIVE origin/main tip): rebase fix/billing-serve-help-before-bind onto the live tip; mechanical conflicts only within the PR's own files (the PR is confined to apps/billing); push the rebased head with force-with-lease ONLY after verifying the remote head still equals ${OLD_HEAD}. Do NOT add new content beyond the rebase.
- VERIFY at the final head (bounded): 'billing-serve --help' rc=0 + usage WITHOUT binding (literal); '--version' rc=0 (literal); plain serve rc=1 with the credential refusal and the bind still attempted (negative probe intact — literal); billing suite green (literal counts); 'bun install --frozen-lockfile' rc=0 (bun 1.3.14, zero node_modules, literal); CI per-check table at the final head (bounded polling — classify EVERY failure against the LIVE origin/main state: main's own run must fail identically for a main-state residual (contracts 0.13.2/0.13.3 resolution class, versioning-integrity); billing-caused failures MUST be green); secrets scan clean.
- REVIEW-1 (one Fable adversarial reviewer, SAME lens — billing-serve-help-review): re-review ONLY the rebase result and its direct regressions: (1) the rebased diff is the same apps/billing early-args fix, nothing else added; (2) 'billing-serve --help' rc=0 no-bind at the final head (literal); (3) plain serve still refuses without credential (literal); (4) billing suite green; (5) base-movement gate vs the LIVE origin/main — merge-tree == head tree (literal); (6) no other-lane interference. Do NOT relitigate the GO-adjacent fix shape and do NOT discover new issues outside the rebase. Post '[REVIEW] <GO|NO_GO> — billing-serve-help-r1 @ <sha> — lens: rebase result of verified fix, reviewer billing-serve-help-review' to #board. Block ONLY concrete P0/P1 defects.
- LAND: on GO, re-measure the LIVE origin/main tip ONE MORE TIME, base-movement gate (merge-tree vs THAT tip; <merge-ref>^{tree} == <head>^{tree}), gh pr merge ${PR} --squash --body-file ending 'Agent: billing-serve-help-fix-land' (last line; never Co-Authored-By), record the merged sha, LIVE-VERIFY 'billing-serve --help' rc=0 at the merged main tip (bounded), complete row ${ROW} with evidence. LAND IMMEDIATELY — do not defer. On NO_GO: comment findings + resume condition, leave open, row stays pending.
- No secrets: never print/capture/commit credential values; no internal-infra strings. Capture path: redirect to files, read both + $?, never pipe large reads. Paste literal output lines. Record as you go: comments on PR ${PR} and row ${ROW}, posts to #board. English. Distinguish measured vs inferred; state what you did not check. The apps project is 3bbc22e0-205f-4e3d-8c5a-d8ce8e99afd8.
`

const REMEDIATE = CONST + `
ROLE: remediate lane (Opus). IDEMPOTENCY CHECK FIRST (per CONST). Rebase PR ${PR} onto the LIVE origin/main tip in the lane worktree; re-rebase onto every newer tip; mechanical conflicts only; push (force-with-lease after verifying remote head == ${OLD_HEAD}); run the gates at the final head (help/version rc=0 no-bind, plain serve refusal intact, suite, frozen install, CI per-check with main-state classification vs the LIVE tip, secrets). Return (JSON): { mainTip, newHead, diffFiles: [string], helpRc, versionRc, serveRefusalRc, suiteCounts: {passed, failed}, frozenInstallRc, ciGreen, checks: [{name, conclusion, classification}], secretsClean, pushed, evidence }
`

const REVIEW1 = CONST + `
ROLE: cycle re-reviewer (Fable, SAME lens — billing-serve-help-review). Re-review ONLY the rebase result and its direct regressions (per CONST): (1) diff = the same apps/billing early-args fix, (2) 'billing-serve --help' rc=0 no-bind at the final head (literal), (3) plain serve still refuses without credential (literal), (4) billing suite green, (5) base-movement gate vs the LIVE origin/main (merge-tree == head tree), (6) no other-lane interference. Do NOT relitigate the verified fix shape or discover unrelated issues. Post '[REVIEW] <GO|NO_GO> — billing-serve-help-r1 @ <sha> — lens: rebase result of verified fix, reviewer billing-serve-help-review' to #board. Return (JSON): { verdict: 'GO'|'NO_GO', findings: [{severity, title, detail}] }
`

const LAND = CONST + `
ROLE: land lane. If GO: re-measure the LIVE origin/main tip, base-movement gate (merge-tree vs that tip; <merge-ref>^{tree} == <head>^{tree}), gh pr merge ${PR} --squash --body-file ending 'Agent: billing-serve-help-fix-land', record merged sha, LIVE-VERIFY 'billing-serve --help' rc=0 at the merged main tip (bounded), complete row ${ROW} with evidence. LAND IMMEDIATELY. If NO_GO: comment findings + resume condition, leave open. Return (JSON): { merged, mergedSha, liveHelpRc, rowState, residue: [] }
`

const REMEDIATE_SCHEMA = { type: 'object', properties: { mainTip: { type: 'string' }, newHead: { type: 'string' }, diffFiles: { type: 'array' }, helpRc: { type: 'number' }, versionRc: { type: 'number' }, serveRefusalRc: { type: 'number' }, suiteCounts: { type: 'object' }, frozenInstallRc: { type: 'number' }, ciGreen: { type: 'boolean' }, checks: { type: 'array' }, secretsClean: { type: 'boolean' }, pushed: { type: 'boolean' }, evidence: { type: 'string' } }, required: ['newHead', 'pushed', 'helpRc', 'ciGreen'] }
const REVIEW1_SCHEMA = { type: 'object', properties: { verdict: { type: 'string' }, findings: { type: 'array' } }, required: ['verdict'] }
const LAND_SCHEMA = { type: 'object', properties: { merged: { type: 'boolean' }, mergedSha: { type: ['string', 'null'] }, liveHelpRc: { type: ['number', 'null'] }, rowState: { type: 'string' }, residue: { type: 'array' } }, required: ['merged'] }

phase('Remediate')
const remediate = await agent(REMEDIATE, { label: 'billing-help-r1-remediate', phase: 'Remediate', schema: REMEDIATE_SCHEMA, model: 'opus' })

phase('Review-1')
const review1 = remediate && remediate.pushed
  ? await agent(REVIEW1, { label: 'billing-help-r1-review1', phase: 'Review-1', schema: REVIEW1_SCHEMA, model: 'fable' })
  : { verdict: 'NO_GO', findings: [{ severity: 'P1', title: 'remediation did not complete', detail: JSON.stringify({ remediate }) }] }

phase('Land')
const land = review1 && review1.verdict === 'GO'
  ? await agent(LAND, { label: 'billing-help-r1-land', phase: 'Land', schema: LAND_SCHEMA })
  : { merged: false, mergedSha: null, liveHelpRc: null, rowState: 'pending', residue: ['NO_GO — see findings; row stays pending'] }

return { remediate: remediate && { newHead: remediate.newHead, helpRc: remediate.helpRc, suiteCounts: remediate.suiteCounts, ciGreen: remediate.ciGreen }, review1: review1 && review1.verdict, land }
