---
"@hasna/skills": patch
---

Zero-corpus release: the published tarball now ships no skills corpus (files list excludes skills/ and agent-skills/) and carries the new sync tooling — `skills storage migrate` (owner layout migration into ~/.hasna/skills/skills/), `skills sync --adopt` (unmarked-home adoption with conflict isolation), `skills sync --check` (home drift census), and `skills sync --prune` (rollback-recorded removal). Shipped as 0.1.63 (todos c2769468).
