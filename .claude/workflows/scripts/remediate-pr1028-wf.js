export const meta = {
  name: 'remediate-pr1028',
  description: 'Remediate follow-on wave PR #1028 (Version Packages, release/version-wave, 15 bumps) after cycle-1 NO_GO: DROP the actions bump (terminated release lineage — engineering blocker), fix the runtime version-literal exports for the remaining bumped members (O15-00298 class), re-verify gates, push, one focused re-review (cycle 1), merge with Agent trailer. Then publish-all owns publishing.',
  phases: [
    { title: 'Remediate' },
    { title: 'ReReview' },
  ],
}

const REMEDIATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['droppedActions', 'pushed', 'gatesRc'],
  properties: {
    droppedActions: { type: 'boolean' },
    pushed: { type: 'boolean' },
    gatesRc: { type: 'integer' },
    fixes: { type: 'array', items: { type: 'string' } },
    newHead: { type: 'string' },
    bumpSet: { type: 'array', items: { type: 'string' } },
    unremediable: { type: 'array', items: { type: 'string' } },
  },
}

const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'findings'],
  properties: {
    verdict: { enum: ['GO', 'NO_GO'] },
    findings: { type: 'array', items: { type: 'string' } },
  },
}

phase('Remediate')
const remediate = await agent(`Remediate hasna/apps follow-on wave PR #1028 (branch release/version-wave, head f4364f17a2d3154705e4eaedf6c1e6dd1178ee67, task cf390843 wave lineage; 15 bumps). The cycle-1 review returned NO_GO: base movement PASS (wave branch already on current main e193651c, merge-tree == head tree), but three required CI gates red at head, all classified as the recorded-owner b335a922 (O15-00298) version-literal-drift class; the lane's cycle-2 remediation measured everything and pushed nothing. You are the wave's remediation cycle 1.

CRITICAL DECISION — DROP THE ACTIONS BUMP (engineering blocker):
The wave bumps @hasna/actions 0.2.1 -> 0.2.2 (consuming .changeset/actions-mcp-version-help.md from the T-00101 sweep). The actions release lineage is TERMINATED per the bounded-review cap: candidate 0.2.1/0.2.2 terminated (flock redesign required), successor PR #775 terminated by third NO_GO (record-loss P1 in restoreMovedOwnerFile), main reverted to the pre-#775 state (0.2.1, the terminated flock-less design), forward fix tracked on O15-00590 (generation-fenced restore + non-replacing owner publication). Per the cap, no later adjudication may create another actions successor, and the package must NOT ship until O15-00590 lands. So in THIS wave:
1. Revert the actions bump in the wave branch: apps/actions/package.json back to 0.2.1, remove the actions CHANGELOG 0.2.2 entry, restore .changeset/actions-mcp-version-help.md to the branch (so the changeset stays pending — its fix rides with O15-00590's release). Actions stays OUT of the wave's bump set.
2. Record this on the todos row (cf390843 or ace677e9) and on the PR body: actions excluded from wave #1028 — release lineage terminated, forward fix O15-00590.

THREE RED GATES at head — fix or classify each (mirror wave #1025 remediation, which was reviewed GO at cc2355836):

1. build + test (affected) — FAIL: runtime version-literal drift for the bumped members (the O15-00298 class: static VERSION literals in code vs bumped package.json). Examples from cycle-1: actions (moot once dropped), crawl 0.4.18/0.4.17. Find EVERY cite via the versioning-integrity check (CI job 'test-suites (versioning + standard-adherence)', step 'Versioning integrity suite (offline default)'; locate the exact script under tooling/ci/) and align the runtime version exports of ALL 14 remaining bumped members (bridge, browser, controls, crawl, datasets, economy, evals, holdings, instructions, loops, notes, skills, tai, treasury) to their bumped versions. Do NOT touch unrelated members' drift (O15-00298's own follow-up).

2. test-suites (versioning + standard-adherence) — FAIL: (a) versioning runtime-export drift (same as #1 — fix with it); (b) 'pending changesets are non-empty' on a fully-consuming wave — KNOWN wave-shape false positive, recorded non-blocking, merged through on #998/#997/#988/#1025 precedent; (c) 'package.json version change accompanied by changeset' for dependent bumps — KNOWN shape, merged through on the same precedent. Do NOT add fake changesets.

3. publish guard (npm pack --dry-run) — FAIL: (a) wave-caused drift (fixed with #1/#2); (b) browser pack-time tsc TS2307 — the RECORDED wave-ordering/workspace-link class (tracker O15-00594 a0f17345, mechanism: browser pins @hasna/skills/@hasna/todos at wave versions unpublished until publish-all runs; NOT the wave PR's fix). Verify it is byte-identical to the recorded mechanism and record it in unremediable.

WORK in the existing worktree ~/.hasna/repos/worktrees/apps/ship-latest-32 (branch release/version-wave) or a fresh one at the same path:
1. Fetch origin/main — verify main is e193651c (or re-measure; rebase only if main moved).
2. Apply the actions drop + fixes #1/#2. Commit: 'fix: remediate wave PR #1028 — drop terminated actions bump, align version exports' + 'Agent: ship-latest-wave' trailer.
3. Re-run the gates locally: versioning-integrity suite, recordings-style version:check for the members that have it, bun tooling/ci/check-frozen-locks.ts, bun run check at repo root, secrets scan staged rc=0 with real bytes.
4. Push to release/version-wave (force-with-lease on the wave's own open branch after remediation is allowed). Verify gh pr view 1028 headRefOid == new head.
5. For the browser pack-time tsc class: confirm the ONLY missing pieces are the unpublished @hasna/skills@0.1.66/@hasna/todos@0.15.48 (npm view) and no new internal-infra string. Record the evidence.

Return the schema: droppedActions (true), pushed, gatesRc (0 = all remediable gates pass locally), fixes, newHead, bumpSet (the 14 remaining), unremediable (browser pack-time tsc with evidence; the two known-shape versioning-suite failures).`, { label: 'remediate', phase: 'Remediate', schema: REMEDIATE_SCHEMA })

