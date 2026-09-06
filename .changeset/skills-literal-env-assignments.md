---
"@hasna/skills": patch
---

Make `env-check --set` and its `check-env` alias update only an exact valid environment key, preserve literal supported values, and omit supplied values from errors. Reject unsupported values, ambiguous existing dotenv layouts, symlinks and special files before writing; create new `.env` files with owner-only permissions while preserving existing modes and unrelated lines.
