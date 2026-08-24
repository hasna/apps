---
"@hasna/instructions": patch
---

instructions-serve answers --help/-h before any bind (todos row c8067fdd, O15-00628). Previously `instructions-serve --help` fell through to the Hono app export and bound :3457, printing "instructions-serve listening on …" and serving forever with no help output.
