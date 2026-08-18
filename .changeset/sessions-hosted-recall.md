---
"@hasna/sessions": patch
---

feat(sessions): serve recall, semantic/hybrid search, embed, recompute-machines, and import-db on the hosted /v1 backend (local-only capability removal). New server endpoints /v1/recall, /v1/search/semantic, /v1/search/hybrid, /v1/embed, /v1/machines/recompute, plus a Postgres embeddings table (migration 0007); the hosted store now calls them instead of throwing. `sessions ingest` remains a loud guard: it scans the machine's own transcript files, and on a hosted machine `sessions sync` provides ingest + push via /v1/sessions/import.
