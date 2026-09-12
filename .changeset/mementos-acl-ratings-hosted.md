---
"@hasna/mementos": minor
---

Memory ACLs and memory ratings are now hosted: new `/v1/acl*` and
`/v1/memories/{id}/ratings` routes, used by `memory_acl_set`,
`memory_acl_list` and `memory_rate`.

Both families wrote a per-station SQLite table and had no server route:

- an ACL rule set on one machine bound nothing anywhere else, and
  `checkPermission`'s documented "this agent has no rules = full access"
  default meant every *other* machine silently granted access to exactly the
  key an operator had just restricted;
- `memory_rate` fed the usefulness signal agents are instructed to produce
  into a file nothing else reads, so the usefulness ratio a station reported
  was its own keystrokes.

- **New routes**: `POST /v1/acl` (upsert by agent + pattern),
  `GET /v1/acl?agent_id=`, `GET /v1/acl/check`, `DELETE /v1/acl/{id}`,
  `POST /v1/memories/{id}/ratings` and `GET /v1/memories/{id}/ratings`
  (ratings plus their summary). `memory_acl` and `memory_ratings` already
  exist in both schemas.
- **The authorization decision is an endpoint.** `checkPermission` asks
  `GET /v1/acl/check` instead of re-deriving the answer from a rule list the
  client may only partly hold — with the "no rules = full access" default,
  an unreadable rule set would otherwise read as a grant.
- Write routes validate their input (`400`) rather than persisting a broken
  rule or a non-boolean rating.
