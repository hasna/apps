export const meta = {
  name: 'merge-pr1028',
  description: 'Merge follow-on wave PR #1028 (Version Packages, release/version-wave) after the cycle-1 re-review GO at 3033120a1: confirm head, base-movement gate, squash-merge with Agent trailer, postverify the 14-bump set, record. Publish-all owns the npm publish; the ship-latest handoff lane owns the [SHIP-READY] post.',
  phases: [
    { title: 'Merge' },
  ],
}

const MERGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['merged', 'mergeSha'],
  properties: {
    merged: { type: 'boolean' },
    mergeSha: { type: 'string' },
  },
}

phase('Merge')
const merge = await agent(`Merge hasna/apps follow-on wave PR #1028 (Version Packages, branch release/version-wave) — the cycle-1 re-review returned GO at head 3033120a1bea226a9bd43212d1435323f12bb121 (remediation lane wjyy1tjta verified: actions bump DROPPED, 14-member bump set exact, version-literal drift aligned, base movement clean — wave branch rebased onto main cd5bc48e, merge-tree == head tree).

1. Confirm the head sha is unchanged since the GO (gh pr view 1028 --json headRefOid == 3033120a1bea226a9bd43212d1435323f12bb121).
2. CI at the head: gates + verify generated artifacts + build/test (affected) PASS; test-suites FAIL only on the recorded browser dependent-bump versioning test (merged through on #998/#997/#988/#1025 precedent); publish-guard FAIL only on the recorded O15-00594 browser pack-time tsc class. Verify none of these is a NEW failure — if ANY new failure appears, STOP and report verbatim.
3. Base-movement gate at merge time: TREE=$(git merge-tree --write-tree origin/main <head>); git diff --quiet <head> "$TREE" must be rc=0 (or deltas only from main-side files disjoint from the PR's files).
4. gh pr merge 1028 --squash --match-head-commit --body-file <file whose LAST line is: Agent: ship-latest-wave>. Never Co-Authored-By.
5. Postverify: merge commit exists, trailer is the last body line (git log -1 origin/main --format=%B), merged tree's 14 bumped versions == reviewed head (bridge 0.7.4, browser 0.5.33, controls 0.1.3, crawl 0.4.18, datasets 0.1.6, economy 0.3.26, evals 0.2.5, holdings 0.1.6, instructions 0.4.43, loops 0.6.1, notes 0.4.1, skills 0.1.66, tai 0.1.7, treasury 0.1.3), actions unchanged at 0.2.1, 13 consumed changesets absent, .changeset/actions-mcp-version-help.md PRESENT on main (pending).
6. Record: comment task cf390843 with PR #1028, merge sha, acceptance lines; save a memento; post one line to #apps naming the 14-bump wave merged and publish-all as the publisher. Do NOT publish to npm; do NOT post [SHIP-READY] (the ship-latest handoff lane owns that after registry verify).

Return the schema.`, { label: 'merge', phase: 'Merge', schema: MERGE_SCHEMA })

return { status: merge && merge.merged ? 'merge-pr1028-merged' : 'merge-pr1028-merge-failed', merge }
