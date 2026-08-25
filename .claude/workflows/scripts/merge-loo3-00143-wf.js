export const meta = {
  name: 'merge-loo3-00143',
  description: 'Merge PR #1046 (LOO3-00143 loops runs --json pagination) after the cycle-1 remediation GO at 7fbac3ebb: confirm head, base-movement gate, squash-merge with Agent trailer, postverify, record. Publish-all owns the npm publish.',
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
const merge = await agent(`Merge hasna/apps PR #1046 (task LOO3-00143, loops runs --json pagination envelope) — the cycle-1 remediation returned GO at head 7fbac3ebb70913c69fe4d6caf2f15cae23ff5e2f (remediation lane wcoq39af1 verified countRuns filter parity across all four storage layers, has_more from the filtered population, regression-locked repro, CI 5/5 green, base movement clean).

1. Confirm the head sha is unchanged since the GO (gh pr view 1046 --json headRefOid == 7fbac3ebb70913c69fe4d6caf2f15cae23ff5e2f).
2. CI at the head green (all five jobs: gates, test-suites, verify-generated, publish-guard, build+test affected).
3. Base-movement gate at merge time: TREE=$(git merge-tree --write-tree origin/main <head>); git diff --quiet <head> "$TREE" must be rc=0 (or deltas only from main-side files disjoint from the PR's 16 apps/loops files).
4. gh pr merge 1046 --squash --match-head-commit --body-file <file whose LAST line is: Agent: fix-lane-LOO3-00143>. Never Co-Authored-By.
5. Postverify: merge commit exists, trailer is the last body line (git log -1 origin/main --format=%B), merged tree's apps/loops files == reviewed head blobs.
6. Record: comment the todos row LOO3-00143 with PR #1046, merge sha, acceptance lines; save a memento; post one line to #apps. Do NOT publish (publish-all owns publishing).

Return the schema.`, { label: 'merge', phase: 'Merge', schema: MERGE_SCHEMA })

return { status: merge && merge.merged ? 'merge-loo3-00143-merged' : 'merge-loo3-00143-merge-failed', merge }
