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

Every surface that can pin the integration is guarded: `create` and
`update`/`link`/guarded-update `--integrations-json`, the MCP
`projects_create`, `projects_update` and `projects_link` tools — the two
integrations writers that previously reached `store.createProject` /
`store.updateProject` unguarded, in both the local and the hosted transport —
the prompt-agent tool surface (`projects_agent_prompt` builds its own
`projects_update`, `projects_create` and `projects_link` tools in
`workspace-agent.ts`, a third integrations writer), and the project step of the
prefix migration (`project-prefix-migration.ts`, guarded plan-aware: a pin that
no existing channel and no channel step in the migration produces is refused).
Each probes the conversations channel listing (`conversations channel list -j`,
cached per process) and refuses only a positive `missing` verdict; the error
names the channel and both failure modes. The migration check reads channel
names from the plan itself rather than probing, because a rename that creates
the target channel must succeed.
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
