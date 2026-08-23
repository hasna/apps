---
"@hasna/actions": none
---

Ownership-safe JSON store write lock (release-review P1 remediation): a stale lock is only taken over when its holder process is no longer alive, takeover moves only the owner file so the canonical lock path never empties while a live writer continues, and release only removes a lock this process still owns. Released as 0.2.2 by the publish-all lane; this changeset records the change so the versioning gate sees the 0.2.2 bump as accompanied. No further bump owed.
