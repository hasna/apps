---
"@hasna/conversations": patch
---

conversations-serve answers --help/--version before any backend resolution; previously `conversations-serve --version` (and `--help`) fell through to startApiServer -> buildDeps -> createServerPoolFromEnv and exited rc=1 with a stack trace and empty stdout when HASNA_CONVERSATIONS_DATABASE_URL was unset (todos row 3c0da7fd).
