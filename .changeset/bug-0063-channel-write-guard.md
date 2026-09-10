---
"@hasna/projects": patch
---

A write that pins `integrations.conversations_channel` at a name the
conversations app has no channel for is refused (BUG-0063). The registry stored
the channel as a free-form name and nothing checked it, so a renamed project
kept pointing at its old name — `employee-contracts` still carrying
`employee-contract-closing`. That name resolved as an agent DM handle and not
as a channel, so a project-channel post landed in the DM lane (nobody watching
the project channel saw it) or failed closed with HTTP 400 "Channel ... does
not exist, so this message was not sent."

Guarded surfaces, each checked on the exact integrations value it persists:

- CLI `create` / `update` / `guarded-update` / `link` `--integrations-json`;
- MCP `projects_create` (hosted and local), `projects_update`, `projects_link`;
- the prompt-agent tools `projects_agent_prompt` builds (`workspace-agent.ts`:
  `projects_update`, `projects_create`, `projects_link`);
- the project step of the prefix migration (`project-prefix-migration.ts`,
  guarded plan-aware: a pin that no existing channel and no channel step in the
  migration produces is refused);
- the typed resource-link projection, in both transports
  (`db/workspaces.ts` and `serve/pg-store.ts`): a conversations channel link is
  authoritative for `integrations.conversations_channel`, so a link whose
  `labels.channel_name` names no channel — including a stale label left behind
  by a channel rename, the bug's own trigger — is refused before the link, the
  pin and the receipt are written. The rule lives in a database-free module
  (`lib/project-channel-guard.ts`) precisely so the PostgreSQL store can apply
  it without pulling in `bun:sqlite`; `lib/project-channel.ts` re-exports every
  symbol, so existing importers are unchanged.

Each probe reads the conversations channel listing (`conversations channel
list -j`, cached per process) and refuses only a positive `missing` verdict; the
error names the channel and both failure modes. The migration check reads
channel names from the plan itself rather than probing, because a rename that
creates the target channel must succeed.

The check fires only when the write actually sets or changes the channel — a
full-integrations write that carries an existing value forward still succeeds,
so repairing a record stays a deliberate, separate act. An unavailable probe or
an `unknown` listing passes through: the guard never fabricates a refusal from
an answer it could not obtain, the same discipline the workspace doctor follows
when it reports "not verified". `HASNA_PROJECTS_CHANNEL_VERIFY=0` (already
honored by the doctor) turns it off. `projectChannelWriteProbe`,
`changedProjectChannel`, `assertProjectChannelWritable` and
`assertProjectChannelIntegrationWritable` are exported for callers that write
integrations themselves.

Two boundaries this change does NOT cross, stated because a guard whose
coverage is implied to be total is worse than one whose edge is named:

1. The hosted HTTP API accepts a caller-supplied `integrations` blob
   (`PATCH`/`PUT /v1/workspaces/{id}`, and `POST` create) with no
   channel-existence check. The rule is client-side by construction: the
   projects server has no conversations client, so a server-side backstop would
   mean adding an outbound conversations dependency to the hosted service.
   Accepted here as a documented boundary, not silently.
2. A channel derived at create (`workspace-plan.ts` locally;
   `pg-store.createWorkspace` on the hosted side) is not validated — the local
   path ensures it through `ensureProjectChannel` after the write, and the
   hosted path has no ensure. Only caller-supplied pins are adjudicated.
