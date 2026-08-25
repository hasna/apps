export const meta = {
  name: 'threads-messages',
  description: 'Owner directive + Fable verdict 2026-08-24 (tasks bf381fad, 8c6b7978): (1) conversations grows native thread collections over its own store; (2) build the open-source @hasna/messages app for direct agent-to-agent messaging with native threads + delivery/read receipts; hard ownership boundary; deploy both on PostgreSQL for the internal harness; update knowledge + instructions (agents must communicate, post announcements); monitor after. Deepseek session-model agents; Fable review; PR-first; publish + deploy + live test.',
  phases: [
    { title: 'Threads' },
    { title: 'Messages' },
    { title: 'Review' },
    { title: 'Deploy' },
    { title: 'LiveTest' },
    { title: 'Doctrine' },
    { title: 'Harvest' },
  ],
}

const THREADS_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['prNumber', 'migration'],
  properties: {
    prNumber: { type: 'integer' },
    migration: { type: 'string' },
  },
}

const MESSAGES_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['scaffolded'],
  properties: {
    scaffolded: { type: 'boolean' },
    prNumber: { type: 'integer' },
    surfaces: { type: 'array', items: { type: 'string' } },
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

phase('Threads')
const threads = await agent(`Land conversations threads (task bf381fad, Fable verdict 2026-08-24). WORKER (deepseek session model).

In a task worktree at ~/.hasna/repos/worktrees/apps/threads:
1. One migration adding thread_id (nullable, = root message id, backfilled by walking existing reply_to/parent_id chains) and thread_status (open/closed) on the root.
2. Verbs: 'conversations threads list --channel <name>' (roots with reply count, last activity, per-agent unread), 'conversations threads expand <root>' (full reply tree), per-agent per-thread read cursors for unread, 'conversations threads close|reopen <root>'.
3. Wire the scaffolded threads_only filter (types.ts:466).
4. Extend reply-threading.e2e.test.ts with thread collection tests. Regression first (failing test demonstrates no thread grouping, then passes).
5. Verify: conversations suite green, bun run check rc=0 at repo root, secrets scan staged rc=0 with real bytes. Commit (Conventional + 'Agent: threads-<short>' trailer), push, open the PR.
6. Ship across all four surfaces on both backends (SQLite + Postgres). DO NOT merge/publish (review + publish separate lanes).

Return the schema: prNumber, migration (one line naming the migration).`, { label: 'threads', phase: 'Threads', schema: THREADS_SCHEMA })

phase('Messages')
const messages = await agent(`Scaffold + build the open-source @hasna/messages app (task 8c6b7978, Fable verdict 2026-08-24). WORKER (deepseek session model).

In hasna/apps: scaffold apps/messages as public @hasna/messages with all four surfaces (CLI bin, MCP bin, -serve server bin, ./sdk importable module) per the monorepo law. SQLite + PostgreSQL backends. Agent identity first-class. Threads native from day one (same shape as conversations: thread_id/list/expand/unread/close-reopen). Per-recipient delivery and read receipts so a stored-but-unread message is distinguishable from a delivered one (the repair for the measured 'conversations send --to' silent-success failure).

Hard boundary (Fable verdict): messages owns direct agent-to-agent DMs + DM-threads; conversations owns channels/announcements/channel-threads. Neither reads the other's store.

Regression tests first; the app's suite green; bun run check rc=0 at repo root; secrets scan staged rc=0 with real bytes. Commit (Conventional + 'Agent: messages-<short>' trailer), push, open the PR. DO NOT merge/publish.

Return the schema: scaffolded (true), prNumber, surfaces (the four shipped).`, { label: 'messages', phase: 'Messages', schema: MESSAGES_SCHEMA })

phase('Review')
const review = await agent(`Adversarial review (FABLE) of the threads + messages PRs. Threads PR #${threads ? threads.prNumber : '?'}, messages PR #${messages ? messages.prNumber : '?'}.

For EACH PR: the Fable verdict's shape is honored (threads over conversations' own store; messages owns DMs with receipts; hard boundary — no cross-store read); migrations are backfill-correct; regression tests fail-pre/pass-post; no secret material; base-movement gate clean; bounded at two remediation cycles.

Return GO if both sound, else NO_GO with per-PR exact findings. [REVIEW] comment on each PR.`, { label: 'review', phase: 'Review', schema: REVIEW_SCHEMA })

if (!review || review.verdict !== 'GO') {
  return { status: 'threads-messages-no-go', threads, messages, review }
}

phase('Deploy')
const deploy = await agent(`Deploy conversations + messages for the internal harness on PostgreSQL (Fable verdict step 5). WORKER.

1. Merge the reviewed PRs (base-movement gate per PR, gh pr merge --squash --body-file ending 'Agent: threads-<short>' / 'Agent: messages-<short>', trailer verified).
2. Publish per the publish law: [PUBLISH INTENT] on git-publishing BEFORE, publish @hasna/conversations (patch) and @hasna/messages to npm (temp npmrc placeholder \${NODE_AUTH_TOKEN} pairing, hasna/npm/live/publish-token), add @hasna/messages to minimumReleaseAgeExcludes in ~/.bunfig.toml, update local installs, confirm in-thread AFTER.
3. Deploy both services for the internal harness in the cloud with Postgres DATABASE_URL (conversations via its existing pg-migrations; messages fresh migrations). Post [DEPLOY INTENT] on git-deployments BEFORE, [DEPLOY-CONFIRM] with live-test evidence AFTER.

Return { merged: [...], published: [...], deployed: 'pass'|'blocked' + resume }.`, { label: 'deploy', phase: 'Deploy', schema: { type: 'object', properties: { merged: { type: 'array', items: { type: 'integer' } }, published: { type: 'array', items: { type: 'string' } }, deployed: { type: 'string' }, resume: { type: 'string' } }, required: ['merged', 'deployed'] } })

phase('LiveTest')
const livetest = await agent(`Live-test the real paths (Fable verdict step 6). WORKER.

1. Channel thread: post a message, reply, 'conversations threads list --channel', 'threads expand', unread decrements, close/reopen.
2. DM: send agent-to-agent through messages, thread a reply, read back the delivery AND read receipts from the recipient side.
3. Fix-and-re-test within the workflow's declared bound; on exhaustion STOP and report verbatim.

Return { liveTest: 'pass'|'fail', evidence }.`, { label: 'livetest', phase: 'LiveTest', schema: { type: 'object', properties: { liveTest: { type: 'string' }, evidence: { type: 'string' } }, required: ['liveTest'] } })

phase('Doctrine')
const doctrine = await agent(`Update the routing doctrine (Fable verdict step 7). WORKER.

1. hasna/knowledge: one convention item — public coordination/announcements/channel-threads → conversations; direct agent-to-agent messaging/DM-threads → messages; agents must communicate and post announcements.
2. hasna/instructions: render the same so every agent knows which surface to use.
3. Update inbox-monitor/awareness-monitor skills to watch messages DMs (no agent structurally deaf to the new surface).
4. Mark conversations' DM/session lane deprecated-for-new-use after the live test passed (per the verdict).`, { label: 'doctrine', phase: 'Doctrine' })

phase('Harvest')
const harvest = await agent(`HARVEST the threads+messages workflow (INDEPENDENT — you did not do the work). One decision per category, create/update/none, with reason: SKILLS, TODOS, MEMENTOS, KNOWLEDGE, FILES. Record each category as you decide it (comment tasks bf381fad + 8c6b7978), file rows for create decisions, dedupe first. Post one line to #apps. Also arm/verify uptime+error monitoring on both deployments per the Fable verdict step 8.`, { label: 'harvest', phase: 'Harvest' })

return { status: 'threads-messages-done', threads, messages, review, deploy, livetest, doctrine, harvest }
