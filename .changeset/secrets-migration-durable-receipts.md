---
"@hasna/secrets": patch
---

Require synchronous PostgreSQL commits and safe WAL settings before vault migration reads or writes, preserving durable receipts even when the caller session disables synchronous commit.
