export const meta = {
  name: 'webhooks-delivery',
  description: 'Owner-directed 2026-08-24 (task 184440f4): make conversations event delivery seamless via proper webhooks — wire conversations into the @hasna/events webhook/durable delivery path so agents subscribe instead of polling. Investigate (deepseek session model) → design → land PRs per app (Fable adversarial review per PR, SOL consult on the contract) → live test → publish-all ships → harvest. Internal-apps tree folded into the same contract.',
  phases: [
    { title: 'Investigate' },
    { title: 'Design' },
    { title: 'Land' },
    { title: 'Review' },
    { title: 'LiveTest' },
    { title: 'Harvest' },
  ],
}

const INVESTIGATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['currentState', 'gap', 'surface'],
  properties: {
    currentState: { type: 'string' },
    gap: { type: 'string' },
    surface: { type: 'array', items: { type: 'string' } },
  },
}

const DESIGN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['contract', 'apps'],
  properties: {
    contract: { type: 'string' },
    apps: { type: 'array', items: { type: 'string' } },
    solVerdict: { type: 'string' },
  },
}

const LAND_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['prs'],
  properties: {
    prs: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['app', 'prNumber', 'state'],
        properties: {
          app: { type: 'string' },
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

phase('Investigate')
const investigate = await agent(`Investigate (deepseek — session model) the conversations→events delivery gap in the hasna/apps monorepo (/home/hasna/.hasna/repos/clones/hasna/apps). Owner directive 2026-08-24: "monitoring events like these should be seamless we need webhooks proper webhooks, probably via the events app sdk or wtv but we must do this properly."

CONTEXT (measured): @hasna/events 0.1.15 already ships a delivery surface — 'events channels add <url|command>' (webhook/channel registration), 'events events emit', 'events durable channel/enqueue/drain/work' (durable delivery daemon with leases, retries, dead-letter, status). @hasna/conversations ships 'watch' (desktop-notification poll) and 'events' (emit/list/replay Hasna events) but NO subscription/webhook delivery of its own. The session's current monitoring is a hand-rolled 120s digest poll (/tmp/hasna-apps-channel-monitor.sh) — exactly the polling the owner wants replaced.

Determine precisely:
1. Does conversations emit events on new messages / channel activity? If yes, what types and into which store? If no, what is the minimal surface to add (emit on message create, on DM, on thread reply)?
2. Does events' durable/webhook delivery already consume conversation events, or is it disjoint? Trace: where does 'events channels add' deliver FROM — a queue events writes to? Can a conversations event reach it?
3. What would "seamless webhook" mean concretely here: a conversations→events bridge (conversations emits → events durable queue → webhook POST/command dispatch to subscribers) — name the exact files/functions to change in apps/conversations and apps/events.
4. Check apps/conversations src for an existing event-emit path (grep emit, events, webhook, subscribe, webhook).
5. State what other apps in the tree could consume the same contract (the owner said "many other apps we must land prs for every app").

Return the schema: currentState (2-4 sentences), gap (the exact seam), surface (the concrete file paths + functions). NEVER publish, never merge — investigate only.`, { label: 'investigate', phase: 'Investigate', schema: INVESTIGATE_SCHEMA })

phase('Design')
const design = await agent(`Design the conversations→events webhook delivery contract (deepseek — session model) based on the investigation: ${JSON.stringify(investigate)}.

Produce:
1. The exact contract: how conversations emits message events, how they flow into events' durable delivery, and how subscribers register (events channels add with a webhook URL or command) and receive (POST body shape or command argv + retry/lease semantics from events' durable machinery).
2. The app-by-app PR plan: which apps in hasna/apps need changes (conversations for emit, events for any bridge surface, plus the consumer apps the owner wants), one PR each, in dependency order.
3. Whether the internal-apps tree (hasna-internal/internal-apps) shares the same package surface (it should — the owner folded it in) and which rows/tuples there would need the same contract.

Then run ONE SOL consult (gpt-5.6-sol, high reasoning) on the contract: is a webhook delivery path the right shape vs pushing events straight to a daemon, and is events' durable machinery the right substrate? Record its verdict verbatim.

Return the schema: contract (the full contract), apps (ordered list), solVerdict. Never mutate the repo — design only.`, { label: 'design', phase: 'Design', schema: DESIGN_SCHEMA })

phase('Land')
const land = await agent(`Land the webhook-delivery PRs in hasna/apps per the design: ${JSON.stringify(design)}. WORKER (deepseek — session model) — implement, do not review.

For EACH app in the design's ordered list:
1. Worktree at ~/.hasna/repos/worktrees/apps/<task-or-app-name>, branch from origin/main, PR-first.
2. Implement the app's slice of the contract (conversations emit; events bridge if needed; consumer app adoption).
3. Regression test first — the failing test must demonstrate the current polling/seam gap, then pass with the change.
4. Verify: app suite green, bun run check rc=0 at repo root, secrets scan staged rc=0 with real bytes.
5. Commit (Conventional Commit + 'Agent: fix-lane-<short>' trailer — this is an agent-authored delivery, use the webhooks-delivery identity), push, open the PR with the contract reference and verification lines.
6. DO NOT merge, DO NOT publish — review + merge + publish are separate lanes.

Return the schema: prs (one entry per landed PR). If a PR is impossible (gap already closed, no change needed), state state:'no-op' with the reason.`, { label: 'land', phase: 'Land', schema: LAND_SCHEMA })

phase('Review')
const review = await agent(`Adversarial review (FABLE) of the webhook-delivery PRs. PRs: ${JSON.stringify(land)}.

For EACH landed PR, review the exact head:
1. The contract is honored: conversations emits on the right events; delivery flows through events' durable machinery; subscriber registration works (a webhook URL or command receives the event).
2. Regression tests actually fail pre-fix and pass post-fix; app suite + repo gates green at head.
3. No secret material, no unrelated surface, base-movement gate clean (TREE=$(git merge-tree --write-tree origin/main <head>); git diff --quiet <head> "$TREE").
4. Bounded review: at most two remediation cycles per PR; a third NO_GO terminates that candidate.

Return GO if all PRs are sound, else NO_GO with per-PR exact findings. Verdict goes as a [REVIEW] comment on each PR.`, { label: 'review', phase: 'Review', model: 'fable', schema: REVIEW_SCHEMA })

if (!review || review.verdict !== 'GO') {
  return { status: 'webhooks-delivery-no-go', investigate, design, land, review }
}

phase('LiveTest')
const livetest = await agent(`Live-test the webhook delivery path after review GO (WORKER).

1. Merge the reviewed PRs (base-movement gate at merge time per PR, gh pr merge --squash --body-file ending 'Agent: fix-lane-<short>', trailer verified).
2. Publish the changed @hasna packages per the publish law (temp npmrc ${NODE_AUTH_TOKEN} placeholder pairing, hasna/npm/live/publish-token, announce [PUBLISH INTENT] on git-publishing BEFORE, confirm in-thread AFTER).
3. LIVE TEST the real user-visible path: register a webhook subscription (events channels add), emit/trigger a conversation message, confirm the subscriber receives it — measure delivery, not "it compiled".
4. Fix-and-re-test until the live test passes; on exhausting the bound, STOP and report the live failure verbatim.

Return { merged: [prNumbers], published: [versions], liveTest: 'pass' | 'fail' + evidence }.`, { label: 'livetest', phase: 'LiveTest', schema: { type: 'object', properties: { merged: { type: 'array', items: { type: 'integer' } }, published: { type: 'array', items: { type: 'string' } }, liveTest: { type: 'string' }, evidence: { type: 'string' } }, required: ['merged', 'liveTest'] } })

phase('Harvest')
const harvest = await agent(`HARVEST the webhook-delivery workflow (INDEPENDENT — you did not do the work). One decision per category, create/update/none, with reason:
SKILLS (a repeated procedure worth a skill, or a stale skill this work proved wrong), TODOS (what this surfaced nobody filed), MEMENTOS (what the next agent would re-learn), KNOWLEDGE (ratifiable doctrine or contradicted doctrine), FILES (artefacts for hasna/files).
Record each category as you decide it (comment the row 184440f4), file rows for create decisions, deduplicate against existing artefacts first. Post one line to #apps and to #internal-apps.`, { label: 'harvest', phase: 'Harvest' })

return {
  status: 'webhooks-delivery-done',
  investigate,
  design,
  land,
  review,
  livetest,
  harvest,
}
