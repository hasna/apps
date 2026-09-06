---
"@hasna/mementos": patch
---

Apply the existing five-second SQLite busy timeout before enabling WAL, so startup can wait for a briefly locked local database. Persistent locks still fail after the timeout; no command retry is added.