phase('ReReview')
const review = await agent(`Focused re-review of follow-on wave PR #1028 after remediation (SAME reviewer lineage — verification of the remediation delta only; this is the wave's remediation cycle 1 re-review; at most one further cycle may follow).

PR #1028 head after remediation: ${remediate ? remediate.newHead : 'unknown'} (branch release/version-wave).

Verify:
1. The remediation delta is limited to: actions bump REVERTED OUT (package.json 0.2.1, CHANGELOG 0.2.2 entry removed, .changeset/actions-mcp-version-help.md restored/pending), runtime version exports for the remaining 14 bumped members aligned, and nothing else. The bump set is now the 14: bridge 0.7.4, browser 0.5.33, controls 0.1.3, crawl 0.4.18, datasets 0.1.6, economy 0.3.26, evals 0.2.5, holdings 0.1.6, instructions 0.4.43, loops 0.6.1, notes 0.4.1, skills 0.1.66, tai 0.1.7, treasury 0.1.3 — and NOT actions.
2. The actions exclusion is correct and complete: no actions file in the wave diff; the actions changeset is present as pending (not consumed). The exclusion is recorded on the row/PR with the terminated-lineage rationale.
3. Gates at the new head: versioning-integrity suite passes locally (or CI test-suites re-run green for the drift tests); frozen-locks rc=0; the wave content is mechanical-only.
4. The browser pack-time tsc class: if recorded as unremediable wave-ordering, verify the evidence (pack-time tsc resolves only unpublished @hasna/skills@0.1.66/@hasna/todos@0.15.48; tracker O15-00594 exists; no new internal-infra string). Accept as non-blocking-with-record ONLY with that evidence; ANY new defect = NO_GO.
5. Base movement: main e193651c unmoved (or re-measured); merge-tree vs origin/main == head tree.
6. CI at the new head (re-run after push): gates + verify generated artifacts pass; test-suites/build+test now pass after fixes; publish-guard may still show only the recorded browser class.

Return GO if the remediation is complete (actions dropped, literals aligned) and the only remaining red gate is the recorded browser class with evidence, else NO_GO with exact evidence. This is the wave's cycle-1 re-review — a NO_GO here is its second and a further NO_GO terminates the wave per the bounded-review cap.`, { label: 're-review', phase: 'ReReview', schema: REVIEW_SCHEMA })

return { status: review && review.verdict === 'GO' ? 'remediate-pr1028-ready' : 'remediate-pr1028-no-go', remediate, review }
