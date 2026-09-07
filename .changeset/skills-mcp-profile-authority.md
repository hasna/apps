---
"@hasna/skills": patch
---

Keep fresh-auth MCP account, workspace member, and API-key operations bound to the live user and membership of the host's named credential profile. Capture authority per invocation, refuse stale or revoked profiles without default-workspace fallback, and return safe key-operation errors without persisting JWTs or mutating global profile selection.
