---
"@hasna/secrets": minor
---

Add an explicitly scoped, atomic vault migration protocol that preserves all supported source tables, re-encrypts values server-side, protects imported history, and verifies complete readback before reporting success. Sources are never deleted; unsupported schemas and conflicts fail closed.
