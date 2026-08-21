---
"@hasna/knowledge": patch
---

knowledge-serve --help and --version now answer with exit 0 before any environment-bound work: the serve entry parses self-describing flags ahead of the HASNA_KNOWLEDGE_DATABASE_URL check instead of constructing the DB client first (binds-before-args class).
