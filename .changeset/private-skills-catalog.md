---
"@hasna/skills": patch
---

Serve only the authenticated organization's published skills. Remove machine-local catalog fallback, automatic bundled-corpus imports on startup, and skill files from the server image. Preserve the old unscoped SDK registry exports as empty compatibility helpers; use an authenticated client to read private catalogs.
