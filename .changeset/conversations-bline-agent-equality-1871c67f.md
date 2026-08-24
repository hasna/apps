---
"@hasna/conversations": patch
---

Hosted equality enforcement now scopes by the caller-declared byline instead of the API-key principal claim (todos 1871c67f). The fleet's store key carries the agent claim `fleet`, so the three equality-enforcing routes deterministically 403'd every named seat: `conversations context` and `notifications --from <seat>` failed with "notification agent must match the authenticated agent", `channel read --from <seat>` with "reader must match the authenticated agent", and `blockers` without `--from` silently omitted the agent and read fleet-wide at rc=0. The API key authorizes (tenant + scopes); the byline is the identity.

- Server: `/v1/messages/blockers` scopes the SQL to the declared `agent` (omitted: key claim); `/v1/messages/read` stamps receipts under the declared `reader` (omitted: key claim); `/v1/channel-notifications/inbox` scopes to the required `agent` query. The three "must match the authenticated agent" 403s are removed.
- Client: `getUnreadBlockers`/`getUnreadBlockerPreviews` forward the byline unconditionally; the `explicitFrom` plumbing is retired from the CLI, MCP tool, and store interface.
- Contract: openapi descriptions updated, inbox `agent` query now required; generated SDK refreshed.

Deployment note: the hosted server must be redeployed with the new `api.ts` for the fleet to see the fix; the client change alone does not restore a seat's notification inbox.
