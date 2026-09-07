---
"@hasna/skills": minor
---

Keep global identities representable in the admin user list when their default workspace has no active membership: the required list-row role may now be null. Consumers must handle this explicit absence of authority. Active organization rosters and role-assignment inputs/responses retain their nonnullable roles; no mutation or impersonation authority is added.
