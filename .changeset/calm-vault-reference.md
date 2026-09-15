---
"@hasna/skills": patch
---

Allow a hosted Secrets vault reference in an owner-only canonical or profile credential file without storing a raw application key. Preserve existing provider precedence and terminal bootstrap/vault failures. Skills retains the normal Secrets bootstrap context, file-instance binding, and configuration checks across asynchronous vault reads; login, logout, and URL changes handle stored references explicitly.

Resolve the installed SDK's ESM export without registry downloads or global/CWD package searches, while preserving caller stdin and strict compiled consumers. A missing or broken SDK and a recursive Secrets bootstrap remain terminal.
