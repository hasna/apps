---
"@hasna/conversations": patch
---

Resource-lock holder identity is now compared case-insensitively (fixes 13425e5c): acquireLock/bulkAcquireLock conflict checks and releaseLock/listLocks holder filters normalize with toLowerCase()/LOWER() like the module's presence and stale-release paths, so one agent whose --from casing drifts no longer self-conflicts (acquired:false) or blocks releasing its own lock until TTL expiry.
