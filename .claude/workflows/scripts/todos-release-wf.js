export const meta = {
  name: 'todos-release',
  description: 'Ship @hasna/todos@0.15.48 via its specialist tag + signed-receipt pipeline: merge PR #1056 (prepare-script removal), fresh codewith release review of the new main-HEAD, re-issue the signed receipt bound to the new sha, create npm/todos/v0.15.48 tag, set HASNA_TODOS_EXPECTED_COMMIT, publish, two-sided verify, live test, fleet install. Unblocks browser and the wave dependents.',
  phases: [
    { title: 'Unblock' },
    { title: 'Review' },
    { title: 'Publish' },
  ],
}

const UNBLOCK_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['merged', 'mainHead'],
  properties: {
    merged: { type: 'boolean' },
    mainHead: { type: 'string' },
  },
}

const REVIEW_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['verdict', 'receiptSha'],
  properties: {
    verdict: { enum: ['GO', 'NO_GO'] },
    receiptSha: { type: 'string' },
  },
}

const PUBLISH_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['published', 'version'],
  properties: {
    published: { type: 'boolean' },
    version: { type: 'string' },
    liveTest: { type: 'string' },
  },
}

phase('Unblock')
const unblock = await agent(`Ship @hasna/todos@0.15.48 — step 1: merge PR #1056 (fix(todos): remove prepare script that blocks the npm release gate, head e1753aee6). This PR removes apps/todos/package.json:87 'prepare' which conflicts with validatePackLifecycleScripts (pack-lifecycle-mutation), the release-gate blocker recorded by the todos lane.

1. Wait for PR #1056's pending build+test check to conclude (bounded wait, up to ~15 min; the affected-lane build+test runs the todos suite). All five checks must be pass at head e1753aee6 before merge.
2. Base-movement gate: TREE=$(git merge-tree --write-tree origin/main <head>); git diff --quiet <head> "$TREE" must be rc=0 (or deltas only from main-side files disjoint from the PR's files).
3. gh pr merge 1056 --squash --match-head-commit --body-file <file whose LAST line is: Agent: ship-todos-0.15.48>. Never Co-Authored-By.
4. Postverify: merge commit exists, trailer is the last body line, apps/todos/package.json no longer has the 'prepare' script at the merged head.
5. Record the new origin/main head sha.

Return the schema: merged (true), mainHead (new origin/main sha).`, { label: 'unblock', phase: 'Unblock', schema: UNBLOCK_SCHEMA })

phase('Review')
const review = await agent(`Ship @hasna/todos@0.15.48 — step 2: fresh codewith release review of the release candidate at the NEW main head (${unblock ? unblock.mainHead : 'unknown'}). The prior review GO (5bf92f9a0 signed receipt bound to af5e91ef0) was INVALIDATED by main advancing to 11ba577fd and then the #1056 merge — a fresh review is required per the no-publish-unreviewed rule.

1. The candidate: @hasna/todos 0.15.48 at origin/main head (after #1056 merged). Verify package.json version == 0.15.48, no 'prepare' script, all release gates pass (bun tooling/ci/check-frozen-locks.ts, versioning-integrity, publish-guard on the todos tarball).
2. Run the codewith release review (healthy profile, gpt-5.6-sol, high reasoning) bound to this exact head sha. On GO, capture the signed receipt bound to the NEW sha (NOT af5e91ef0).
3. Bounded: at most two remediation cycles; a third NO_GO terminates.

Return the schema: verdict (GO/NO_GO), receiptSha (the sha the GO receipt is bound to — must equal the new main head).`, { label: 'review', phase: 'Review', schema: REVIEW_SCHEMA })

phase('Publish')
const publish = await agent(`Ship @hasna/todos@0.15.48 — step 3: publish via the specialist tag + signed-receipt pipeline (NOT the generic publish form).

1. The review GO is bound to sha ${review ? review.receiptSha : 'unknown'}. Confirm origin/main head == that sha (post-merge candidate reviewed at head).
2. Create the annotated tag: git tag -a npm/todos/v0.15.48 -m 'Signed release receipt ...' at the reviewed sha (the receipts carry the sha, package, version — mirror the prior npm/todos/v0.15.48 receipt format).
3. Set HASNA_TODOS_EXPECTED_COMMIT=<reviewed-sha> and publish @hasna/todos@0.15.48 per the publish law: temp npmrc holding the placeholder text \${NODE_AUTH_TOKEN} pairing, hasna/npm/live/publish-token, [PUBLISH INTENT] on git-publishing BEFORE, confirm in-thread AFTER.
4. Two-sided verify: npm view @hasna/todos version == 0.15.48 AND timestamp fresh; negative control (0.15.48 was E404 before publish).
5. LIVE TEST: bun install -g @hasna/todos@0.15.48, todos --version == 0.15.48, todos --help rc=0, todos-mcp/serve --version no-bind. Fleet install + verify on reachable stations.
6. Comment task 184440f4-adjacent (the todos tracker / wave task 248f6ed8) with the receipt sha, tag, publish timestamp, live-test lines.

Return the schema: published (true), version (0.15.48), liveTest (one-line evidence).`, { label: 'publish', phase: 'Publish', schema: PUBLISH_SCHEMA })

return { status: publish && publish.published ? 'todos-release-done' : 'todos-release-failed', unblock, review, publish }
