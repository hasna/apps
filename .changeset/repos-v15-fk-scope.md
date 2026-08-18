---
"@hasna/repos": patch
---

fix(db): scope migration v15's post-migration verification to its own table instead of a whole-DB `PRAGMA foreign_key_check`, which could never pass on a registry carrying pre-existing orphan drift and bricked every repos verb on station01 (0.1.49). v15 adds no foreign keys, so the verify now asserts the pr_monitor_state shape it created and checks only that table's own FK constraints; the two pr_monitor_state index statements become `IF NOT EXISTS` so a re-run with the v15 DDL already applied (marker absent) is idempotent. The pre-existing 1560 orphans remain observable and are a separately tracked repair lane.
