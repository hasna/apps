---
"@hasna/projects": patch
---

The conversations-channel write guard BUG-0063 added to the client surfaces is
now applied to the hosted store's own write points, so a caller holding a valid
key can no longer pin `integrations.conversations_channel` at a name the
conversations app has no channel for by talking to the HTTP API directly
(BUG-0076):

- `PATCH`/`PUT /v1/workspaces/{id}` (`pg-store.updateWorkspace`);
- `POST /v1/workspaces/{id}/guarded-metadata` (`guardedConditionalUpdate`, so
  also the duplicate-quarantine accept and its rollback), checked before the
  dry-run preview so an unwritable plan is never reported `planned`;
- `POST /v1/workspaces` — a caller-supplied channel on create, matching the
  check the CLI and the MCP create tool already ran at their own call sites;
- the typed resource-link projection, which already carried the rule and now
  shares the same one-home helper.

The rule is imported from the db-free `lib/project-channel-guard.ts`, so this
store still never touches `bun:sqlite`, and it needs no conversations client:
the probe is the same bounded one-shot CLI call, and an unavailable probe or an
`unknown` listing passes through rather than inventing a refusal.

One boundary remains, stated rather than implied: a channel DERIVED at create
(the slug-derived name `pg-store.createWorkspace` pins when the caller supplies
none) is not probed. Local create ensures the channel after the write
(`ensureProjectChannel`); the hosted create has no ensure, and refusing here
would break every hosted create for a brand-new project whose channel does not
exist yet. Closing it means giving the hosted service an ensure step — a design
decision, tracked in the task this fixes, not a line of validation.
