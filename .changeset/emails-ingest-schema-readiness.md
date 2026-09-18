---
"@hasna/emails": patch
---

Require the API's exact migration readiness contract before ingest queue access
and between batches, stopping new work on schema drift without automatic migrations.
