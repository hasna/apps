export const meta = {
  name: 'datasets-to-internal',
  description: 'Move hasna/datasets out of the public OSS set (hasna/apps) into the internal tree (hasna-internal/internal-apps) per owner directive 2026-08-24. Follows the app-open-to-internal-move convention (first instance: accounts, todos bdb1c431). Deepseek session-model agents; one Fable adversarial review; PR-first; [BREAKING] sequencing; live-test the moved artifact.',
  phases: [
    { title: 'Census' },
    { title: 'Move' },
    { title: 'Review' },
    { title: 'LiveTest' },
    { title: 'Harvest' },
  ],
}

const CENSUS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['consumers', 'registryState', 'destination'],
  properties: {
    consumers: { type: 'array', items: { type: 'string' } },
    registryState: { type: 'string' },
    destination: { type: 'string' },
  },
}

const MOVE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['prs'],
  properties: {
    prs: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['repo', 'prNumber', 'state'],
        properties: {
          repo: { type: 'string' },
          prNumber: { type: 'integer' },
          state: { type: 'string' },
        },
      },
    },
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

phase('Census')
const census = await agent(`Census for moving hasna/datasets out of the public OSS set into the internal tree (owner directive 2026-08-24; convention: app-open-to-internal-move, first instance accounts todos bdb1c431).

Determine:
1. Who consumes @hasna/datasets today (in-tree hasna/apps dependents, other monorepos, installed stations, npm). Enumerate the consumer set from apps/*/package.json deps + npm view dependents + a grep of the workspace for @hasna/datasets.
2. Registry state: @hasna/datasets current version, publish access (public vs private), last publish.
3. The destination: per the internal-apps registry convention (internal-apps.registry.json tuples: repo, frozen source SHA, manifest path+hash, role, target package name, access, vault lane key, workspace inclusion, publish eligibility) — the datasets role in internal-apps (scope hasna|hasnaxyz|hasnafamily).
4. The package-scope decision: does @hasna/datasets become @hasna-internal/datasets (private) or stay @hasna/datasets with private access? (The accounts precedent bdb1c431 is the model — read it.)

Return the schema: consumers (list), registryState (one line), destination (the exact target tree + package name + registry tuple decision).`, { label: 'census', phase: 'Census', schema: CENSUS_SCHEMA })

phase('Move')
const move = await agent(`Execute the datasets-to-internal move per the census: ${JSON.stringify(census)}. WORKER — implement the move PR-first, one PR per repo.

1. Destination tree: hasna-internal/internal-apps (apps/<scope>/datasets/ if the tuple says so, or the accounts-precedent shape). NEVER mutate the shared checkout — task worktrees.
2. In hasna/apps: remove apps/datasets from the public tree (delete or relocate), update the name-conformance / registry / CI gates that list it as a member, repoint any consumer deps to the new package name, [BREAKING] sequencing note.
3. In hasna-internal/internal-apps: land the app under the tuple (manifest, package.json with the new scope name, source, vault lane key wiring, workspace inclusion, publish eligibility).
4. Regression first: the failing test must demonstrate the old public placement, then pass in the new internal placement. Each repo's gates green (bun run check rc=0 where the repo has it), secrets scan staged rc=0 with real bytes.
5. Commit (Conventional Commit + 'Agent: datasets-move-<short>' trailer), push, open PRs. Post a [BREAKING] note to announcements naming the move and the consumer impact window.
6. DO NOT merge, DO NOT publish — review + merge + publish are separate lanes.

Return the schema: prs (one per repo). If a step is impossible, state state:'blocked' with the exact gate.`, { label: 'move', phase: 'Move', schema: MOVE_SCHEMA })

phase('Review')
const review = await agent(`Adversarial review (FABLE) of the datasets-to-internal move PRs. PRs: ${JSON.stringify(move)}.

For EACH PR, review the exact head:
1. The move is complete and correct: datasets is removed from hasna/apps public membership, lands in hasna-internal/internal-apps under the registry tuple, consumers repointed, no dangling @hasna/datasets public references.
2. No secret material (the app may carry vault-lane-key references — verify they are REFERENCES not values). Base-movement gate clean per PR.
3. The internal-apps registry tuple is the publishing authority (immutable reviewed tuple), not folder names.
4. Bounded: at most two remediation cycles per PR; third NO_GO terminates that candidate.

Return GO if all PRs are sound, else NO_GO with per-PR exact findings. [REVIEW] comment on each PR.`, { label: 'review', phase: 'Review', schema: REVIEW_SCHEMA })

if (!review || review.verdict !== 'GO') {
  return { status: 'datasets-to-internal-no-go', census, move, review }
}

phase('LiveTest')
const livetest = await agent(`Live-test the moved datasets app after review GO (WORKER).

1. Merge the reviewed PRs (base-movement gate per PR, gh pr merge --squash --body-file ending 'Agent: datasets-move-<short>', trailer verified).
2. Publish the moved package per its scope's publish law (private scope token if @hasna-internal, [PUBLISH INTENT] first on git-publishing, confirm in-thread after).
3. LIVE TEST the real path: install the moved package, smoke its CLI/MCP/serve --version/--help, verify the internal tree's registry tuple is satisfied.
4. Fix-and-re-test until live passes; on bound exhaustion STOP and report verbatim.

Return { merged: [...], published: [...], liveTest: 'pass'|'fail' + evidence }.`, { label: 'livetest', phase: 'LiveTest', schema: { type: 'object', properties: { merged: { type: 'array', items: { type: 'integer' } }, published: { type: 'array', items: { type: 'string' } }, liveTest: { type: 'string' }, evidence: { type: 'string' } }, required: ['merged', 'liveTest'] } })

phase('Harvest')
const harvest = await agent(`HARVEST the datasets-to-internal move (INDEPENDENT — you did not do the work). One decision per category, create/update/none, with reason: SKILLS, TODOS, MEMENTOS, KNOWLEDGE, FILES. Record each category as you decide it (comment the directive task), file rows for create decisions, dedupe first. Post one line to #apps and #internal-apps.`, { label: 'harvest', phase: 'Harvest' })

return { status: 'datasets-to-internal-done', census, move, review, livetest, harvest }
