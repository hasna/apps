---
"@hasna/events": patch
---

Wake the legacy durable spool worker when a filesystem reports publication under a temporary inode name, while continuing to import only completed JSON records.
