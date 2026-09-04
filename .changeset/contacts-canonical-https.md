---
"@hasna/contacts": none
---

Applied release record: this pre-1.0 breaking minor is versioned as 0.7.0 in this branch; do not schedule another bump. Publication and compatible Contracts dependency adoption remain separate release gates.

Route CLI, MCP, and package data operations exclusively through an explicitly configured authenticated HTTPS `/v1` authority. Retire client storage modes, SQLite fallback, and client database selectors; keep PostgreSQL configuration server-only and add an explicit non-destructive legacy-data preservation command.
