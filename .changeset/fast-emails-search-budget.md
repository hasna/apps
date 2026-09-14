---
"@hasna/emails": patch
---

Admit eight concurrent message searches by default, with a configurable bounded search budget sized against the PostgreSQL connection pool. Preserve ordinary-read capacity, transaction-local cancellation, overload retry advice, and sending/authentication safeguards.
