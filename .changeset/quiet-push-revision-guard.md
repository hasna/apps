---
"@hasna/skills": patch
---

Refuse skill uploads when the revision preflight fails or returns an unusable row.
Only an explicit missing-skill response permits an initial publish; updates and the
single forced version retry retain the exact verified revision precondition.
