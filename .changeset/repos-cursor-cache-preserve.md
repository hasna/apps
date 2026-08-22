---
"@hasna/repos": patch
---

syncGithubRepoCatalog with an explicit --cursor (but no --resume) now seeds the record map from the existing cache (fixes row 652ae328): a cursor-only sync previously replaced the catalog cache with only the pages from the cursor onward, silently discarding every earlier record while writing a completed=true envelope with no warning. An explicit cursor is a continuation of the same catalog, so it now preserves cached records; a plain full sync (no cursor, no resume) keeps the fresh-rebuild behavior.
