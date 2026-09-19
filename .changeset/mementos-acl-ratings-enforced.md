---
"@hasna/mementos": minor
---

Host and enforce memory ACLs and memory ratings on `/v1`.

`memory_acl_set` / `memory_acl_list` / `memory_rate` wrote a per-station SQLite
table, so a rule written on one machine bound nothing anywhere else and the
usefulness ratio a station reported was its own keystrokes. Both families now
have hosted routes (`POST/GET/DELETE /v1/acl`, `GET /v1/acl/check`,
`POST/GET /v1/memories/{id}/ratings`) and the CLI/MCP/SDK clients take them.

The ACL half is now **enforced**, not merely configurable. The subject of a
policy is the agent on the VERIFIED API key, never a body or query value, so a
direct HTTP caller cannot choose which policy applies. Every authoritative read
(`GET /v1/memories/:id`, list, search, briefing, audit, export, inject) and write
(`POST`/`PATCH`/`DELETE`, bulk-forget, bulk-update, import, bulk-upsert) checks
the caller's policy and refuses a denied key with a diagnosable `403`
(`MEMORY_ACL_DENIED`). Deny-by-default applies once an agent has any rule; an
agent with no rules keeps the documented full-access default, now reported as an
explicit `policy_state: "unconfigured"` rather than an accidental grant.
`GET /v1/acl/check` returns the decision (and its policy state) so a client never
re-derives it from a rule set it may only partly hold.

`rateMemory` refuses a success-shaped response that carries no rating, so
feedback that was not recorded cannot read as recorded.
